#!/usr/bin/env -S gjs -m
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gettext from 'gettext';
import system from 'system';

import {
    DBUS_INTERFACE_NAME,
    DBUS_OBJECT_PATH,
    EXTENSION_DBUS_IFACE_XML,
    LOGIN1_BUS_NAME,
    LOGIN1_MANAGER_INTERFACE,
    LOGIN1_OBJECT_PATH,
    MS_PER_SECOND,
    RESUME_DELAY_SECONDS,
    SHELL_BUS_NAME,
    STANDALONE_BUS_NAME,
} from '../constants.js';
import {BrightnessController} from '../brightnessController.js';
import {ThemeController} from '../themeController.js';
import {PowerController} from '../powerController.js';
import {SolarCalculator} from '../solarCalculator.js';
import {
    TimeCalculator,
    formatSolarTimesForDebug,
    resolveScheduleState,
    resolveScheduledTimes,
    secondsUntilEvent,
} from '../timeCalculator.js';
import {debugLog, debugWarn, setDebugLogging} from '../logger.js';

const DOMAIN = 'novus-daynight';
const SCHEMA_ID = 'org.gnome.shell.extensions.novus-daynight';

function resolveRootDir() {
    const scriptFile = Gio.File.new_for_uri(import.meta.url);
    return scriptFile.get_parent().get_parent().get_path();
}

export function loadStandaloneSettings(rootDir) {
    const localSchemasDir = GLib.build_filenamev([rootDir, 'schemas']);
    const compiledPath = GLib.build_filenamev([localSchemasDir, 'gschemas.compiled']);
    const defaultSource = Gio.SettingsSchemaSource.get_default();

    if (GLib.file_test(compiledPath, GLib.FileTest.EXISTS)) {
        const src = Gio.SettingsSchemaSource.new_from_directory(
            localSchemasDir,
            defaultSource,
            false
        );
        const schemaObj = src.lookup(SCHEMA_ID, true);
        if (schemaObj)
            return new Gio.Settings({settings_schema: schemaObj});
    }

    if (defaultSource) {
        const sysSchema = defaultSource.lookup(SCHEMA_ID, true);
        if (sysSchema)
            return new Gio.Settings({settings_schema: sysSchema});
    }

    throw new Error(`GSettings schema '${SCHEMA_ID}' not found.`);
}

function initStandaloneTranslations(rootDir) {
    const localLocale = GLib.build_filenamev([rootDir, 'locale']);
    if (GLib.file_test(localLocale, GLib.FileTest.IS_DIR))
        Gettext.bindtextdomain(DOMAIN, localLocale);
    else
        Gettext.bindtextdomain(DOMAIN, '/usr/share/locale');
    return str => Gettext.dgettext(DOMAIN, str);
}

function sendDesktopNotification(title, body, iconName = 'preferences-desktop-theme-symbolic') {
    Gio.DBus.session.call(
        'org.freedesktop.Notifications',
        '/org/freedesktop/Notifications',
        'org.freedesktop.Notifications',
        'Notify',
        new GLib.Variant('(susssasa{sv}i)', [
            'SGC-NOVUS Tools',
            0,
            iconName,
            title,
            body,
            [],
            {},
            4000,
        ]),
        null,
        Gio.DBusCallFlags.NONE,
        1500,
        null,
        null
    );
}

function syncXfconfOverDBus({theme}) {
    if (!theme)
        return;

    Gio.DBus.session.call(
        'org.xfce.Xfconf',
        '/org/xfce/Xfconf',
        'org.xfce.Xfconf',
        'SetProperty',
        new GLib.Variant('(ssv)', ['xsettings', '/Net/ThemeName', new GLib.Variant('s', theme)]),
        null,
        Gio.DBusCallFlags.NO_AUTO_START,
        1000,
        null,
        null
    );
}

function isGnomeExtensionAlreadyOwningService() {
    return new Promise(resolve => {
        Gio.DBus.session.call(
            SHELL_BUS_NAME,
            DBUS_OBJECT_PATH,
            DBUS_INTERFACE_NAME,
            'GetDebugInfo',
            null,
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
            400,
            null,
            (conn, res) => {
                try {
                    const reply = conn.call_finish(res);
                    resolve(Boolean(reply));
                } catch {
                    resolve(false);
                }
            }
        );
    });
}

