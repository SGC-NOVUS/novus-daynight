import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {debugLog, debugWarn} from './logger.js';

const DBUS_FREEDESKTOP_BUS = 'org.freedesktop.DBus';
const DBUS_FREEDESKTOP_PATH = '/org/freedesktop/DBus';
const DBUS_FREEDESKTOP_IFACE = 'org.freedesktop.DBus';
const DBUS_PROPS_IFACE = 'org.freedesktop.DBus.Properties';

const MUTTER_DISPLAY_BUS = 'org.gnome.Mutter.DisplayConfig';
const MUTTER_DISPLAY_PATH = '/org/gnome/Mutter/DisplayConfig';
const MUTTER_DISPLAY_IFACE = 'org.gnome.Mutter.DisplayConfig';

const GSD_POWER_BUS = 'org.gnome.SettingsDaemon.Power';
const GSD_POWER_PATH = '/org/gnome/SettingsDaemon/Power';
const GSD_POWER_SCREEN_IFACE = 'org.gnome.SettingsDaemon.Power.Screen';

export const DDC_SERVICE_BUS = 'com.ddcutil.DdcutilService';
const DDC_SERVICE_PATH = '/com/ddcutil/DdcutilObject';
const DDC_SERVICE_IFACE = 'com.ddcutil.DdcutilInterface';
const DDC_VCP_BRIGHTNESS = 0x10;
const DDC_FLAG_NO_VERIFY = 4;

const MANUFACTURER_NAMES = {
    ACI: 'ASUS',
    ACR: 'Acer',
    AOC: 'AOC',
    BNQ: 'BenQ',
    DEL: 'Dell',
    ENC: 'Eizo',
    GSM: 'LG',
    HWP: 'HP',
    IVM: 'Iiyama',
    LEN: 'Lenovo',
    MSI: 'MSI',
    NEC: 'NEC',
    PHL: 'Philips',
    SAM: 'Samsung',
    VSC: 'ViewSonic',
};

function callSessionDBus(busName, objectPath, interfaceName, methodName, parameters, {
    flags = Gio.DBusCallFlags.NO_AUTO_START,
    timeoutMs = 3000,
    cancellable = null,
} = {}) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            busName,
            objectPath,
            interfaceName,
            methodName,
            parameters,
            null,
            flags,
            timeoutMs,
            cancellable,
            (connection, result) => {
                try {
                    resolve(connection.call_finish(result));
                } catch (e) {
                    reject(e);
                }
            }
        );
    });
}

export function isBuiltinMonitor(monitor) {
    return monitor?.id === 'builtin' ||
        monitor?.type === 'builtin' ||
        monitor?.type === 'gsd-power' ||
        (monitor?.type === 'mutter-dbus' && !monitor?.connector);
}

export function formatMonitorName(manufacturer, model) {
    const mfg = MANUFACTURER_NAMES[manufacturer] ?? manufacturer ?? '';
    const mdl = (model ?? '').trim();
    if (mfg && mdl && !mdl.toLowerCase().startsWith(mfg.toLowerCase()))
        return `${mfg} ${mdl}`;
    return mdl || mfg || 'External Display';
}

export function buildMonitorId({manufacturer, model, serialNumber, binarySerial, connector, displayNumber}) {
    const prefix = `${manufacturer || 'EXT'}-${model || 'Display'}`;
    if (serialNumber)
        return `${prefix}-SN:${serialNumber}`;
    if (binarySerial)
        return `${prefix}-BSN:${binarySerial}`;
    if (connector)
        return `${prefix}-CONN:${connector}`;
    return `${prefix}-DISP:${displayNumber ?? 1}`;
}

function isInternalConnector(connector) {
    return /^(eDP|LVDS|DSI)/i.test(String(connector || ''));
}

export class DisplayController {
    constructor(displayInfo, settings) {
        this.displayInfo = displayInfo;
        this.settings = settings;
    }

    async getBrightness(_cancellable = null) {
        return null;
    }

    async setBrightness(_value, _cancellable = null) {
        return false;
    }

    async isAvailable(_cancellable = null) {
        return false;
    }
}

export class MutterBacklightBackend extends DisplayController {
    constructor(monitor, settings) {
        const builtin = isBuiltinMonitor(monitor);
        const connector = monitor.connector || monitor.drmConnector || null;
        super({
            id: monitor.id || 'builtin',
            name: monitor.name || 'Built-in Display',
            type: 'mutter-dbus',
            identifier: connector,
        }, settings);
        this._isBuiltin = builtin;
        this._connector = connector;
    }

