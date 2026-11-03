import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {EXTENSION_UUID, MS_PER_SECOND} from './constants.js';
import {MutterBacklightBackend} from './displayController.js';
import {getOptionalSettings, settingsHasKey} from './themeUtils.js';
import {debugLog, debugWarn} from './logger.js';

const POWER_PROFILES_BUS_NAME = 'org.freedesktop.UPower.PowerProfiles';
const POWER_PROFILES_OBJECT_PATH = '/org/freedesktop/UPower/PowerProfiles';

const UPOWER_BUS_NAME = 'org.freedesktop.UPower';
const UPOWER_OBJECT_PATH = '/org/freedesktop/UPower';
const UPOWER_DISPLAY_DEVICE_PATH = '/org/freedesktop/UPower/devices/DisplayDevice';
const UPOWER_KBD_BACKLIGHT_PATH = '/org/freedesktop/UPower/KbdBacklight';
const UPOWER_KBD_BACKLIGHT_IFACE = 'org.freedesktop.UPower.KbdBacklight';

const SESSION_MANAGER_BUS_NAME = 'org.gnome.SessionManager';
const SESSION_MANAGER_OBJECT_PATH = '/org/gnome/SessionManager';
const SESSION_MANAGER_IFACE = 'org.gnome.SessionManager';
const INHIBIT_SUSPEND_AND_IDLE_FLAGS = 4 | 8;

const PowerProfilesInterfaceXml = `
<node>
    <interface name="org.freedesktop.UPower.PowerProfiles">
        <property name="ActiveProfile" type="s" access="readwrite"/>
        <property name="Profiles" type="aa{sv}" access="read"/>
        <property name="PerformanceDegraded" type="s" access="read"/>
    </interface>
</node>`;

const UPowerInterfaceXml = `
<node>
    <interface name="org.freedesktop.UPower">
        <method name="EnumerateDevices">
            <arg type="ao" direction="out" name="devices"/>
        </method>
        <property name="OnBattery" type="b" access="read"/>
        <property name="LidIsClosed" type="b" access="read"/>
        <property name="LidIsPresent" type="b" access="read"/>
    </interface>
</node>`;

const UPowerDeviceInterfaceXml = `
<node>
    <interface name="org.freedesktop.UPower.Device">
        <property name="Type" type="u" access="read"/>
        <property name="Percentage" type="d" access="read"/>
        <property name="State" type="u" access="read"/>
        <property name="IsPresent" type="b" access="read"/>
        <property name="PowerSupply" type="b" access="read"/>
        <property name="TimeToEmpty" type="x" access="read"/>
        <property name="TimeToFull" type="x" access="read"/>
        <property name="EnergyRate" type="d" access="read"/>
        <property name="Capacity" type="d" access="read"/>
        <property name="EnergyFull" type="d" access="read"/>
        <property name="EnergyFullDesign" type="d" access="read"/>
        <property name="ChargeCycles" type="i" access="read"/>
    </interface>
</node>`;

const PowerProfilesProxyWrapper = Gio.DBusProxy.makeProxyWrapper(PowerProfilesInterfaceXml);
const UPowerProxyWrapper = Gio.DBusProxy.makeProxyWrapper(UPowerInterfaceXml);
const UPowerDeviceProxyWrapper = Gio.DBusProxy.makeProxyWrapper(UPowerDeviceInterfaceXml);

export const POWER_PROFILE_PERFORMANCE = 'performance';
export const POWER_PROFILE_BALANCED = 'balanced';
export const POWER_PROFILE_POWER_SAVER = 'power-saver';

export const POWER_PROFILES = [
    POWER_PROFILE_PERFORMANCE,
    POWER_PROFILE_BALANCED,
    POWER_PROFILE_POWER_SAVER,
];

export const BATTERY_STATE_UNKNOWN = 0;
export const BATTERY_STATE_CHARGING = 1;
export const BATTERY_STATE_DISCHARGING = 2;
export const BATTERY_STATE_EMPTY = 3;
export const BATTERY_STATE_FULLY_CHARGED = 4;