class StandaloneDaemon {
    constructor(settings, gettextFn) {
        this._settings = settings;
        this._ = gettextFn;
        setDebugLogging(this._settings.get_boolean('debug-logging'));

        this._manualModeActive = this._settings.get_boolean('manual-mode-active');
        this._manualModeIsDark = this._settings.get_boolean('manual-mode-is-dark');
        this._scheduleTimeoutId = null;
        this._resumeTimeoutId = null;
        this._suspendSignalId = null;
        this._signalIds = [];
        this._debugInfo = null;
        this._dbusImpl = null;
        this._busOwnerId = 0;

        this._brightnessController = new BrightnessController(this._settings);
        this._themeController = new ThemeController(this._settings, {
            notify: sendDesktopNotification,
            onApplied: syncXfconfOverDBus,
            gettext: this._,
        });
        this._powerController = new PowerController(this._settings);
        this._solarCalculator = new SolarCalculator();
        this._timeCalculator = new TimeCalculator();
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

    async start({once = false} = {}) {
        this._themeController.initializeDefaultThemes();

        if (once) {
            if (this._manualModeActive) {
                this._themeController.switchTheme(this._manualModeIsDark, false, true);
                await this._brightnessController.applyManualBrightness(this._manualModeIsDark);
            } else {
                await this._applyScheduleOnce();
            }
            return;
        }

        this._exportDBus();
        this._setupSettingsListeners();
        this._setupSuspendResumeHandler();

        if (this._manualModeActive)
            this._themeController.switchTheme(this._manualModeIsDark, false, true);
        else
            this._scheduleNextChangeEvent();
    }

    async _applyScheduleOnce() {
        const now = new Date();
        const {lightTime, darkTime, lightModeTrigger, darkModeTrigger, solarTimes} =
            this._resolveTimes(now);
        if (!lightTime || !darkTime)
            return;

        this._brightnessController.setTimes(lightTime, darkTime);
        const {inDayPeriod} = resolveScheduleState(now, lightTime, darkTime);
        const isDark = !inDayPeriod;
        this._themeController.switchTheme(isDark, false, false);
        this._applyScheduledPowerProfile(isDark);
        await this._brightnessController.updateBrightness(true);
        this._storeDebugInfo(now, lightTime, darkTime, lightModeTrigger, darkModeTrigger, solarTimes);
    }

    _exportDBus() {
        this._dbusImpl = Gio.DBusExportedObject.wrapJSObject(EXTENSION_DBUS_IFACE_XML, {
            GetDebugInfo: () => this.getDebugInfo(),
            ForceThemeSwitch: isDark => this.forceThemeSwitch(isDark),
            ResetToAutomatic: () => this.resetToAutomatic(),
            SetCaffeine: (enabled, durationSeconds) =>
                this._powerController?.setCaffeine(Boolean(enabled), Number(durationSeconds) || 0),
        });
        this._dbusImpl.export(Gio.DBus.session, DBUS_OBJECT_PATH);

        this._busOwnerId = Gio.bus_own_name_on_connection(
            Gio.DBus.session,
            STANDALONE_BUS_NAME,
            Gio.BusNameOwnerFlags.REPLACE,
            () => debugLog(`StandaloneDaemon: Acquired D-Bus name ${STANDALONE_BUS_NAME}`),
            () => debugWarn(`StandaloneDaemon: Lost D-Bus name ${STANDALONE_BUS_NAME}`)
        );
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
            this._signalIds.push(this._settings.connect(`changed::${key}`, () => {
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
            this._signalIds.push(this._settings.connect(`changed::${key}`, () => {
                this._brightnessController.scheduleBrightnessUpdates();
            }));
        }

        this._signalIds.push(this._settings.connect('changed::debug-logging', () => {
            setDebugLogging(this._settings.get_boolean('debug-logging'));
        }));
    }

    _setupSuspendResumeHandler() {
        this._suspendSignalId = Gio.DBus.system.signal_subscribe(
            LOGIN1_BUS_NAME,
            LOGIN1_MANAGER_INTERFACE,
            'PrepareForSleep',
            LOGIN1_OBJECT_PATH,
            null,
            Gio.DBusSignalFlags.NONE,
            (_conn, _sender, _path, _iface, _signal, params) => {
                const [sleeping] = params.deep_unpack();
                if (!sleeping) {
                    if (this._resumeTimeoutId) {
                        GLib.Source.remove(this._resumeTimeoutId);
                        this._resumeTimeoutId = null;
                    }
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

    _resolveTimes(now) {
        return resolveScheduledTimes(
            this._settings,
            this._solarCalculator,
            this._timeCalculator,
            now
        );
    }

    _scheduleNextChangeEvent() {
        if (this._manualModeActive)
            return;

        if (this._scheduleTimeoutId) {
            GLib.Source.remove(this._scheduleTimeoutId);
            this._scheduleTimeoutId = null;
        }

        const now = new Date();
        const {lightTime, darkTime, lightModeTrigger, darkModeTrigger, solarTimes} =
            this._resolveTimes(now);
        if (!lightTime || !darkTime)
            return;

        this._brightnessController.setTimes(lightTime, darkTime);
        this._brightnessController.scheduleBrightnessUpdates();
        this._storeDebugInfo(now, lightTime, darkTime, lightModeTrigger, darkModeTrigger, solarTimes);

        const {inDayPeriod, nextEventTime, switchToDark} =
            resolveScheduleState(now, lightTime, darkTime);
        const isDarkNow = !inDayPeriod;

        this._themeController.switchTheme(isDarkNow, true, false);
        this._applyScheduledPowerProfile(isDarkNow);
        if (!this._brightnessController.isInTransitionWindow()) {
            this._brightnessController.updateBrightness(true).catch(e => {
                debugWarn('StandaloneDaemon: Initial brightness update failed:', e);
            });
        }

        const secondsToNextEvent = Math.max(
            1,
            Math.round((nextEventTime.getTime() - now.getTime()) / MS_PER_SECOND)
        );
        this._debugInfo.currentMode = isDarkNow ? 'night' : 'day';
        this._debugInfo.nextEventTime = nextEventTime.toLocaleString();
        this._debugInfo.nextEventTimestamp = nextEventTime.getTime();
        this._debugInfo.secondsToNextEvent = secondsToNextEvent;
        this._debugInfo.nextEventType = switchToDark ? 'dark' : 'light';

        this._scheduleTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            secondsToNextEvent,
            () => {
                this._scheduleTimeoutId = null;
                if (this._manualModeActive)
                    return GLib.SOURCE_REMOVE;
                this._themeController.switchTheme(switchToDark, true, false);
                this._applyScheduledPowerProfile(switchToDark);
                this._brightnessController.updateBrightness(true).catch(() => {});
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
            brightnessState: controlBrightness ? 'Static brightness' : 'N/A',
            nextTransition: 'N/A',
            lastUpdateTimestamp,
        };

        if (controlBrightness) {
            try {
                const monitors = JSON.parse(this._settings.get_string('monitors'));
                const enabledMonitors = Array.isArray(monitors)
                    ? monitors.filter(m => m.enabled && m.initialized)
                    : [];
                const incDur = this._settings.get_int('gradual-brightness-increase-duration');
                const decDur = this._settings.get_int('gradual-brightness-decrease-duration');
                for (const m of enabledMonitors) {
                    if (m.lightBrightness === null || m.darkBrightness === null)
                        continue;
                    const cur = (lightTime && darkTime)
                        ? this._brightnessController.calculateBrightness(
                            now,
                            m.lightBrightness,
                            m.darkBrightness,
                            incDur,
                            decDur,
                            this._brightnessController.getTransitionAnchor(m.id)
                        )
                        : null;
                    brightnessInfo.monitors.push({
                        name: m.name,
                        lightBrightness: `${m.lightBrightness}%`,
                        darkBrightness: `${m.darkBrightness}%`,
                        currentBrightness: cur !== null ? `${cur}%` : 'N/A',
                    });
                }
            } catch {
                // Ignore malformed monitor list
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
            power: {
                available: Boolean(this._powerController?.isAvailable()),
                activeProfile: this._powerController?.getActiveProfile() || 'N/A',
                hasBattery: Boolean(this._powerController?.hasBattery()),
                onBattery: Boolean(this._powerController?.isOnBattery()),
                batteryPercentage: this._powerController?.getBatteryPercentage() ?? 100,
                lastScenario: this._powerController?.getLastScenario() || 'manual',
            },
        };
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
                hasBattery: this._powerController.hasBattery(),
                onBattery: this._powerController.isOnBattery(),
                batteryPercentage: this._powerController.getBatteryPercentage(),
                lastScenario: this._powerController.getLastScenario() || 'manual',
            };
        }
        return JSON.stringify(info);
    }

    forceThemeSwitch(isDark) {
        this._manualModeActive = true;
        this._manualModeIsDark = isDark;
        this._settings.set_boolean('manual-mode-active', true);
        this._settings.set_boolean('manual-mode-is-dark', isDark);

        if (this._scheduleTimeoutId) {
            GLib.Source.remove(this._scheduleTimeoutId);
            this._scheduleTimeoutId = null;
        }

        this._themeController.switchTheme(isDark, false, true);
        this._applyScheduledPowerProfile(isDark);
        this._brightnessController.applyManualBrightness(isDark).catch(e => {
            debugWarn('StandaloneDaemon: Failed to apply manual brightness:', e);
        });
    }

    resetToAutomatic() {
        this._manualModeActive = false;
        this._manualModeIsDark = false;
        this._settings.set_boolean('manual-mode-active', false);
        this._settings.set_boolean('manual-mode-is-dark', false);
        this._scheduleNextChangeEvent();
    }

    stop() {
        if (this._scheduleTimeoutId) {
            GLib.Source.remove(this._scheduleTimeoutId);
            this._scheduleTimeoutId = null;
        }
        if (this._resumeTimeoutId) {
            GLib.Source.remove(this._resumeTimeoutId);
            this._resumeTimeoutId = null;
        }
        if (this._suspendSignalId) {
            Gio.DBus.system.signal_unsubscribe(this._suspendSignalId);
            this._suspendSignalId = null;
        }
        for (const id of this._signalIds)
            this._settings.disconnect(id);
        this._signalIds = [];
        if (this._dbusImpl) {
            this._dbusImpl.unexport();
            this._dbusImpl = null;
        }
        if (this._busOwnerId) {
            Gio.bus_unown_name(this._busOwnerId);
            this._busOwnerId = 0;
        }
        this._brightnessController?.destroy();
        this._themeController?.destroy();
        this._powerController?.destroy();
        this._powerController = null;
    }
}

export async function runDaemonCli(argv) {
    const force = argv.includes('--force');
    const once = argv.includes('--once');

    if (!force && !once && await isGnomeExtensionAlreadyOwningService()) {
        print('SGC-NOVUS Tools: GNOME Shell extension Novus_Tools@sgc-novus.fun is active; daemon skipped.');
        return 0;
    }

    const rootDir = resolveRootDir();
    const settings = loadStandaloneSettings(rootDir);
    const gettextFn = initStandaloneTranslations(rootDir);
    const daemon = new StandaloneDaemon(settings, gettextFn);

    if (once) {
        await daemon.start({once: true});
        daemon.stop();
        return 0;
    }

    await daemon.start({once: false});
    print('SGC-NOVUS Tools standalone daemon running (D-Bus: fun.sgc_novus.NovusDayNight)');

    return new Promise(resolve => {
        const shutdown = () => {
            daemon.stop();
            resolve(0);
            return GLib.SOURCE_REMOVE;
        };
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 2, shutdown);
        GLib.unix_signal_add(GLib.PRIORITY_DEFAULT, 15, shutdown);
    });
}

const _invokedProgram = system.programPath || system.programInvocationName || '';
if (_invokedProgram.endsWith('novus-daynight-daemon.js')) {
    const code = await runDaemonCli(system.programArgs);
    system.exit(code);
}