    static async getBacklightState(cancellable = null) {
        try {
            const reply = await callSessionDBus(
                MUTTER_DISPLAY_BUS,
                MUTTER_DISPLAY_PATH,
                DBUS_PROPS_IFACE,
                'Get',
                new GLib.Variant('(ss)', [MUTTER_DISPLAY_IFACE, 'Backlight']),
                {cancellable}
            );

            const [backlight] = reply.recursiveUnpack();
            const [serial, rawItems] = backlight;
            if (!Array.isArray(rawItems) || rawItems.length === 0)
                return null;

            const entries = rawItems.filter(entry =>
                entry.active !== false &&
                typeof entry.min === 'number' &&
                typeof entry.max === 'number' &&
                entry.max > entry.min
            );

            return entries.length > 0 ? {serial, entries} : null;
        } catch (e) {
            debugLog(`Mutter Backlight property unavailable: ${e.message}`);
            return null;
        }
    }

    static async getMonitorSpecs(cancellable = null) {
        const specs = new Map();
        try {
            const reply = await callSessionDBus(
                MUTTER_DISPLAY_BUS,
                MUTTER_DISPLAY_PATH,
                MUTTER_DISPLAY_IFACE,
                'GetCurrentState',
                null,
                {cancellable}
            );
            const [, monitors] = reply.recursiveUnpack();
            for (const [spec, , props] of monitors) {
                const [connector, vendor, product, serial] = spec;
                const cleanSerial = (serial && serial !== '0x00000000' && serial !== '0')
                    ? serial
                    : null;
                specs.set(connector, {
                    connector,
                    vendor: vendor || null,
                    product: product || null,
                    serialNumber: cleanSerial,
                    isBuiltin: Boolean(props?.['is-builtin']) || isInternalConnector(connector),
                    displayName: props?.['display-name'] || null,
                });
            }
        } catch (e) {
            debugLog(`Mutter GetCurrentState unavailable: ${e.message}`);
        }
        return specs;
    }

    static async detectExternalDisplays(cancellable = null) {
        const state = await MutterBacklightBackend.getBacklightState(cancellable);
        if (!state)
            return [];

        const specs = await MutterBacklightBackend.getMonitorSpecs(cancellable);
        const external = [];

        for (const entry of state.entries) {
            const connector = String(entry.connector || '');
            const spec = specs.get(connector);
            const builtin = spec ? spec.isBuiltin : isInternalConnector(connector);
            if (builtin)
                continue;

            const manufacturer = spec?.vendor || 'Mutter';
            const model = spec?.product || connector;
            const serialNumber = spec?.serialNumber || null;

            external.push({
                id: buildMonitorId({manufacturer, model, serialNumber, connector}),
                name: spec?.displayName || formatMonitorName(manufacturer, model),
                type: 'mutter-dbus',
                connector,
                manufacturer,
                model,
                serialNumber,
            });
        }

        return external;
    }

    static async getRefreshRateInfo(cancellable = null) {
        try {
            const reply = await callSessionDBus(
                MUTTER_DISPLAY_BUS,
                MUTTER_DISPLAY_PATH,
                MUTTER_DISPLAY_IFACE,
                'GetCurrentState',
                null,
                {cancellable}
            );
            const [, monitors] = reply.recursiveUnpack();
            const result = [];
            for (const [spec, modes, props] of monitors) {
                const [connector] = spec;
                const currentMode = modes.find(m => m[6]?.['is-current'] === true);
                if (!currentMode)
                    continue;

                const [, width, height, currentRate] = currentMode;
                const sameResRates = modes
                    .filter(m => m[1] === width && m[2] === height)
                    .map(m => Math.round(m[3]))
                    .filter((v, idx, arr) => arr.indexOf(v) === idx)
                    .sort((a, b) => b - a);

                result.push({
                    connector,
                    displayName: props?.['display-name'] || connector,
                    isBuiltin: Boolean(props?.['is-builtin']) || isInternalConnector(connector),
                    currentRate: Math.round(currentRate),
                    availableRates: sameResRates,
                });
            }
            return result;
        } catch {
            return [];
        }
    }

