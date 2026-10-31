import Gio from 'gi://Gio';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {DBUS_INTERFACE_NAME, DBUS_OBJECT_PATH} from './constants.js';
import {ExtensionController} from './extensionController.js';

const ExtensionDBusIface = `
<node>
    <interface name="${DBUS_INTERFACE_NAME}">
        <method name="GetDebugInfo">
            <arg type="s" direction="out" name="info"/>
        </method>
        <method name="ForceThemeSwitch">
            <arg type="b" direction="in" name="isDark"/>
        </method>
        <method name="ResetToAutomatic"/>
    </interface>
</node>`;

export default class NovusDayNightExtension extends Extension {
    enable() {
        this._controller = new ExtensionController(this);
        this._controller.enable();

        this._dbus = Gio.DBusExportedObject.wrapJSObject(ExtensionDBusIface, {
            GetDebugInfo: () => this._controller?.getDebugInfo() ?? '{}',
            ForceThemeSwitch: isDark => this._controller?.forceThemeSwitch(isDark),
            ResetToAutomatic: () => this._controller?.resetToAutomatic(),
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