export class PowerController {
    constructor(settings, {enableAutomation = true} = {}) {
        this._settings = settings;
        this._enableAutomation = Boolean(enableAutomation);
        this._cancellable = new Gio.Cancellable();
        this._listeners = new Set();
        this._sessionSettings = null;

        this._proxy = null;
        this._proxySignalId = 0;
        this._activeProfile = null;
        this._availableProfiles = [];
        this._isAvailable = false;

        this._upowerProxy = null;
        this._upowerSignalId = 0;
        this._deviceProxy = null;
        this._deviceSignalId = 0;
        this._physBatteryProxy = null;
        this._physBatterySignalId = 0;

        this._onBattery = false;
        this._batteryPercentage = 100;
        this._batteryState = BATTERY_STATE_UNKNOWN;
        this._hasBattery = false;
        this._timeToEmpty = 0;
        this._timeToFull = 0;
        this._energyRate = 0;
        this._batteryHealth = 0;
        this._chargeCycles = -1;
        this._lastAppliedScenario = null;
        this._lastLowHzState = null;

        this._kbdMaxBrightness = 0;
        this._kbdCurrentBrightness = 0;

        this._inhibitCookie = 0;
        this._inhibitExpiryTimestamp = 0;
        this._inhibitDurationSeconds = 0;
        this._inhibitTimerId = null;

        this._settingsSignalIds = [];

        this._initPowerProfilesProxy();
        this._initUPowerProxies();
        this._initKbdBacklight();
        if (this._enableAutomation)
            this._initSettingsListeners();
    }

    _initPowerProfilesProxy() {
        new PowerProfilesProxyWrapper(
            Gio.DBus.system,
            POWER_PROFILES_BUS_NAME,
            POWER_PROFILES_OBJECT_PATH,
            (proxy, error) => {
                if (this._cancellable?.is_cancelled())
                    return;

                if (error) {
                    debugWarn(`Failed to connect to PowerProfiles D-Bus: ${error.message}`);
                    this._updateAvailability(false);
                    return;
                }

                this._proxy = proxy;
                this._proxySignalId = this._proxy.connect(
                    'g-properties-changed',
                    (_p, changedProps) => this._onProfilesPropertiesChanged(changedProps)
                );

                this._syncFromProfilesProxy();
            },
            this._cancellable
        );
    }

    _initUPowerProxies() {
        new UPowerProxyWrapper(
            Gio.DBus.system,
            UPOWER_BUS_NAME,
            UPOWER_OBJECT_PATH,
            (proxy, error) => {
                if (this._cancellable?.is_cancelled())
                    return;

                if (error) {
                    debugWarn(`Failed to connect to UPower D-Bus: ${error.message}`);
                    return;
                }

                this._upowerProxy = proxy;
                this._upowerSignalId = this._upowerProxy.connect(
                    'g-properties-changed',
                    (_p, changedProps) => this._onUPowerPropertiesChanged(changedProps)
                );

                this._syncFromUPowerProxy();
                this._discoverPhysicalBattery();
                this._evaluateCurrentState(false);
            },
            this._cancellable
        );

        new UPowerDeviceProxyWrapper(
            Gio.DBus.system,
            UPOWER_BUS_NAME,
            UPOWER_DISPLAY_DEVICE_PATH,
            (proxy, error) => {
                if (this._cancellable?.is_cancelled())
                    return;

                if (error) {
                    debugWarn(`Failed to connect to UPower DisplayDevice D-Bus: ${error.message}`);
                    return;
                }

                this._deviceProxy = proxy;
                this._deviceSignalId = this._deviceProxy.connect(
                    'g-properties-changed',
                    (_p, changedProps) => this._onDevicePropertiesChanged(changedProps)
                );

                this._syncFromDeviceProxy();
                this._evaluateCurrentState(false);
            },
            this._cancellable
        );
    }

    _discoverPhysicalBattery() {
        if (!this._upowerProxy)
            return;

        this._upowerProxy.EnumerateDevicesAsync((result, error) => {
            if (error || this._cancellable?.is_cancelled())
                return;

            const [paths] = result;
            if (!Array.isArray(paths))
                return;

            const batPath = paths.find(p => /battery_|BAT/i.test(p));
            if (!batPath)
                return;

            new UPowerDeviceProxyWrapper(
                Gio.DBus.system,
                UPOWER_BUS_NAME,
                batPath,
                (proxy, err) => {
                    if (err || this._cancellable?.is_cancelled())
                        return;

                    this._physBatteryProxy = proxy;
                    this._physBatterySignalId = proxy.connect('g-properties-changed', () => {
                        this._syncFromPhysicalBattery();
                        this._notifyListeners();
                    });
                    this._syncFromPhysicalBattery();
                    this._notifyListeners();
                },
                this._cancellable
            );
        });
    }