    static async setLowRefreshRate(enableLowHz, cancellable = null) {
        try {
            const reply = await callSessionDBus(
                MUTTER_DISPLAY_BUS,
                MUTTER_DISPLAY_PATH,
                MUTTER_DISPLAY_IFACE,
                'GetCurrentState',
                null,
                {cancellable}
            );
            const [serial, monitors, logicalMonitors] = reply.recursiveUnpack();
            const monitorMap = new Map();
            for (const [spec, modes, props] of monitors) {
                const [connector] = spec;
                monitorMap.set(connector, {modes, props});
            }

            let needsChange = false;
            const newLogicalMonitors = [];

            for (const [x, y, scale, transform, primary, attachedSpecs] of logicalMonitors) {
                const monitorConfigs = [];
                for (const [connector] of attachedSpecs) {
                    const monData = monitorMap.get(connector);
                    if (!monData)
                        return false;

                    const {modes} = monData;
                    const currentMode = modes.find(m => m[6]?.['is-current'] === true);
                    if (!currentMode)
                        return false;

                    const [curModeId, curW, curH, curRate, , validScales] = currentMode;
                    const sameResModes = modes.filter(m =>
                        m[1] === curW &&
                        m[2] === curH &&
                        (!Array.isArray(m[5]) || m[5].some(s => Math.abs(s - scale) < 0.05))
                    );

                    let targetModeId = curModeId;
                    if (enableLowHz) {
                        if (curRate > 62.0) {
                            const lowCandidates = sameResModes
                                .filter(m => m[3] >= 48.0 && m[3] <= 61.5)
                                .sort((a, b) => Math.abs(a[3] - 60.0) - Math.abs(b[3] - 60.0));
                            if (lowCandidates.length > 0 && lowCandidates[0][0] !== curModeId) {
                                targetModeId = lowCandidates[0][0];
                                needsChange = true;
                            }
                        }
                    } else {
                        const highCandidates = [...sameResModes].sort((a, b) => b[3] - a[3]);
                        if (highCandidates.length > 0 && highCandidates[0][3] > curRate + 1.0) {
                            targetModeId = highCandidates[0][0];
                            needsChange = true;
                        }
                    }

                    monitorConfigs.push([connector, targetModeId, {}]);
                    void validScales;
                }
                newLogicalMonitors.push([x, y, scale, transform, primary, monitorConfigs]);
            }

            if (!needsChange)
                return false;

            await callSessionDBus(
                MUTTER_DISPLAY_BUS,
                MUTTER_DISPLAY_PATH,
                MUTTER_DISPLAY_IFACE,
                'ApplyMonitorsConfig',
                new GLib.Variant('(uua(iiduba(ssa{sv}))a{sv})', [
                    serial,
                    1,
                    newLogicalMonitors,
                    {},
                ]),
                {cancellable}
            );
            debugLog(`Applied refresh rate mode (lowHz=${enableLowHz}) via Mutter D-Bus`);
            return true;
        } catch (e) {
            debugWarn(`Mutter ApplyMonitorsConfig refresh rate change failed: ${e.message}`);
            return false;
        }
    }

    async _resolveEntry(cancellable = null) {
        const state = await MutterBacklightBackend.getBacklightState(cancellable);
        if (!state)
            return null;

        for (const entry of state.entries) {
            const conn = String(entry.connector || '');
            if (this._isBuiltin && isInternalConnector(conn))
                return {serial: state.serial, ...entry};

            if (!this._isBuiltin && this._connector &&
                (conn === this._connector || this._connector.endsWith(conn)))
                return {serial: state.serial, ...entry};
        }

        if (this._isBuiltin && state.entries.length === 1) {
            const singleConn = String(state.entries[0].connector || '');
            if (!/^(HDMI|DP|DisplayPort)/i.test(singleConn))
                return {serial: state.serial, ...state.entries[0]};
        }

        return null;
    }

    async getBrightness(cancellable = null) {
        const entry = await this._resolveEntry(cancellable);
        if (!entry)
            return null;

        const pct = Math.round(((entry.value - entry.min) / (entry.max - entry.min)) * 100);
        return Math.max(0, Math.min(100, pct));
    }

    async setBrightness(value, cancellable = null) {
        const entry = await this._resolveEntry(cancellable);
        if (!entry)
            return false;

        const clampedPct = Math.max(1, Math.min(100, Math.round(value)));
        const rawValue = Math.round(entry.min + ((entry.max - entry.min) * clampedPct / 100));

        try {
            await callSessionDBus(
                MUTTER_DISPLAY_BUS,
                MUTTER_DISPLAY_PATH,
                MUTTER_DISPLAY_IFACE,
                'SetBacklight',
                new GLib.Variant('(usi)', [entry.serial, String(entry.connector), rawValue]),
                {cancellable}
            );
            debugLog(`Set ${entry.connector} brightness to ${clampedPct}% via Mutter D-Bus`);
            return true;
        } catch (e) {
            debugWarn(`Mutter SetBacklight failed for ${entry.connector}: ${e.message}`);
            return false;
        }
    }

