import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {DBUS_INTERFACE_NAME, DBUS_OBJECT_PATH} from '../constants.js';
import {debugLog} from '../logger.js';

const BUS_CANDIDATES = [
    'org.gnome.Shell',
    'fun.sgc_novus.NovusDayNight',
];

function callBusMethod(busName, methodName, parameters, timeoutMs, cancellable) {
    return new Promise((resolve, reject) => {
        Gio.DBus.session.call(
            busName,
            DBUS_OBJECT_PATH,
            DBUS_INTERFACE_NAME,
            methodName,
            parameters,
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
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

export async function fetchExtensionDebugInfo(cancellable = null) {
    for (const busName of BUS_CANDIDATES) {
        try {
            const reply = await callBusMethod(busName, 'GetDebugInfo', null, 800, cancellable);
            const [jsonString] = reply.deep_unpack();
            return JSON.parse(jsonString);
        } catch {
            // Try next candidate
        }
    }
    return null;
}

export async function triggerExtensionAction(settings, methodName, parameters = null, cancellable = null) {
    for (const busName of BUS_CANDIDATES) {
        try {
            await callBusMethod(busName, methodName, parameters, 1000, cancellable);
            return true;
        } catch {
            // Try next candidate
        }
    }

    if (settings) {
        if (methodName === 'ForceThemeSwitch' && parameters) {
            const [isDark] = parameters.deep_unpack();
            settings.set_boolean('manual-mode-active', true);
            settings.set_boolean('manual-mode-is-dark', Boolean(isDark));
        } else if (methodName === 'ResetToAutomatic') {
            settings.set_boolean('manual-mode-active', false);
            settings.set_boolean('manual-mode-is-dark', false);
        }
    }

    debugLog(`NovusDayNight: Extension D-Bus offline for ${methodName}; updated GSettings`);
    return false;
}