    _syncFromPhysicalBattery() {
        if (!this._physBatteryProxy)
            return;

        const cap = this._physBatteryProxy.Capacity;
        if (typeof cap === 'number' && cap > 0) {
            this._batteryHealth = Math.round(cap);
        } else {
            const full = this._physBatteryProxy.EnergyFull;
            const design = this._physBatteryProxy.EnergyFullDesign;
            if (typeof full === 'number' && typeof design === 'number' && design > 0)
                this._batteryHealth = Math.min(100, Math.round((full / design) * 100));
        }

        const cycles = this._physBatteryProxy.ChargeCycles;
        if (typeof cycles === 'number' && cycles >= 0)
            this._chargeCycles = cycles;

        const rate = this._physBatteryProxy.EnergyRate;
        if (typeof rate === 'number' && rate > 0 && this._energyRate <= 0)
            this._energyRate = Number(rate.toFixed(1));
    }

    _initKbdBacklight() {
        Gio.DBus.system.call(
            UPOWER_BUS_NAME,
            UPOWER_KBD_BACKLIGHT_PATH,
            UPOWER_KBD_BACKLIGHT_IFACE,
            'GetMaxBrightness',
            null,
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
            1500,
            this._cancellable,
            (conn, res) => {
                try {
                    const reply = conn.call_finish(res);
                    const [maxVal] = reply.deep_unpack();
                    if (typeof maxVal === 'number' && maxVal > 0) {
                        this._kbdMaxBrightness = maxVal;
                        this._readKbdBrightness();
                    }
                } catch {
                    // Keyboard backlight not present on this hardware
                }
            }
        );
    }

    _readKbdBrightness() {
        if (this._kbdMaxBrightness <= 0 || this._cancellable?.is_cancelled())
            return;

        Gio.DBus.system.call(
            UPOWER_BUS_NAME,
            UPOWER_KBD_BACKLIGHT_PATH,
            UPOWER_KBD_BACKLIGHT_IFACE,
            'GetBrightness',
            null,
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
            1500,
            this._cancellable,
            (conn, res) => {
                try {
                    const reply = conn.call_finish(res);
                    const [curVal] = reply.deep_unpack();
                    if (typeof curVal === 'number' && curVal >= 0) {
                        this._kbdCurrentBrightness = curVal;
                        this._notifyListeners();
                    }
                } catch {
                    // Ignore read error
                }
            }
        );
    }

    hasKbdBacklight() {
        return this._kbdMaxBrightness > 0;
    }

    getKbdBacklightPercent() {
        if (this._kbdMaxBrightness <= 0)
            return 0;
        return Math.round((this._kbdCurrentBrightness / this._kbdMaxBrightness) * 100);
    }