    async isAvailable(cancellable = null) {
        const entry = await this._resolveEntry(cancellable);
        return entry !== null;
    }
}

export class PowerScreenBackend extends DisplayController {
    constructor(settings) {
        super({
            id: 'builtin',
            name: 'Built-in Display',
            type: 'gsd-power',
            identifier: null,
        }, settings);
    }

    async getBrightness(cancellable = null) {
        try {
            const reply = await callSessionDBus(
                GSD_POWER_BUS,
                GSD_POWER_PATH,
                DBUS_PROPS_IFACE,
                'Get',
                new GLib.Variant('(ss)', [GSD_POWER_SCREEN_IFACE, 'Brightness']),
                {cancellable}
            );
            const [val] = reply.recursiveUnpack();
            if (typeof val !== 'number' || val < 0)
                return null;
            return Math.max(0, Math.min(100, val));
        } catch {
            return null;
        }
    }

    async setBrightness(value, cancellable = null) {
        const clamped = Math.max(1, Math.min(100, Math.round(value)));
        try {
            await callSessionDBus(
                GSD_POWER_BUS,
                GSD_POWER_PATH,
                DBUS_PROPS_IFACE,
                'Set',
                new GLib.Variant('(ssv)', [
                    GSD_POWER_SCREEN_IFACE,
                    'Brightness',
                    new GLib.Variant('i', clamped),
                ]),
                {cancellable}
            );
            return true;
        } catch (e) {
            debugWarn(`SettingsDaemon.Power Brightness write failed: ${e.message}`);
            return false;
        }
    }

    async isAvailable(cancellable = null) {
        const brightness = await this.getBrightness(cancellable);
        return brightness !== null;
    }
}

export class DdcServiceBackend extends DisplayController {
    constructor(monitor, settings) {
        super({
            id: monitor.id,
            name: monitor.name,
            type: 'ddc-dbus',
            identifier: monitor.displayNumber ?? 1,
        }, settings);
        this._displayNumber = monitor.displayNumber ?? 1;
        this._edidTxt = monitor.edidTxt || '';
        this._maxValue = 100;
    }

    static async isServiceAvailable(cancellable = null) {
        try {
            const ownerReply = await callSessionDBus(
                DBUS_FREEDESKTOP_BUS,
                DBUS_FREEDESKTOP_PATH,
                DBUS_FREEDESKTOP_IFACE,
                'NameHasOwner',
                new GLib.Variant('(s)', [DDC_SERVICE_BUS]),
                {flags: Gio.DBusCallFlags.NONE, timeoutMs: 1500, cancellable}
            );
            const [hasOwner] = ownerReply.recursiveUnpack();
            if (hasOwner)
                return true;

            const listReply = await callSessionDBus(
                DBUS_FREEDESKTOP_BUS,
                DBUS_FREEDESKTOP_PATH,
                DBUS_FREEDESKTOP_IFACE,
                'ListActivatableNames',
                null,
                {flags: Gio.DBusCallFlags.NONE, timeoutMs: 1500, cancellable}
            );
            const [names] = listReply.recursiveUnpack();
            return Array.isArray(names) && names.includes(DDC_SERVICE_BUS);
        } catch {
            return false;
        }
    }

    static async detectDisplays(cancellable = null) {
        const available = await DdcServiceBackend.isServiceAvailable(cancellable);
        if (!available)
            return [];

        try {
            const reply = await callSessionDBus(
                DDC_SERVICE_BUS,
                DDC_SERVICE_PATH,
                DDC_SERVICE_IFACE,
                'Detect',
                new GLib.Variant('(u)', [0]),
                {flags: Gio.DBusCallFlags.NONE, timeoutMs: 25000, cancellable}
            );

            const [, rawDisplays, errorStatus, errorMessage] = reply.recursiveUnpack();
            if (!Array.isArray(rawDisplays) || rawDisplays.length === 0) {
                if (errorStatus !== 0)
                    debugWarn(`DdcutilService Detect error ${errorStatus}: ${errorMessage}`);
                return [];
            }

            const detected = [];
            for (const item of rawDisplays) {
                const [
                    displayNumber,
                    ,
                    ,
                    manufacturerId,
                    modelName,
                    serialNumber,
                    productCode,
                    edidTxt,
                    binarySerialNum,
                ] = item;

                if (typeof displayNumber !== 'number' || displayNumber <= 0)
                    continue;

                const cleanSerial = (serialNumber && serialNumber !== 'Unspecified' && serialNumber !== '0')
                    ? serialNumber.trim()
                    : null;
                const cleanBinary = (binarySerialNum && binarySerialNum > 0)
                    ? `0x${binarySerialNum.toString(16)}`
                    : null;
                const manufacturer = (manufacturerId || '').trim() || 'DDC';
                const model = (modelName || '').trim() || `Display ${displayNumber}`;

                detected.push({
                    id: buildMonitorId({
                        manufacturer,
                        model,
                        serialNumber: cleanSerial,
                        binarySerial: cleanBinary,
                        displayNumber,
                    }),
                    name: formatMonitorName(manufacturer, model),
                    type: 'ddc-dbus',
                    displayNumber,
                    manufacturer,
                    model,
                    productCode,
                    serialNumber: cleanSerial,
                    binarySerial: cleanBinary,
                    edidTxt: edidTxt || '',
                });
            }

            return detected;
        } catch (e) {
            debugWarn(`DdcutilService Detect failed: ${e.message}`);
            return [];
        }
    }

