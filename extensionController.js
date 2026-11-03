import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {
    LOGIN1_BUS_NAME,
    LOGIN1_MANAGER_INTERFACE,
    LOGIN1_OBJECT_PATH,
    MS_PER_SECOND,
    RESUME_DELAY_SECONDS,
} from './constants.js';
import {BrightnessController} from './brightnessController.js';
import {ThemeController} from './themeController.js';
import {
    BATTERY_STATE_DISCHARGING,
    POWER_PROFILE_POWER_SAVER,
    PowerController,
} from './powerController.js';
import {SwapHibernateController} from './swapHibernateController.js';
import {SolarCalculator} from './solarCalculator.js';
import {
    TimeCalculator,
    formatSolarTimesForDebug,
    resolveScheduleState,
    resolveScheduledTimes,
    secondsUntilEvent,
} from './timeCalculator.js';
import {NovusQuickSettingsIndicator} from './quickSettingsIndicator.js';
import {debugWarn, setDebugLogging} from './logger.js';

const ColorInterfaceXml = `
<node>
    <interface name="org.gnome.SettingsDaemon.Color">
        <property name="NightLightActive" type="b" access="read"/>
    </interface>
</node>`;

const ColorInfo = Gio.DBusInterfaceInfo.new_for_xml(ColorInterfaceXml);

export class ExtensionController {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        setDebugLogging(this._settings.get_boolean('debug-logging'));

        this._cancellable = new Gio.Cancellable();
        this._scheduleTimeoutId = null;
        this._resumeTimeoutId = null;
        this._suspendSignalId = null;
        this._monitorsChangedId = null;
        this._colorProxy = null;
        this._colorProxyPropId = null;
        this._quickIndicator = null;
        this._settingsSignalIds = [];
        this._debugInfo = null;
        this._criticalHibernateTriggered = false;

        this._manualModeActive = this._settings.get_boolean('manual-mode-active');
        this._manualModeIsDark = this._settings.get_boolean('manual-mode-is-dark');

        this._brightnessController = new BrightnessController(this._settings);
        this._themeController = new ThemeController(this._settings, {
            notify: (title, body) => Main.notify(title, body),
            gettext: _,
        });
        this._powerController = new PowerController(this._settings, {enableAutomation: true});
        this._swapHibernateController = new SwapHibernateController(this._settings, {
            autoRefreshSwap: false,
        });

        this._powerListenerRemover = this._powerController.addChangeListener(state => {
            this._quickIndicator?.syncState();
            this._handleOledDarkSync(state.activeProfile);
            this._powerController?.applyScheduledKbdBacklight(this.isCurrentlyDark());
            this._handleCriticalBattery(state);
        });

        this._swapListenerRemover = this._swapHibernateController.addChangeListener(() => {
            this._quickIndicator?.syncState();
        });