    setKbdBacklightPercent(percent) {
        if (this._kbdMaxBrightness <= 0 || this._cancellable?.is_cancelled())
            return;

        const clamped = Math.max(0, Math.min(100, Math.round(percent)));
        const rawTarget = Math.round((clamped / 100) * this._kbdMaxBrightness);

        Gio.DBus.system.call(
            UPOWER_BUS_NAME,
            UPOWER_KBD_BACKLIGHT_PATH,
            UPOWER_KBD_BACKLIGHT_IFACE,
            'SetBrightness',
            new GLib.Variant('(i)', [rawTarget]),
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
            1500,
            this._cancellable,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                    this._kbdCurrentBrightness = rawTarget;
                    this._notifyListeners();
                } catch (e) {
                    debugWarn(`KbdBacklight SetBrightness failed: ${e.message}`);
                }
            }
        );
    }

    applyScheduledKbdBacklight(isDark) {
        if (!this._settings || !this.hasKbdBacklight())
            return;

        if (!this._settings.get_boolean('kbd-backlight-auto'))
            return;

        if (this._settings.get_boolean('kbd-backlight-off-in-saver') &&
            this._activeProfile === POWER_PROFILE_POWER_SAVER) {
            this.setKbdBacklightPercent(0);
            return;
        }

        if (isDark) {
            const nightLevel = this._settings.get_int('kbd-backlight-night-level');
            this.setKbdBacklightPercent(nightLevel);
        } else {
            this.setKbdBacklightPercent(0);
        }
    }

    isCaffeineActive() {
        return this._inhibitCookie !== 0;
    }

    getCaffeineDuration() {
        return this._inhibitDurationSeconds;
    }

    getCaffeineRemainingSeconds() {
        if (!this.isCaffeineActive() || this._inhibitExpiryTimestamp <= 0)
            return 0;
        return Math.max(0, Math.round((this._inhibitExpiryTimestamp - Date.now()) / MS_PER_SECOND));
    }

    setCaffeine(enabled, durationSeconds = 0) {
        if (!enabled) {
            this._clearCaffeineTimer();
            if (this._inhibitCookie !== 0) {
                const cookie = this._inhibitCookie;
                this._inhibitCookie = 0;
                this._inhibitExpiryTimestamp = 0;
                this._inhibitDurationSeconds = 0;
                return new Promise(resolve => {
                    Gio.DBus.session.call(
                        SESSION_MANAGER_BUS_NAME,
                        SESSION_MANAGER_OBJECT_PATH,
                        SESSION_MANAGER_IFACE,
                        'Uninhibit',
                        new GLib.Variant('(u)', [cookie]),
                        null,
                        Gio.DBusCallFlags.NO_AUTO_START,
                        1500,
                        null,
                        (conn, res) => {
                            try {
                                conn.call_finish(res);
                            } catch {
                                // Ignore uninhibit error
                            }
                            debugLog('Keep Awake (Caffeine) disabled');
                            this._notifyListeners();
                            resolve(false);
                        }
                    );
                });
            }
            return Promise.resolve(false);
        }

        if (this._inhibitCookie !== 0)
            this.setCaffeine(false);

        return new Promise(resolve => {
            Gio.DBus.session.call(
                SESSION_MANAGER_BUS_NAME,
                SESSION_MANAGER_OBJECT_PATH,
                SESSION_MANAGER_IFACE,
                'Inhibit',
                new GLib.Variant('(susu)', [
                    EXTENSION_UUID,
                    0,
                    'SGC-NOVUS Tools Keep Awake (Caffeine)',
                    INHIBIT_SUSPEND_AND_IDLE_FLAGS,
                ]),
                null,
                Gio.DBusCallFlags.NO_AUTO_START,
                1500,
                this._cancellable,
                (conn, res) => {
                    try {
                        const reply = conn.call_finish(res);
                        const [cookie] = reply.deep_unpack();
                        this._inhibitCookie = cookie || 1;
                        this._inhibitDurationSeconds = durationSeconds;
                        this._clearCaffeineTimer();

                        if (durationSeconds > 0) {
                            this._inhibitExpiryTimestamp = Date.now() + durationSeconds * MS_PER_SECOND;
                            this._inhibitTimerId = GLib.timeout_add_seconds(
                                GLib.PRIORITY_DEFAULT,
                                durationSeconds,
                                () => {
                                    this._inhibitTimerId = null;
                                    this.setCaffeine(false);
                                    return GLib.SOURCE_REMOVE;
                                }
                            );
                        } else {
                            this._inhibitExpiryTimestamp = 0;
                        }

                        debugLog(`Keep Awake (Caffeine) enabled (cookie=${cookie}, duration=${durationSeconds}s)`);
                        this._notifyListeners();
                        resolve(true);
                    } catch (e) {
                        debugWarn(`SessionManager.Inhibit failed: ${e.message}`);
                        resolve(false);
                    }
                }
            );
        });
    }

    _clearCaffeineTimer() {
        if (this._inhibitTimerId) {
            GLib.Source.remove(this._inhibitTimerId);
            this._inhibitTimerId = null;
        }
    }

    _initSettingsListeners() {
        if (!this._settings)
            return;

        const scenarioKeys = [
            'power-scenarios-enabled',
            'power-ac-profile',
            'power-battery-profile',
            'power-low-battery-enabled',
            'power-low-battery-threshold',
            'power-profile-screen-timeouts',
            'power-screen-timeout-ac',
            'power-screen-timeout-battery',
            'power-screen-timeout-saver',
            'power-auto-low-refresh-rate',
        ];

        for (const key of scenarioKeys) {
            this._settingsSignalIds.push(
                this._settings.connect(`changed::${key}`, () => this.evaluateScenarios(true))
            );
        }
    }

    _evaluateCurrentState(force) {
        if (this._enableAutomation)
            this.evaluateScenarios(force);
        else
            this._notifyListeners();
    }

    _onProfilesPropertiesChanged(changedProps) {
        if (this._cancellable?.is_cancelled())
            return;

        if (changedProps?.lookup_value('Profiles', null) !== null)
            this._syncAvailableProfiles();

        if (changedProps?.lookup_value('ActiveProfile', null) !== null) {
            this._syncActiveProfile();
            if (this._enableAutomation)
                this._applyDisplayRefreshRate(this._activeProfile);
        }

        this._notifyListeners();
    }

    _onUPowerPropertiesChanged(changedProps) {
        if (this._cancellable?.is_cancelled())
            return;

        if (changedProps?.lookup_value('OnBattery', null) !== null) {
            this._syncFromUPowerProxy();
            this._evaluateCurrentState(false);
        }
    }

    _onDevicePropertiesChanged(changedProps) {
        if (this._cancellable?.is_cancelled())
            return;

        const hasPct = changedProps?.lookup_value('Percentage', null) !== null;
        const hasState = changedProps?.lookup_value('State', null) !== null;
        const hasTime =
            changedProps?.lookup_value('TimeToEmpty', null) !== null ||
            changedProps?.lookup_value('TimeToFull', null) !== null ||
            changedProps?.lookup_value('EnergyRate', null) !== null;

        if (hasPct || hasState || hasTime) {
            this._syncFromDeviceProxy();
            this._evaluateCurrentState(false);
        }
    }

    _syncFromProfilesProxy() {
        if (!this._proxy) {
            this._updateAvailability(false);
            return;
        }

        const hasOwner = this._proxy.g_name_owner !== null;
        this._updateAvailability(hasOwner);

        if (hasOwner) {
            this._syncAvailableProfiles();
            this._syncActiveProfile();
            if (this._enableAutomation)
                this.evaluateScenarios(true);
        }

        this._notifyListeners();
    }

    _syncFromUPowerProxy() {
        if (!this._upowerProxy)
            return;

        const onBat = this._upowerProxy.OnBattery;
        if (typeof onBat === 'boolean')
            this._onBattery = onBat;
    }

    _syncFromDeviceProxy() {
        if (!this._deviceProxy)
            return;

        const isPres = this._deviceProxy.IsPresent;
        const pwrSupply = this._deviceProxy.PowerSupply;
        this._hasBattery = Boolean(isPres && pwrSupply);

        const pct = this._deviceProxy.Percentage;
        if (typeof pct === 'number' && Number.isFinite(pct))
            this._batteryPercentage = Math.round(pct);

        const state = this._deviceProxy.State;
        if (typeof state === 'number')
            this._batteryState = state;

        const timeToEmpty = this._deviceProxy.TimeToEmpty;
        this._timeToEmpty = typeof timeToEmpty === 'number' && timeToEmpty > 0 ? timeToEmpty : 0;

        const timeToFull = this._deviceProxy.TimeToFull;
        this._timeToFull = typeof timeToFull === 'number' && timeToFull > 0 ? timeToFull : 0;

        const energyRate = this._deviceProxy.EnergyRate;
        if (typeof energyRate === 'number' && energyRate >= 0)
            this._energyRate = Number(energyRate.toFixed(1));
    }

    _syncAvailableProfiles() {
        if (!this._proxy?.Profiles) {
            this._availableProfiles = [];
            return;
        }

        try {
            const rawProfiles = this._proxy.Profiles;
            const parsed = [];
            for (const item of rawProfiles) {
                const profileVal = item.Profile;
                if (profileVal) {
                    const str = profileVal.unpack ? profileVal.unpack() : String(profileVal);
                    parsed.push(str);
                }
            }
            this._availableProfiles = parsed;
        } catch (e) {
            debugWarn(`Error parsing power profiles: ${e.message}`);
            this._availableProfiles = [...POWER_PROFILES];
        }
    }

    _syncActiveProfile() {
        if (!this._proxy)
            return;

        const current = this._proxy.ActiveProfile;
        if (current && typeof current === 'string')
            this._activeProfile = current;
    }

    _updateAvailability(available) {
        if (this._isAvailable !== available) {
            this._isAvailable = available;
            debugLog(`PowerProfiles availability -> ${available}`);
        }
    }

    _resolveCurrentScenario() {
        if (!this._settings || !this._settings.get_boolean('power-scenarios-enabled'))
            return {scenarioName: null, targetProfile: null};

        const lowBatEnabled = this._settings.get_boolean('power-low-battery-enabled');
        const lowBatThreshold = this._settings.get_int('power-low-battery-threshold');
        const isLowBattery =
            this._hasBattery &&
            this._onBattery &&
            this._batteryPercentage <= lowBatThreshold;

        if (isLowBattery && lowBatEnabled) {
            return {
                scenarioName: 'low-battery',
                targetProfile: POWER_PROFILE_POWER_SAVER,
            };
        }

        if (this._onBattery) {
            const batProfile = this._settings.get_string('power-battery-profile');
            return {
                scenarioName: 'battery',
                targetProfile: batProfile && batProfile !== 'keep' ? batProfile : null,
            };
        }

        const acProfile = this._settings.get_string('power-ac-profile');
        return {
            scenarioName: 'ac',
            targetProfile: acProfile && acProfile !== 'keep' ? acProfile : null,
        };
    }

    _notifyListeners() {
        const scenarioInfo = this._resolveCurrentScenario();
        const activeScenario = this._lastAppliedScenario ?? scenarioInfo.scenarioName;

        const snapshot = {
            available: this.isAvailable(),
            activeProfile: this._activeProfile,
            availableProfiles: [...this._availableProfiles],
            onBattery: this._onBattery,
            batteryPercentage: this._batteryPercentage,
            batteryState: this._batteryState,
            hasBattery: this._hasBattery,
            timeToEmpty: this._timeToEmpty,
            timeToFull: this._timeToFull,
            energyRate: this._energyRate,
            batteryHealth: this._batteryHealth,
            chargeCycles: this._chargeCycles,
            hasKbdBacklight: this.hasKbdBacklight(),
            kbdBacklightPercent: this.getKbdBacklightPercent(),
            caffeineActive: this.isCaffeineActive(),
            caffeineRemainingSeconds: this.getCaffeineRemainingSeconds(),
            lastScenario: activeScenario,
        };

        for (const listener of this._listeners) {
            try {
                listener(snapshot);
            } catch (e) {
                debugWarn(`Error in PowerController listener: ${e.message}`);
            }
        }
    }

    addChangeListener(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    isAvailable() {
        return Boolean(this._isAvailable && this._proxy && this._proxy.g_name_owner !== null);
    }

    getActiveProfile() {
        return this._activeProfile;
    }

    getAvailableProfiles() {
        return [...this._availableProfiles];
    }

    isOnBattery() {
        return this._onBattery;
    }

    getBatteryPercentage() {
        return this._batteryPercentage;
    }

    getBatteryState() {
        return this._batteryState;
    }

    hasBattery() {
        return this._hasBattery;
    }

    getTimeToEmpty() {
        return this._timeToEmpty;
    }

    getTimeToFull() {
        return this._timeToFull;
    }

    getEnergyRate() {
        return this._energyRate;
    }

    getBatteryHealth() {
        return this._batteryHealth;
    }

    getChargeCycles() {
        return this._chargeCycles;
    }

    getLastScenario() {
        return this._lastAppliedScenario ?? this._resolveCurrentScenario().scenarioName;
    }

    setActiveProfile(profile) {
        if (!this.isAvailable()) {
            debugWarn(`Cannot set profile '${profile}': service unavailable`);
            return;
        }

        if (!POWER_PROFILES.includes(profile)) {
            debugWarn(`Unknown power profile '${profile}'`);
            return;
        }

        debugLog(`Setting active power profile to '${profile}'`);
        try {
            this._proxy.ActiveProfile = profile;
            this._activeProfile = profile;
            if (this._enableAutomation) {
                this._applyScreenTimeouts(this._lastAppliedScenario, profile);
                this._applyDisplayRefreshRate(profile);
            }
            this._notifyListeners();
        } catch (e) {
            debugWarn(`Failed to set ActiveProfile via D-Bus: ${e.message}`);
        }
    }

    evaluateScenarios(force = false) {
        if (!this._settings)
            return;

        if (!this._settings.get_boolean('power-scenarios-enabled')) {
            this._lastAppliedScenario = null;
            if (force)
                this._applyDisplayRefreshRate(this._activeProfile);
            this._notifyListeners();
            return;
        }

        if (!this.isAvailable())
            return;

        const {scenarioName, targetProfile} = this._resolveCurrentScenario();
        const scenarioChanged = scenarioName !== this._lastAppliedScenario;
        this._lastAppliedScenario = scenarioName;

        if ((scenarioChanged || force) && targetProfile && POWER_PROFILES.includes(targetProfile)) {
            if (this.getActiveProfile() !== targetProfile) {
                debugLog(`Scenario '${scenarioName}' activated -> profile '${targetProfile}'`);
                this.setActiveProfile(targetProfile);
                return;
            }
        }

        if (scenarioChanged || force) {
            const effectiveProfile = targetProfile || this._activeProfile;
            this._applyScreenTimeouts(scenarioName, effectiveProfile);
            this._applyDisplayRefreshRate(effectiveProfile);
        }

        this._notifyListeners();
    }

    _applyDisplayRefreshRate(profile) {
        if (!this._settings || !this._settings.get_boolean('power-auto-low-refresh-rate'))
            return;

        const shouldUseLowHz = this._onBattery || profile === POWER_PROFILE_POWER_SAVER;
        if (this._lastLowHzState === shouldUseLowHz)
            return;

        this._lastLowHzState = shouldUseLowHz;
        MutterBacklightBackend.setLowRefreshRate(shouldUseLowHz, this._cancellable).catch(e => {
            debugWarn(`Failed to adjust display refresh rate: ${e.message}`);
        });
    }

    _getSessionSettings() {
        if (!this._sessionSettings)
            this._sessionSettings = getOptionalSettings('org.gnome.desktop.session');
        return this._sessionSettings;
    }

    _applyScreenTimeouts(scenario, profile) {
        if (!this._settings || !this._settings.get_boolean('power-profile-screen-timeouts'))
            return;

        let targetTimeout;
        if (scenario === 'low-battery' || profile === POWER_PROFILE_POWER_SAVER)
            targetTimeout = this._settings.get_int('power-screen-timeout-saver');
        else if (this._onBattery)
            targetTimeout = this._settings.get_int('power-screen-timeout-battery');
        else
            targetTimeout = this._settings.get_int('power-screen-timeout-ac');

        const sessionSettings = this._getSessionSettings();
        if (!sessionSettings || !settingsHasKey(sessionSettings, 'idle-delay'))
            return;

        if (sessionSettings.get_uint('idle-delay') !== targetTimeout) {
            debugLog(`Setting session idle-delay to ${targetTimeout}s`);
            sessionSettings.set_uint('idle-delay', targetTimeout);
        }
    }

    destroy() {
        if (this._inhibitCookie !== 0)
            this.setCaffeine(false);

        this._clearCaffeineTimer();

        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        if (this._proxy && this._proxySignalId) {
            this._proxy.disconnect(this._proxySignalId);
            this._proxySignalId = 0;
        }

        if (this._upowerProxy && this._upowerSignalId) {
            this._upowerProxy.disconnect(this._upowerSignalId);
            this._upowerSignalId = 0;
        }

        if (this._deviceProxy && this._deviceSignalId) {
            this._deviceProxy.disconnect(this._deviceSignalId);
            this._deviceSignalId = 0;
        }

        if (this._physBatteryProxy && this._physBatterySignalId) {
            this._physBatteryProxy.disconnect(this._physBatterySignalId);
            this._physBatterySignalId = 0;
        }

        if (this._settings) {
            for (const id of this._settingsSignalIds)
                this._settings.disconnect(id);
        }
        this._settingsSignalIds = [];

        this._listeners.clear();
        this._proxy = null;
        this._upowerProxy = null;
        this._deviceProxy = null;
        this._physBatteryProxy = null;
        this._sessionSettings = null;
        this._settings = null;
        this._availableProfiles = [];
        this._activeProfile = null;
        this._isAvailable = false;
    }
}
