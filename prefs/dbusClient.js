import Gio from 'gi://Gio';
import {
    DBUS_INTERFACE_NAME,
    DBUS_OBJECT_PATH,
    SHELL_BUS_NAME,
    STANDALONE_BUS_NAME,
} from '../constants.js';
import {debugLog} from '../logger.js';

const BUS_CANDIDATES = [
    SHELL_BUS_NAME,
    STANDALONE_BUS_NAME,
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

    debugLog(`Extension D-Bus offline for ${methodName}; updated GSettings`);
    return false;
}
