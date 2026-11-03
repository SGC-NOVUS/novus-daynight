import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {DBUS_OBJECT_PATH, EXTENSION_DBUS_IFACE_XML} from './constants.js';
import {ExtensionController} from './extensionController.js';

export default class SGCNovusToolsExtension extends Extension {
    enable() {
        this._controller = new ExtensionController(this);
        this._controller.enable();

        this._dbus = Gio.DBusExportedObject.wrapJSObject(EXTENSION_DBUS_IFACE_XML, {
            GetDebugInfo: () => this._controller?.getDebugInfo() ?? '{}',
            ForceThemeSwitch: isDark => this._controller?.forceThemeSwitch(isDark),
            ResetToAutomatic: () => this._controller?.resetToAutomatic(),
            SetCaffeine: (enabled, durationSeconds) =>
                this._controller?.setCaffeine(enabled, durationSeconds),
        });
        this._dbus.export(Gio.DBus.session, DBUS_OBJECT_PATH);
    }

    disable() {
        if (this._dbus) {
            this._dbus.unexport();
            this._dbus = null;
        }

        if (this._controller) {
            this._controller.disable();
            this._controller = null;
        }
    }
}