    _targetParams(preferEdid = true) {
        if (preferEdid && this._edidTxt)
            return [-1, this._edidTxt];
        return [this._displayNumber || 1, ''];
    }

    async getBrightness(cancellable = null) {
        const tryRead = async preferEdid => {
            const [dispNum, edid] = this._targetParams(preferEdid);
            const reply = await callSessionDBus(
                DDC_SERVICE_BUS,
                DDC_SERVICE_PATH,
                DDC_SERVICE_IFACE,
                'GetVcp',
                new GLib.Variant('(isyu)', [dispNum, edid, DDC_VCP_BRIGHTNESS, 0]),
                {flags: Gio.DBusCallFlags.NONE, timeoutMs: 8000, cancellable}
            );
            return reply.recursiveUnpack();
        };

        try {
            let [currentVal, maxVal, , errStatus] = await tryRead(true);
            if (errStatus !== 0 && this._edidTxt)
                [currentVal, maxVal, , errStatus] = await tryRead(false);

            if (errStatus !== 0 || !maxVal || maxVal <= 0)
                return null;

            this._maxValue = maxVal;
            const pct = Math.round((currentVal / maxVal) * 100);
            return Math.max(0, Math.min(100, pct));
        } catch (e) {
            debugWarn(`DdcutilService GetVcp failed for ${this.displayInfo.name}: ${e.message}`);
            return null;
        }
    }

    async setBrightness(value, cancellable = null) {
        const clampedPct = Math.max(0, Math.min(100, Math.round(value)));
        const rawVal = Math.round((clampedPct / 100) * this._maxValue);

        const tryWrite = async preferEdid => {
            const [dispNum, edid] = this._targetParams(preferEdid);
            const reply = await callSessionDBus(
                DDC_SERVICE_BUS,
                DDC_SERVICE_PATH,
                DDC_SERVICE_IFACE,
                'SetVcp',
                new GLib.Variant('(isyqu)', [
                    dispNum,
                    edid,
                    DDC_VCP_BRIGHTNESS,
                    rawVal,
                    DDC_FLAG_NO_VERIFY,
                ]),
                {flags: Gio.DBusCallFlags.NONE, timeoutMs: 8000, cancellable}
            );
            return reply.recursiveUnpack();
        };

        try {
            let [errStatus, errMsg] = await tryWrite(true);
            if (errStatus !== 0 && this._edidTxt)
                [errStatus, errMsg] = await tryWrite(false);

            if (errStatus !== 0) {
                debugWarn(`DdcutilService SetVcp error ${errStatus}: ${errMsg}`);
                return false;
            }
            return true;
        } catch (e) {
            debugWarn(`DdcutilService SetVcp failed for ${this.displayInfo.name}: ${e.message}`);
            return false;
        }
    }

    async isAvailable(cancellable = null) {
        const serviceReady = await DdcServiceBackend.isServiceAvailable(cancellable);
        if (!serviceReady)
            return false;
        const current = await this.getBrightness(cancellable);
        return current !== null;
    }
}

export async function probeDisplayController(monitor, settings, cancellable = null) {
    const mutter = new MutterBacklightBackend(monitor, settings);
    if (await mutter.isAvailable(cancellable)) {
        debugLog(`${monitor.name} -> Mutter.DisplayConfig D-Bus`);
        return mutter;
    }

    if (isBuiltinMonitor(monitor)) {
        const power = new PowerScreenBackend(settings);
        if (await power.isAvailable(cancellable)) {
            debugLog(`${monitor.name} -> SettingsDaemon.Power D-Bus`);
            return power;
        }
        return mutter;
    }

    debugLog(`${monitor.name} -> com.ddcutil.DdcutilService D-Bus`);
    return new DdcServiceBackend(monitor, settings);
}
