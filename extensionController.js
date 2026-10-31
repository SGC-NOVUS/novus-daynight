import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {MS_PER_SECOND, RESUME_DELAY_SECONDS} from './constants.js';
import {BrightnessController} from './brightnessController.js';
import {ThemeController} from './themeController.js';
import {SolarCalculator} from './solarCalculator.js';
import {TimeCalculator, resolveScheduleState, secondsUntilEvent} from './timeCalculator.js';
import {NovusQuickSettingsIndicator} from './quickSettingsIndicator.js';
import {debugLog, debugWarn, setDebugLogging} from './logger.js';

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

        this._manualModeActive = this._settings.get_boolean('manual-mode-active');
        this._manualModeIsDark = this._settings.get_boolean('manual-mode-is-dark');

        this._brightnessController = new BrightnessController(this._settings);
        this._themeController = new ThemeController(this._settings, {
            notify: (title, body) => Main.notify(title, body),
            gettext: _,
        });
        this._solarCalculator = new SolarCalculator();
        this._timeCalculator = new TimeCalculator();
    }

    enable() {
        this._themeController.initializeDefaultThemes();
        this._setupMonitorsChangedHandler();
        this._setupSuspendResumeHandler();
        this._setupSettingsListeners();
        this._setupNightLightSync();

        if (this._manualModeActive) {
            this._themeController.switchTheme(this._manualModeIsDark, false, true);
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
        if (this._debugInfo?.currentMode === 'night')
            return true;
        if (this._debugInfo?.currentMode === 'day')
            return false;
        return this._themeController ? !this._themeController.isCurrentlyInLightMode() : false;
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
                        debugWarn(`NovusDayNight: Color D-Bus proxy unavailable: ${e.message}`);
                }
            }
        );
    }

    _setupMonitorsChangedHandler() {
        const monitorManager = global.backend.get_monitor_manager();
        this._monitorsChangedId = monitorManager.connect('monitors-changed', () => {
            if (this._manualModeActive) {
                this._brightnessController.applyManualBrightness(this._manualModeIsDark).catch(e => {
                    debugWarn('NovusDayNight: Failed to apply manual brightness on hotplug:', e);
                });
                return;
            }

            const allowStatic = !this._brightnessController.isInTransitionWindow();
            this._brightnessController.updateBrightness(allowStatic).catch(e => {
                debugWarn('NovusDayNight: Failed to apply brightness on hotplug:', e);
            });
        });
    }

    _setupSuspendResumeHandler() {
        this._suspendSignalId = Gio.DBus.system.signal_subscribe(
            'org.freedesktop.login1',
            'org.freedesktop.login1.Manager',
            'PrepareForSleep',
            '/org/freedesktop/login1',
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
        return JSON.stringify(info);
    }

    forceThemeSwitch(isDark) {
        this._manualModeActive = true;
        this._manualModeIsDark = isDark;
        this._settings.set_boolean('manual-mode-active', true);
        this._settings.set_boolean('manual-mode-is-dark', isDark);

        this._clearScheduleTimer();
        this._themeController.switchTheme(isDark, false, true);
        this._quickIndicator?.syncState();

        this._brightnessController.applyManualBrightness(isDark).catch(e => {
            debugWarn('NovusDayNight: Failed to apply manual brightness:', e);
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
        const latitude = this._settings.get_string('manual-latitude');
        const longitude = this._settings.get_string('manual-longitude');

        let lightTime = null;
        let darkTime = null;
        let solarTimes = null;
        let lightModeTrigger = 'custom';
        let darkModeTrigger = 'custom';

        const hasCoordinates = Boolean(
            latitude && longitude && this._solarCalculator.validateCoordinates(latitude, longitude)
        );

        if (hasCoordinates) {
            solarTimes = this._solarCalculator.getSolarTimes(now, latitude, longitude);
            if (solarTimes) {
                lightModeTrigger = this._settings.get_string('light-mode-trigger');
                lightTime = this._timeCalculator.parseTriggerTime(
                    lightModeTrigger,
                    solarTimes,
                    now,
                    'light',
                    this._settings
                );

                darkModeTrigger = this._settings.get_string('dark-mode-trigger');
                darkTime = this._timeCalculator.parseTriggerTime(
                    darkModeTrigger,
                    solarTimes,
                    now,
                    'dark',
                    this._settings
                );
            }
        }

        if (!lightTime || !darkTime) {
            lightTime = this._timeCalculator.parseCustomTime(
                this._settings.get_string('custom-light-time'),
                now
            );
            darkTime = this._timeCalculator.parseCustomTime(
                this._settings.get_string('custom-dark-time'),
                now
            );
            lightModeTrigger = 'custom';
            darkModeTrigger = 'custom';
        }

        if (!lightTime || !darkTime) {
            console.error('NovusDayNight: Failed to resolve day/night schedule times');
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

        this._themeController.switchTheme(isDarkNow, periodChanged, false);

        if (periodChanged && !this._brightnessController.isInTransitionWindow()) {
            this._brightnessController.updateBrightness(true).catch(e => {
                debugWarn('NovusDayNight: Failed to apply static brightness:', e);
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
                this._brightnessController.updateBrightness(true).catch(e => {
                    debugWarn('NovusDayNight: Scheduled brightness update error:', e);
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
                debugWarn('NovusDayNight: Could not build brightness status:', e);
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

        const formatDate = date =>
            date.toLocaleDateString(undefined, {weekday: 'short', month: 'short', day: 'numeric'});

        const formatSolar = (times, date) => {
            if (!times)
                return null;
            return {
                date: formatDate(date),
                firstLight: times.first_light?.toLocaleTimeString() || 'N/A',
                nauticalDawn: times.nautical_dawn?.toLocaleTimeString() || 'N/A',
                dawn: times.dawn?.toLocaleTimeString() || 'N/A',
                sunrise: times.sunrise?.toLocaleTimeString() || 'N/A',
                sunriseEnd: times.sunrise_end?.toLocaleTimeString() || 'N/A',
                goldenHourEnd: times.golden_hour_end?.toLocaleTimeString() || 'N/A',
                solarNoon: times.solar_noon?.toLocaleTimeString() || 'N/A',
                goldenHour: times.golden_hour?.toLocaleTimeString() || 'N/A',
                sunsetStart: times.sunset_start?.toLocaleTimeString() || 'N/A',
                sunset: times.sunset?.toLocaleTimeString() || 'N/A',
                dusk: times.dusk?.toLocaleTimeString() || 'N/A',
                nauticalDusk: times.nautical_dusk?.toLocaleTimeString() || 'N/A',
                lastLight: times.last_light?.toLocaleTimeString() || 'N/A',
            };
        };

        const prev = this._debugInfo ?? {};
        this._debugInfo = {
            solarTimesToday: formatSolar(solarTimes, now),
            solarTimesTomorrow: formatSolar(tomorrowSolar, tomorrow),
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