        this._solarCalculator = new SolarCalculator();
        this._timeCalculator = new TimeCalculator();
    }

    getPowerController() {
        return this._powerController;
    }

    getSwapHibernateController() {
        return this._swapHibernateController;
    }

    getSettings() {
        return this._settings;
    }

    _handleCriticalBattery(state) {
        if (!this._settings || !this._settings.get_boolean('power-critical-battery-hibernate'))
            return;

        if (!state.hasBattery || !state.onBattery) {
            this._criticalHibernateTriggered = false;
            return;
        }

        const threshold = this._settings.get_int('power-critical-battery-threshold');
        if (state.batteryPercentage > threshold) {
            this._criticalHibernateTriggered = false;
            return;
        }

        if (state.batteryState !== BATTERY_STATE_DISCHARGING || this._criticalHibernateTriggered)
            return;

        if (this._swapHibernateController?.canHibernate()) {
            this._criticalHibernateTriggered = true;
            debugWarn(`Critical battery (${state.batteryPercentage}%) -> triggering hibernate`);
            this._swapHibernateController.hibernate(false);
        }
    }

    _handleOledDarkSync(activeProfile) {
        if (!this._settings || !this._themeController || this._manualModeActive)
            return;

        if (!this._settings.get_boolean('power-sync-oled-dark'))
            return;

        const isSaver = activeProfile === POWER_PROFILE_POWER_SAVER;
        const currentlyDark = !this._themeController.isCurrentlyInLightMode();

        if (isSaver && !currentlyDark) {
            this._themeController.switchTheme(true, true, false);
            this._quickIndicator?.syncState();
        } else if (!isSaver && this._settings.get_string('last-auto-mode') === 'day' && currentlyDark) {
            this._themeController.switchTheme(false, true, false);
            this._quickIndicator?.syncState();
        }
    }

    _applyScheduledPowerProfile(isDark) {
        this._powerController?.applyScheduledKbdBacklight(isDark);

        if (!this._settings || !this._settings.get_boolean('auto-power-profile-schedule'))
            return;

        const targetProfile = isDark
            ? this._settings.get_string('dark-power-profile')
            : this._settings.get_string('light-power-profile');

        if (targetProfile && this._powerController?.isAvailable())
            this._powerController.setActiveProfile(targetProfile);
    }

    setCaffeine(enabled, durationSeconds = 0) {
        this._powerController?.setCaffeine(Boolean(enabled), Number(durationSeconds) || 0);
        this._quickIndicator?.syncState();
    }

    enable() {
        this._themeController.initializeDefaultThemes();
        this._setupMonitorsChangedHandler();
        this._setupSuspendResumeHandler();
        this._setupSettingsListeners();
        this._setupNightLightSync();

        if (this._manualModeActive) {
            this._themeController.switchTheme(this._manualModeIsDark, false, true);
            this._applyScheduledPowerProfile(this._manualModeIsDark);
            this._updateQuickSettingsIndicator();
            return;
        }

        this._scheduleNextChangeEvent();
        this._updateQuickSettingsIndicator();
    }

    _clearScheduleTimer() {
        if (this._scheduleTimeoutId) {
            GLib.Source.remove(this._scheduleTimeoutId);
            this._scheduleTimeoutId = null;
        }
    }

    _clearResumeTimer() {
        if (this._resumeTimeoutId) {
            GLib.Source.remove(this._resumeTimeoutId);
            this._resumeTimeoutId = null;
        }
    }

    _updateQuickSettingsIndicator() {
        if (!this._settings)
            return;

        const shouldShow = this._settings.get_boolean('show-quick-settings');
        if (shouldShow && !this._quickIndicator) {
            this._quickIndicator = new NovusQuickSettingsIndicator(this._extension, this);
        } else if (!shouldShow && this._quickIndicator) {
            this._quickIndicator.destroy();
            this._quickIndicator = null;
        } else if (this._quickIndicator) {
            this._quickIndicator.syncState();
        }
    }

    isManualModeActive() {
        return Boolean(this._manualModeActive);
    }

    isCurrentlyDark() {
        if (this._manualModeActive)
            return Boolean(this._manualModeIsDark);
        if (this._themeController)
            return !this._themeController.isCurrentlyInLightMode();
        return this._debugInfo?.currentMode === 'night';
    }

    getNextSwitchTimeShort() {
        if (this._manualModeActive)
            return null;
        if (this._settings?.get_string('night-light-mode') === 'follow-night-light')
            return null;

        const ts = this._debugInfo?.nextEventTimestamp;
        if (!ts || !Number.isFinite(ts))
            return null;

        return new Date(ts).toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    }

    _setupSettingsListeners() {
        const scheduleKeys = [
            'light-mode-trigger',
            'dark-mode-trigger',
            'custom-light-time',
            'custom-dark-time',
            'manual-latitude',
            'manual-longitude',
        ];

        for (const key of scheduleKeys) {
            this._settingsSignalIds.push(this._settings.connect(`changed::${key}`, () => {
                if (!this._manualModeActive)
                    this._scheduleNextChangeEvent();
            }));
        }

        const brightnessKeys = [
            'control-brightness',
            'gradual-brightness-increase-enabled',
            'gradual-brightness-decrease-enabled',
            'gradual-brightness-increase-duration',
            'gradual-brightness-decrease-duration',
        ];

        for (const key of brightnessKeys) {
            this._settingsSignalIds.push(this._settings.connect(`changed::${key}`, () => {
                this._brightnessController.scheduleBrightnessUpdates();
            }));
        }

        this._settingsSignalIds.push(this._settings.connect('changed::debug-logging', () => {
            setDebugLogging(this._settings.get_boolean('debug-logging'));
        }));

        this._settingsSignalIds.push(this._settings.connect('changed::show-quick-settings', () => {
            this._updateQuickSettingsIndicator();
        }));

        for (const quickKey of [
            'enable-power-profiles',
            'show-quick-hibernate',
            'show-quick-suspend',
            'show-quick-caffeine',
            'prefer-suspend-then-hibernate',
        ]) {
            this._settingsSignalIds.push(this._settings.connect(`changed::${quickKey}`, () => {
                this._quickIndicator?.syncState();
            }));
        }

        for (const kbdKey of [
            'kbd-backlight-auto',
            'kbd-backlight-night-level',
            'kbd-backlight-off-in-saver',
        ]) {
            this._settingsSignalIds.push(this._settings.connect(`changed::${kbdKey}`, () => {
                this._powerController?.applyScheduledKbdBacklight(this.isCurrentlyDark());
            }));
        }

        for (const iconKey of ['sync-icon-theme', 'light-icon-theme', 'dark-icon-theme']) {
            this._settingsSignalIds.push(this._settings.connect(`changed::${iconKey}`, () => {
                this._themeController.switchTheme(
                    this.isCurrentlyDark(),
                    false,
                    this._manualModeActive
                );
            }));
        }

        this._settingsSignalIds.push(this._settings.connect('changed::power-sync-oled-dark', () => {
            this._handleOledDarkSync(this._powerController?.getActiveProfile());
        }));

        this._settingsSignalIds.push(this._settings.connect('changed::auto-power-profile-schedule', () => {
            if (this._settings.get_boolean('auto-power-profile-schedule'))
                this._applyScheduledPowerProfile(this.isCurrentlyDark());
            this._quickIndicator?.syncState();
        }));

        this._settingsSignalIds.push(this._settings.connect('changed::light-power-profile', () => {
            if (this._settings.get_boolean('auto-power-profile-schedule') && !this.isCurrentlyDark())
                this._applyScheduledPowerProfile(false);
        }));

        this._settingsSignalIds.push(this._settings.connect('changed::dark-power-profile', () => {
            if (this._settings.get_boolean('auto-power-profile-schedule') && this.isCurrentlyDark())
                this._applyScheduledPowerProfile(true);
        }));

        this._settingsSignalIds.push(this._settings.connect('changed::true-light-mode', () => {
            if (this._themeController.isCurrentlyInLightMode())
                this._themeController.switchTheme(false, false, this._manualModeActive);
        }));

        this._settingsSignalIds.push(this._settings.connect('changed::night-light-mode', () => {
            const mode = this._settings.get_string('night-light-mode');
            if (mode === 'follow-night-light') {
                const active = Boolean(this._colorProxy?.get_cached_property('NightLightActive')?.unpack());
                if (this._colorProxy && !this._manualModeActive)
                    this._themeController.switchTheme(active, true, false);
                this._quickIndicator?.syncState();
            } else if (!this._manualModeActive) {
                this._scheduleNextChangeEvent();
            }
        }));
    }

    _setupNightLightSync() {
        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SESSION,
            Gio.DBusProxyFlags.NONE,
            ColorInfo,
            'org.gnome.SettingsDaemon.Color',
            '/org/gnome/SettingsDaemon/Color',
            'org.gnome.SettingsDaemon.Color',
            this._cancellable,
            (_source, result) => {
                try {
                    const proxy = Gio.DBusProxy.new_for_bus_finish(result);
                    if (!this._settings)
                        return;

                    this._colorProxy = proxy;
                    this._colorProxyPropId = proxy.connect('g-properties-changed', p => {
                        if (this._settings?.get_string('night-light-mode') !== 'follow-night-light')
                            return;

                        const active = Boolean(p.get_cached_property('NightLightActive')?.unpack());
                        if (!this._manualModeActive) {
                            this._themeController.switchTheme(active, true, false);
                            if (this._debugInfo)
                                this._debugInfo.currentMode = active ? 'night' : 'day';
                            this._quickIndicator?.syncState();
                        }
                    });

                    if (this._settings.get_string('night-light-mode') === 'follow-night-light' &&
                        !this._manualModeActive) {
                        const active = Boolean(proxy.get_cached_property('NightLightActive')?.unpack());
                        this._themeController.switchTheme(active, false, false);
                        if (this._debugInfo)
                            this._debugInfo.currentMode = active ? 'night' : 'day';
                        this._quickIndicator?.syncState();
                    }
                } catch (e) {
                    if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        debugWarn(`Color D-Bus proxy unavailable: ${e.message}`);
                }
            }
        );
    }

    _setupMonitorsChangedHandler() {
        const monitorManager = global.backend.get_monitor_manager();
        this._monitorsChangedId = monitorManager.connect('monitors-changed', () => {
            if (this._manualModeActive) {
                this._brightnessController.applyManualBrightness(this._manualModeIsDark).catch(e => {
                    debugWarn('Failed to apply manual brightness on hotplug:', e);
                });
                return;
            }

            const allowStatic = !this._brightnessController.isInTransitionWindow();
            this._brightnessController.updateBrightness(allowStatic).catch(e => {
                debugWarn('Failed to apply brightness on hotplug:', e);
            });
        });
    }

    _setupSuspendResumeHandler() {
        this._suspendSignalId = Gio.DBus.system.signal_subscribe(
            LOGIN1_BUS_NAME,
            LOGIN1_MANAGER_INTERFACE,
            'PrepareForSleep',
            LOGIN1_OBJECT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            (_connection, _sender, _path, _iface, _signal, params) => {
                const [sleeping] = params.deep_unpack();
                if (!sleeping) {
                    this._clearResumeTimer();
                    this._resumeTimeoutId = GLib.timeout_add_seconds(
                        GLib.PRIORITY_DEFAULT,
                        RESUME_DELAY_SECONDS,
                        () => {
                            this._resumeTimeoutId = null;
                            if (!this._manualModeActive)
                                this._scheduleNextChangeEvent();
                            return GLib.SOURCE_REMOVE;
                        }
                    );
                }
            }
        );
    }

    getDebugInfo() {
        const info = {...(this._debugInfo ?? {})};
        if (info.nextEventTimestamp)
            info.secondsToNextEvent = secondsUntilEvent(info.nextEventTimestamp, Date.now());
        info.manualModeActive = this._manualModeActive;
        info.manualModeIsDark = this._manualModeIsDark;

        if (this._powerController) {
            info.power = {
                available: this._powerController.isAvailable(),
                activeProfile: this._powerController.getActiveProfile() || 'N/A',
                onBattery: this._powerController.isOnBattery(),
                batteryPercentage: this._powerController.getBatteryPercentage(),
                batteryState: this._powerController.getBatteryState(),
                hasBattery: this._powerController.hasBattery(),
                timeToEmpty: this._powerController.getTimeToEmpty(),
                timeToFull: this._powerController.getTimeToFull(),
                energyRate: this._powerController.getEnergyRate(),
                batteryHealth: this._powerController.getBatteryHealth(),
                chargeCycles: this._powerController.getChargeCycles(),
                hasKbdBacklight: this._powerController.hasKbdBacklight(),
                kbdBacklightPercent: this._powerController.getKbdBacklightPercent(),
                caffeineActive: this._powerController.isCaffeineActive(),
                caffeineRemainingSeconds: this._powerController.getCaffeineRemainingSeconds(),
                lastScenario: this._powerController.getLastScenario() || 'standard',
                canHibernate: Boolean(this._swapHibernateController?.canHibernate()),
                canSuspend: Boolean(this._swapHibernateController?.canSuspend()),
                canSuspendThenHibernate: Boolean(this._swapHibernateController?.canSuspendThenHibernate()),
                canHybridSleep: Boolean(this._swapHibernateController?.canHybridSleep()),
            };
        }

        return JSON.stringify(info);
    }

    forceThemeSwitch(isDark) {
        this._manualModeActive = true;
        this._manualModeIsDark = isDark;
        this._settings.set_boolean('manual-mode-active', true);
        this._settings.set_boolean('manual-mode-is-dark', isDark);

        this._clearScheduleTimer();
        this._themeController.switchTheme(isDark, false, true);
        this._applyScheduledPowerProfile(isDark);
        this._quickIndicator?.syncState();

        this._brightnessController.applyManualBrightness(isDark).catch(e => {
            debugWarn('Failed to apply manual brightness:', e);
        });
    }

    resetToAutomatic() {
        this._manualModeActive = false;
        this._manualModeIsDark = false;
        this._settings.set_boolean('manual-mode-active', false);
        this._settings.set_boolean('manual-mode-is-dark', false);
        this._settings.set_string('last-auto-mode', '');
        this._scheduleNextChangeEvent();
        this._quickIndicator?.syncState();
    }

    _scheduleNextChangeEvent() {
        if (this._manualModeActive || !this._settings)
            return;

        this._clearScheduleTimer();

        if (this._settings.get_string('night-light-mode') === 'follow-night-light') {
            if (this._colorProxy) {
                const active = Boolean(
                    this._colorProxy.get_cached_property('NightLightActive')?.unpack()
                );
                this._themeController.switchTheme(active, false, false);
            }
            this._quickIndicator?.syncState();
            return;
        }

        const now = new Date();
        const {lightTime, darkTime, lightModeTrigger, darkModeTrigger, solarTimes} =
            resolveScheduledTimes(
                this._settings,
                this._solarCalculator,
                this._timeCalculator,
                now
            );

        if (!lightTime || !darkTime) {
            console.error('[SGC-NOVUS Tools] Failed to resolve day/night schedule times');
            return;
        }

        this._brightnessController.setTimes(lightTime, darkTime);
        this._brightnessController.scheduleBrightnessUpdates();

        this._storeDebugInfo(now, lightTime, darkTime, lightModeTrigger, darkModeTrigger, solarTimes);

        const {inDayPeriod, nextEventTime, switchToDark} =
            resolveScheduleState(now, lightTime, darkTime);
        const isDarkNow = !inDayPeriod;
        const currentPeriod = isDarkNow ? 'night' : 'day';
        const previousPeriod = this._settings.get_string('last-auto-mode');
        const periodChanged = previousPeriod !== currentPeriod;

        if (periodChanged)
            this._settings.set_string('last-auto-mode', currentPeriod);

        const isOledSaverDark =
            !isDarkNow &&
            this._settings.get_boolean('power-sync-oled-dark') &&
            this._powerController?.getActiveProfile() === POWER_PROFILE_POWER_SAVER;

        this._themeController.switchTheme(isDarkNow || isOledSaverDark, periodChanged, false);
        if (periodChanged)
            this._applyScheduledPowerProfile(isDarkNow);

        if (periodChanged && !this._brightnessController.isInTransitionWindow()) {
            this._brightnessController.updateBrightness(true).catch(e => {
                debugWarn('Failed to apply static brightness:', e);
            });
        }

        const secondsToNextEvent = Math.max(
            1,
            Math.round((nextEventTime.getTime() - now.getTime()) / MS_PER_SECOND)
        );

        this._debugInfo.currentMode = currentPeriod;
        this._debugInfo.nextEventTime = nextEventTime.toLocaleString();
        this._debugInfo.nextEventTimestamp = nextEventTime.getTime();
        this._debugInfo.secondsToNextEvent = secondsToNextEvent;
        this._debugInfo.nextEventType = switchToDark ? 'dark' : 'light';

        this._quickIndicator?.syncState();

        this._clearScheduleTimer();
        this._scheduleTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            secondsToNextEvent,
            () => {
                this._scheduleTimeoutId = null;
                if (this._manualModeActive)
                    return GLib.SOURCE_REMOVE;

                const nextPeriod = switchToDark ? 'night' : 'day';
                this._settings.set_string('last-auto-mode', nextPeriod);
                this._themeController.switchTheme(switchToDark, true, false);
                this._applyScheduledPowerProfile(switchToDark);
                this._brightnessController.updateBrightness(true).catch(e => {
                    debugWarn('Scheduled brightness update error:', e);
                });
                this._scheduleNextChangeEvent();
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _storeDebugInfo(now, lightTime, darkTime, lightTrigger, darkTrigger, solarTimes) {
        const controlBrightness = this._settings.get_boolean('control-brightness');
        const lastUpdateTimestamp =
            Number.parseInt(this._settings.get_string('last-brightness-update'), 10) || 0;

        const brightnessInfo = {
            enabled: controlBrightness,
            monitors: [],
            brightnessState: 'N/A',
            nextTransition: 'N/A',
            lastUpdateTimestamp,
        };

        if (controlBrightness) {
            try {
                const monitors = JSON.parse(this._settings.get_string('monitors'));
                const enabledMonitors = Array.isArray(monitors)
                    ? monitors.filter(m => m.enabled && m.initialized)
                    : [];

                enabledMonitors.sort((a, b) => {
                    if (a.id === 'builtin')
                        return -1;
                    if (b.id === 'builtin')
                        return 1;
                    return 0;
                });

                const decreaseDuration =
                    this._settings.get_int('gradual-brightness-decrease-duration');
                const increaseDuration =
                    this._settings.get_int('gradual-brightness-increase-duration');

                for (const monitor of enabledMonitors) {
                    if (monitor.lightBrightness === null || monitor.darkBrightness === null)
                        continue;

                    const currentBrightness = (lightTime && darkTime)
                        ? this._brightnessController.calculateBrightness(
                            now,
                            monitor.lightBrightness,
                            monitor.darkBrightness,
                            increaseDuration,
                            decreaseDuration,
                            this._brightnessController.getTransitionAnchor(monitor.id)
                        )
                        : null;

                    brightnessInfo.monitors.push({
                        name: monitor.name,
                        lightBrightness: `${monitor.lightBrightness}%`,
                        darkBrightness: `${monitor.darkBrightness}%`,
                        currentBrightness: currentBrightness !== null
                            ? `${currentBrightness}%`
                            : 'N/A',
                    });
                }

                if (enabledMonitors.length > 0 && lightTime && darkTime) {
                    const decreaseEnabled =
                        this._settings.get_boolean('gradual-brightness-decrease-enabled');
                    const increaseEnabled =
                        this._settings.get_boolean('gradual-brightness-increase-enabled');
                    const {inDayPeriod, nextLightTime, nextDarkTime} =
                        resolveScheduleState(now, lightTime, darkTime);

                    if (inDayPeriod) {
                        if (decreaseEnabled && decreaseDuration > 0) {
                            const dimStart = new Date(
                                nextDarkTime.getTime() - decreaseDuration * MS_PER_SECOND
                            );
                            if (now < dimStart) {
                                const rem = Math.round(
                                    (dimStart.getTime() - now.getTime()) / MS_PER_SECOND
                                );
                                const h = Math.floor(rem / 3600);
                                const m = Math.floor((rem % 3600) / 60);
                                brightnessInfo.brightnessState = 'Not in adjustment window';
                                brightnessInfo.nextTransition =
                                    `Dimming starts in ${h > 0 ? `${h}h ` : ''}${m}m`;
                            } else if (now < nextDarkTime) {
                                const pct = Math.round(
                                    ((now.getTime() - dimStart.getTime()) /
                                    (decreaseDuration * MS_PER_SECOND)) * 100
                                );
                                brightnessInfo.brightnessState =
                                    `Dimming (${pct}% through transition)`;
                                brightnessInfo.nextTransition = 'In transition';
                            } else {
                                brightnessInfo.brightnessState = 'Static brightness';
                            }
                        } else {
                            brightnessInfo.brightnessState = 'Static brightness';
                        }
                    } else if (increaseEnabled && increaseDuration > 0) {
                        const brightenStart = new Date(
                            nextLightTime.getTime() - increaseDuration * MS_PER_SECOND
                        );
                        if (now < brightenStart) {
                            const rem = Math.round(
                                (brightenStart.getTime() - now.getTime()) / MS_PER_SECOND
                            );
                            const h = Math.floor(rem / 3600);
                            const m = Math.floor((rem % 3600) / 60);
                            brightnessInfo.brightnessState = 'Not in adjustment window';
                            brightnessInfo.nextTransition =
                                `Brightening starts in ${h > 0 ? `${h}h ` : ''}${m}m`;
                        } else if (now < nextLightTime) {
                            const pct = Math.round(
                                ((now.getTime() - brightenStart.getTime()) /
                                (increaseDuration * MS_PER_SECOND)) * 100
                            );
                            brightnessInfo.brightnessState =
                                `Brightening (${pct}% through transition)`;
                            brightnessInfo.nextTransition = 'In transition';
                        } else {
                            brightnessInfo.brightnessState = 'Static brightness';
                        }
                    } else {
                        brightnessInfo.brightnessState = 'Static brightness';
                    }
                }
            } catch (e) {
                debugWarn('Could not build brightness status:', e);
            }
        }

        const latitude = this._settings.get_string('manual-latitude');
        const longitude = this._settings.get_string('manual-longitude');
        const locationName = this._settings.get_string('location-name');

        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowSolar = (solarTimes && latitude && longitude)
            ? this._solarCalculator.getSolarTimes(tomorrow, latitude, longitude)
            : null;

        const prev = this._debugInfo ?? {};
        this._debugInfo = {
            solarTimesToday: formatSolarTimesForDebug(solarTimes, now),
            solarTimesTomorrow: formatSolarTimesForDebug(tomorrowSolar, tomorrow),
            currentTime: now.toLocaleString(),
            lightTime: lightTime ? lightTime.toLocaleString() : 'N/A',
            darkTime: darkTime ? darkTime.toLocaleString() : 'N/A',
            lightModeTrigger: lightTrigger,
            darkModeTrigger: darkTrigger,
            currentMode: prev.currentMode || 'N/A',
            nextEventTime: prev.nextEventTime || 'N/A',
            nextEventTimestamp: prev.nextEventTimestamp || 0,
            secondsToNextEvent: prev.secondsToNextEvent || 0,
            nextEventType: prev.nextEventType || 'N/A',
            latitude: latitude || 'Not set',
            longitude: longitude || 'Not set',
            locationName: locationName || 'Not set',
            timezone: this._solarCalculator.getTimezone(),
            calculationMethod: solarTimes ? 'Solar events (local calculation)' : 'Custom times',
            brightness: brightnessInfo,
        };
    }

    disable() {
        this._cancellable.cancel();
        this._clearScheduleTimer();
        this._clearResumeTimer();

        if (this._quickIndicator) {
            this._quickIndicator.destroy();
            this._quickIndicator = null;
        }

        if (this._monitorsChangedId) {
            global.backend.get_monitor_manager().disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }

        if (this._suspendSignalId) {
            Gio.DBus.system.signal_unsubscribe(this._suspendSignalId);
            this._suspendSignalId = null;
        }

        if (this._settings) {
            for (const id of this._settingsSignalIds)
                this._settings.disconnect(id);
        }
        this._settingsSignalIds = [];

        if (this._colorProxy && this._colorProxyPropId) {
            this._colorProxy.disconnect(this._colorProxyPropId);
            this._colorProxyPropId = null;
        }
        this._colorProxy = null;

        if (this._powerListenerRemover) {
            this._powerListenerRemover();
            this._powerListenerRemover = null;
        }

        if (this._swapListenerRemover) {
            this._swapListenerRemover();
            this._swapListenerRemover = null;
        }

        if (this._powerController) {
            this._powerController.destroy();
            this._powerController = null;
        }

        if (this._swapHibernateController) {
            this._swapHibernateController.destroy();
            this._swapHibernateController = null;
        }

        this._brightnessController?.destroy();
        this._brightnessController = null;

        this._themeController?.destroy();
        this._themeController = null;

        this._solarCalculator = null;
        this._timeCalculator = null;
        this._settings = null;
        this._debugInfo = null;
        this._extension = null;
    }
}
