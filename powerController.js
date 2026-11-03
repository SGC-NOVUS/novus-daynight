import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import {debugLog, debugWarn} from './logger.js';

const POWER_PROFILES_BUS_NAME = 'org.freedesktop.UPower.PowerProfiles';
const POWER_PROFILES_OBJECT_PATH = '/org/freedesktop/UPower/PowerProfiles';

const UPOWER_BUS_NAME = 'org.freedesktop.UPower';
const UPOWER_OBJECT_PATH = '/org/freedesktop/UPower';
const UPOWER_DISPLAY_DEVICE_PATH = '/org/freedesktop/UPower/devices/DisplayDevice';

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
        <property name="OnBattery" type="b" access="read"/>
        <property name="LidIsClosed" type="b" access="read"/>
        <property name="LidIsPresent" type="b" access="read"/>
    </interface>
</node>`;

const UPowerDeviceInterfaceXml = `
<node>
    <interface name="org.freedesktop.UPower.Device">
        <property name="Percentage" type="d" access="read"/>
        <property name="State" type="u" access="read"/>
        <property name="IsPresent" type="b" access="read"/>
        <property name="PowerSupply" type="b" access="read"/>
        <property name="TimeToEmpty" type="x" access="read"/>
        <property name="TimeToFull" type="x" access="read"/>
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
    constructor(settings) {
        this._settings = settings;
        this._cancellable = new Gio.Cancellable();
        this._listeners = new Set();

        // Power Profiles D-Bus state
        this._proxy = null;
        this._proxySignalId = 0;
        this._activeProfile = null;
        this._availableProfiles = [];
        this._isAvailable = false;

        // UPower Battery & AC D-Bus state
        this._upowerProxy = null;
        this._upowerSignalId = 0;
        this._deviceProxy = null;
        this._deviceSignalId = 0;
        this._onBattery = false;
        this._batteryPercentage = 100.0;
        this._batteryState = BATTERY_STATE_UNKNOWN;
        this._hasBattery = false;
        this._lastAppliedScenario = null;

        // Settings change listeners
        this._settingsSignalIds = [];

        this._initPowerProfilesProxy();
        this._initUPowerProxies();
        this._initSettingsListeners();
    }

    _initPowerProfilesProxy() {
        try {
            new PowerProfilesProxyWrapper(
                Gio.DBus.system,
                POWER_PROFILES_BUS_NAME,
                POWER_PROFILES_OBJECT_PATH,
                (proxy, error) => {
                    if (this._cancellable?.is_cancelled())
                        return;

                    if (error) {
                        debugWarn(`PowerController: Failed to connect to PowerProfiles D-Bus: ${error.message}`);
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
        } catch (e) {
            debugWarn(`PowerController: Exception during PowerProfiles initialization: ${e.message}`);
            this._updateAvailability(false);
        }
    }

    _initUPowerProxies() {
        try {
            new UPowerProxyWrapper(
                Gio.DBus.system,
                UPOWER_BUS_NAME,
                UPOWER_OBJECT_PATH,
                (proxy, error) => {
                    if (this._cancellable?.is_cancelled())
                        return;

                    if (error) {
                        debugWarn(`PowerController: Failed to connect to UPower D-Bus: ${error.message}`);
                        return;
                    }

                    this._upowerProxy = proxy;
                    this._upowerSignalId = this._upowerProxy.connect(
                        'g-properties-changed',
                        (_p, changedProps) => this._onUPowerPropertiesChanged(changedProps)
                    );

                    this._syncFromUPowerProxy();
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
                        debugWarn(`PowerController: Failed to connect to DisplayDevice D-Bus: ${error.message}`);
                        return;
                    }

                    this._deviceProxy = proxy;
                    this._deviceSignalId = this._deviceProxy.connect(
                        'g-properties-changed',
                        (_p, changedProps) => this._onDevicePropertiesChanged(changedProps)
                    );

                    this._syncFromDeviceProxy();
                },
                this._cancellable
            );
        } catch (e) {
            debugWarn(`PowerController: Exception during UPower initialization: ${e.message}`);
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
        ];

        for (const key of scenarioKeys) {
            this._settingsSignalIds.push(
                this._settings.connect(`changed::${key}`, () => this.evaluateScenarios())
            );
        }
    }

    _onProfilesPropertiesChanged(changedProps) {
        if (this._cancellable?.is_cancelled())
            return;

        const hasProfiles = changedProps?.lookup_value('Profiles', null) !== null;
        const hasActive = changedProps?.lookup_value('ActiveProfile', null) !== null;

        if (hasProfiles)
            this._syncAvailableProfiles();

        if (hasActive)
            this._syncActiveProfile();

        this._notifyListeners();
    }

    _onUPowerPropertiesChanged(changedProps) {
        if (this._cancellable?.is_cancelled())
            return;

        const hasOnBattery = changedProps?.lookup_value('OnBattery', null) !== null;
        if (hasOnBattery) {
            this._syncFromUPowerProxy();
            this.evaluateScenarios();
        }
    }

    _onDevicePropertiesChanged(changedProps) {
        if (this._cancellable?.is_cancelled())
            return;

        const hasPct = changedProps?.lookup_value('Percentage', null) !== null;
        const hasState = changedProps?.lookup_value('State', null) !== null;

        if (hasPct || hasState) {
            this._syncFromDeviceProxy();
            this.evaluateScenarios();
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
            this.evaluateScenarios();
        }

        this._notifyListeners();
    }

    _syncFromUPowerProxy() {
        if (!this._upowerProxy)
            return;

        try {
            const onBat = this._upowerProxy.OnBattery;
            if (typeof onBat === 'boolean')
                this._onBattery = onBat;
        } catch (e) {
            debugWarn(`PowerController: Error reading OnBattery: ${e.message}`);
        }
    }

    _syncFromDeviceProxy() {
        if (!this._deviceProxy)
            return;

        try {
            const isPres = this._deviceProxy.IsPresent;
            const pwrSupply = this._deviceProxy.PowerSupply;
            this._hasBattery = Boolean(isPres && pwrSupply);

            const pct = this._deviceProxy.Percentage;
            if (typeof pct === 'number')
                this._batteryPercentage = Math.round(pct);

            const state = this._deviceProxy.State;
            if (typeof state === 'number')
                this._batteryState = state;
        } catch (e) {
            debugWarn(`PowerController: Error reading DisplayDevice: ${e.message}`);
        }
    }

    _syncAvailableProfiles() {
        if (!this._proxy || !this._proxy.Profiles) {
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
            debugWarn(`PowerController: Error parsing Profiles: ${e.message}`);
            this._availableProfiles = [
                POWER_PROFILE_POWER_SAVER,
                POWER_PROFILE_BALANCED,
                POWER_PROFILE_PERFORMANCE,
            ];
        }
    }

    _syncActiveProfile() {
        if (!this._proxy)
            return;

        try {
            const current = this._proxy.ActiveProfile;
            if (current && typeof current === 'string')
                this._activeProfile = current;
        } catch (e) {
            debugWarn(`PowerController: Error reading ActiveProfile: ${e.message}`);
        }
    }

    _updateAvailability(available) {
        if (this._isAvailable !== available) {
            this._isAvailable = available;
            debugLog(`PowerController: availability changed -> ${available}`);
        }
    }

    _notifyListeners() {
        for (const listener of this._listeners) {
            try {
                listener({
                    available: this._isAvailable,
                    activeProfile: this._activeProfile,
                    availableProfiles: this._availableProfiles,
                    onBattery: this._onBattery,
                    batteryPercentage: this._batteryPercentage,
                    batteryState: this._batteryState,
                    hasBattery: this._hasBattery,
                    lastScenario: this._lastAppliedScenario,
                });
            } catch (e) {
                debugWarn(`PowerController: Error in state change listener: ${e.message}`);
            }
        }
    }

    addChangeListener(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    isAvailable() {
        return this._isAvailable && this._proxy && this._proxy.g_name_owner !== null;
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

    getLastScenario() {
        return this._lastAppliedScenario;
    }

    setActiveProfile(profile) {
        if (!this.isAvailable()) {
            debugWarn(`PowerController: Cannot set profile '${profile}', service is not available`);
            return;
        }

        if (!POWER_PROFILES.includes(profile)) {
            debugWarn(`PowerController: Unknown power profile '${profile}'`);
            return;
        }

        debugLog(`PowerController: Setting active profile to '${profile}'`);
        try {
            this._proxy.ActiveProfile = profile;
            this._activeProfile = profile;
            this._applyScreenTimeouts(this._lastAppliedScenario, profile);
            this._notifyListeners();
        } catch (e) {
            debugWarn(`PowerController: Failed to set ActiveProfile via D-Bus: ${e.message}`);
        }
    }

    evaluateScenarios() {
        if (!this._settings || !this._settings.get_boolean('power-scenarios-enabled'))
            return;

        if (!this.isAvailable())
            return;

        const lowBatEnabled = this._settings.get_boolean('power-low-battery-enabled');
        const lowBatThreshold = this._settings.get_int('power-low-battery-threshold');
        const isLowBattery = this._hasBattery && this._onBattery && this._batteryPercentage <= lowBatThreshold;

        let targetProfile = null;
        let scenarioName = null;

        if (isLowBattery && lowBatEnabled) {
            targetProfile = POWER_PROFILE_POWER_SAVER;
            scenarioName = 'low-battery';
        } else if (this._onBattery) {
            const batProfile = this._settings.get_string('power-battery-profile');
            if (batProfile && batProfile !== 'keep')
                targetProfile = batProfile;
            scenarioName = 'battery';
        } else {
            const acProfile = this._settings.get_string('power-ac-profile');
            if (acProfile && acProfile !== 'keep')
                targetProfile = acProfile;
            scenarioName = 'ac';
        }

        if (targetProfile && POWER_PROFILES.includes(targetProfile)) {
            if (this.getActiveProfile() !== targetProfile) {
                debugLog(`PowerController: Scenario '${scenarioName}' activated -> setting profile '${targetProfile}'`);
                this.setActiveProfile(targetProfile);
            }
        }

        this._lastAppliedScenario = scenarioName;
        this._applyScreenTimeouts(scenarioName, targetProfile || this._activeProfile);
        this._notifyListeners();
    }

    _applyScreenTimeouts(scenario, profile) {
        if (!this._settings || !this._settings.get_boolean('power-profile-screen-timeouts'))
            return;

        let targetTimeout = 900;
        if (scenario === 'low-battery' || profile === POWER_PROFILE_POWER_SAVER)
            targetTimeout = this._settings.get_int('power-screen-timeout-saver');
        else if (this._onBattery)
            targetTimeout = this._settings.get_int('power-screen-timeout-battery');
        else
            targetTimeout = this._settings.get_int('power-screen-timeout-ac');

        try {
            const sessionSettings = new Gio.Settings({schema_id: 'org.gnome.desktop.session'});
            if (sessionSettings.get_uint('idle-delay') !== targetTimeout) {
                debugLog(`PowerController: Setting idle-delay to ${targetTimeout}s`);
                sessionSettings.set_uint('idle-delay', targetTimeout);
            }
        } catch (e) {
            debugWarn(`PowerController: Failed to adjust idle-delay: ${e.message}`);
        }
    }

    destroy() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        if (this._proxy && this._proxySignalId) {
            try {
                this._proxy.disconnect(this._proxySignalId);
            } catch {
                // Ignore
            }
            this._proxySignalId = 0;
        }

        if (this._upowerProxy && this._upowerSignalId) {
            try {
                this._upowerProxy.disconnect(this._upowerSignalId);
            } catch {
                // Ignore
            }
            this._upowerSignalId = 0;
        }

        if (this._deviceProxy && this._deviceSignalId) {
            try {
                this._deviceProxy.disconnect(this._deviceSignalId);
            } catch {
                // Ignore
            }
            this._deviceSignalId = 0;
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
        this._availableProfiles = [];
        this._activeProfile = null;
        this._isAvailable = false;
    }
}
