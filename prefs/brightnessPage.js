import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {NIGHT_LIGHT_MODES} from '../constants.js';
import {
    DDC_SERVICE_BUS,
    DdcServiceBackend,
    MutterBacklightBackend,
    PowerScreenBackend,
} from '../displayController.js';
import {isValidTimeString} from '../timeCalculator.js';
import {getOptionalSettings, settingsHasKey} from '../themeUtils.js';
import {MonitorConfigDialog} from './monitorDialog.js';

function addPrefixIcon(row, iconName) {
    row.add_prefix(new Gtk.Image({icon_name: iconName}));
}

export function createBrightnessPage(window, settings) {
    const cancellable = new Gio.Cancellable();
    const signalIds = [];

    const page = new Adw.PreferencesPage({
        title: _('Brightness'),
        icon_name: 'display-brightness-symbolic',
    });

    const brightnessGroup = new Adw.PreferencesGroup({
        title: _('Brightness Control'),
    });
    page.add(brightnessGroup);

    const controlBrightnessRow = new Adw.SwitchRow({
        title: _('Control Brightness'),
        subtitle: _('Gradually adjust screen brightness throughout the day'),
    });
    addPrefixIcon(controlBrightnessRow, 'display-brightness-symbolic');
    settings.bind(
        'control-brightness',
        controlBrightnessRow,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    brightnessGroup.add(controlBrightnessRow);

    const configureMonitorsRow = new Adw.ActionRow({
        title: _('Configure Monitors'),
        subtitle: _('Configure brightness for built-in and external monitors'),
    });
    addPrefixIcon(configureMonitorsRow, 'video-display-symbolic');
    const configureButton = new Gtk.Button({
        label: _('Configure…'),
        valign: Gtk.Align.CENTER,
    });
    configureButton.connect('clicked', () => {
        const dialog = new MonitorConfigDialog(window, settings);
        dialog.present();
    });
    configureMonitorsRow.add_suffix(configureButton);
    configureMonitorsRow.activatable_widget = configureButton;
    brightnessGroup.add(configureMonitorsRow);

    const updateMonitorStatus = () => {
        try {
            const monitors = JSON.parse(settings.get_string('monitors'));
            if (!Array.isArray(monitors) || monitors.length === 0)
                return;

            const enabledCount = monitors.filter(m => m.enabled && m.initialized).length;
            let statusText = _('%d of %d monitors enabled')
                .replace('%d', enabledCount)
                .replace('%d', monitors.length);

            const lastDetection = settings.get_int64('monitors-last-detection');
            if (lastDetection > 0) {
                const minutes = Math.round((Date.now() - lastDetection) / 60000);
                if (minutes < 1)
                    statusText += ` • ${_('Just detected')}`;
                else if (minutes < 60)
                    statusText += ` • ${_('Last detected %d min ago').replace('%d', minutes)}`;
                else
                    statusText += ` • ${_('Last detected %d hr ago').replace('%d', Math.round(minutes / 60))}`;
            }

            configureMonitorsRow.subtitle = statusText;
        } catch {
            // Keep default subtitle if JSON is empty
        }
    };

    updateMonitorStatus();
    signalIds.push(settings.connect('changed::monitors', updateMonitorStatus));
    signalIds.push(settings.connect('changed::monitors-last-detection', updateMonitorStatus));

    const backendsGroup = new Adw.PreferencesGroup({
        title: _('D-Bus Display Backends'),
        description: _('Native GNOME session D-Bus interfaces used for brightness control'),
    });
    const recheckBtn = new Gtk.Button({
        icon_name: 'view-refresh-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: _('Re-check D-Bus backends'),
        css_classes: ['flat'],
    });
    backendsGroup.set_header_suffix(recheckBtn);
    page.add(backendsGroup);

    const builtinDiagIcon = new Gtk.Image({icon_name: 'display-brightness-symbolic'});
    const builtinDiagRow = new Adw.ActionRow({
        title: _('Built-in Display Backlight'),
        subtitle: _('Checking GNOME D-Bus backlight service…'),
    });
    builtinDiagRow.add_prefix(builtinDiagIcon);
    backendsGroup.add(builtinDiagRow);

    const externalDiagIcon = new Gtk.Image({icon_name: 'video-display-symbolic'});
    const externalDiagRow = new Adw.ActionRow({
        title: _('External Monitors (DDC/CI D-Bus)'),
        subtitle: _('Checking com.ddcutil.DdcutilService…'),
        subtitle_selectable: true,
    });
    externalDiagRow.add_prefix(externalDiagIcon);
    externalDiagRow.set_tooltip_text(DDC_SERVICE_BUS);
    backendsGroup.add(externalDiagRow);

    const refreshBackends = async () => {
        const mutterProbe = new MutterBacklightBackend(
            {id: 'builtin', name: 'Built-in Display', type: 'mutter-dbus'},
            settings
        );
        const powerProbe = new PowerScreenBackend(settings);

        const [mutterOk, powerOk, mutterExternals, ddcServiceOk] = await Promise.all([
            mutterProbe.isAvailable(cancellable),
            powerProbe.isAvailable(cancellable),
            MutterBacklightBackend.detectExternalDisplays(cancellable),
            DdcServiceBackend.isServiceAvailable(cancellable),
        ]);

        if (cancellable.is_cancelled())
            return;

        if (mutterOk) {
            builtinDiagIcon.set_from_icon_name('emblem-ok-symbolic');
            builtinDiagRow.subtitle = _('Ready via org.gnome.Mutter.DisplayConfig D-Bus');
        } else if (powerOk) {
            builtinDiagIcon.set_from_icon_name('emblem-ok-symbolic');
            builtinDiagRow.subtitle = _('Ready via org.gnome.SettingsDaemon.Power D-Bus');
        } else {
            builtinDiagIcon.set_from_icon_name('computer-symbolic');
            builtinDiagRow.subtitle = _('No internal laptop panel reported by GNOME D-Bus');
        }

        if (ddcServiceOk) {
            externalDiagIcon.set_from_icon_name('emblem-ok-symbolic');
            externalDiagRow.subtitle = _('Ready via com.ddcutil.DdcutilService D-Bus');
        } else if (mutterExternals.length > 0) {
            externalDiagIcon.set_from_icon_name('emblem-ok-symbolic');
            externalDiagRow.subtitle = _('Ready natively via org.gnome.Mutter.DisplayConfig D-Bus');
        } else {
            externalDiagIcon.set_from_icon_name('dialog-information-symbolic');
            externalDiagRow.subtitle = _(
                'Optional: install ddcutil-service (com.ddcutil.DdcutilService) for external DDC/CI displays'
            );
        }
    };

    recheckBtn.connect('clicked', () => {
        refreshBackends();
    });

    refreshBackends();

    const nightLightGroup = new Adw.PreferencesGroup({
        title: _('Night Light Control'),
    });
    page.add(nightLightGroup);

    const nightLightModel = new Gtk.StringList();
    nightLightModel.append(_('Disabled'));
    nightLightModel.append(_('Sync with Theme'));
    nightLightModel.append(_('Follow System Night Light'));
    nightLightModel.append(_('Custom Schedule'));

    const savedNlIdx = Math.max(0, NIGHT_LIGHT_MODES.indexOf(settings.get_string('night-light-mode')));
    const nightLightModeRow = new Adw.ComboRow({
        title: _('Night Light Mode'),
        model: nightLightModel,
        selected: savedNlIdx,
    });
    addPrefixIcon(nightLightModeRow, 'night-light-symbolic');
    nightLightGroup.add(nightLightModeRow);

    const nightLightStartRow = new Adw.EntryRow({
        title: _('Night Light Start Time (24-hour)'),
        text: settings.get_string('night-light-start-time'),
        show_apply_button: true,
        visible: NIGHT_LIGHT_MODES[savedNlIdx] === 'custom-schedule',
    });
    addPrefixIcon(nightLightStartRow, 'preferences-system-time-symbolic');
    nightLightGroup.add(nightLightStartRow);

    const nightLightEndRow = new Adw.EntryRow({
        title: _('Night Light End Time (24-hour)'),
        text: settings.get_string('night-light-end-time'),
        show_apply_button: true,
        visible: NIGHT_LIGHT_MODES[savedNlIdx] === 'custom-schedule',
    });
    addPrefixIcon(nightLightEndRow, 'preferences-system-time-symbolic');
    nightLightGroup.add(nightLightEndRow);

    const bindValidatedTimeRow = (entryRow, settingKey) => {
        entryRow.connect('notify::text', () => {
            if (isValidTimeString(entryRow.get_text()))
                entryRow.remove_css_class('error');
            else
                entryRow.add_css_class('error');
        });

        entryRow.connect('apply', () => {
            const text = entryRow.get_text().trim();
            if (isValidTimeString(text)) {
                entryRow.remove_css_class('error');
                settings.set_string(settingKey, text);
            } else {
                entryRow.add_css_class('error');
                window.add_toast(new Adw.Toast({
                    title: _('Use 24-hour HH:MM format (e.g. 07:00 or 19:30)'),
                    timeout: 3,
                }));
            }
        });
    };

    bindValidatedTimeRow(nightLightStartRow, 'night-light-start-time');
    bindValidatedTimeRow(nightLightEndRow, 'night-light-end-time');

    const colorSettings = getOptionalSettings('org.gnome.settings-daemon.plugins.color');
    let colorTempSignalId = null;

    if (colorSettings && settingsHasKey(colorSettings, 'night-light-temperature')) {
        const currentTemp = Math.min(4700, Math.max(1700, colorSettings.get_uint('night-light-temperature') || 2700));
        const tempRow = new Adw.SpinRow({
            title: _('Night Light Color Temperature (K)'),
            subtitle: _('Lower Kelvin values produce a warmer amber tint (1700K–4700K)'),
            adjustment: new Gtk.Adjustment({
                lower: 1700,
                upper: 4700,
                step_increment: 100,
                page_increment: 300,
                value: currentTemp,
            }),
        });
        addPrefixIcon(tempRow, 'weather-clear-night-symbolic');
        tempRow.connect('notify::value', () => {
            const val = Math.round(tempRow.value);
            if (colorSettings.get_uint('night-light-temperature') !== val)
                colorSettings.set_uint('night-light-temperature', val);
        });
        colorTempSignalId = colorSettings.connect('changed::night-light-temperature', () => {
            const val = Math.min(4700, Math.max(1700, colorSettings.get_uint('night-light-temperature') || 2700));
            if (Math.round(tempRow.value) !== val)
                tempRow.value = val;
        });
        nightLightGroup.add(tempRow);
    }

    nightLightModeRow.connect('notify::selected', () => {
        const mode = NIGHT_LIGHT_MODES[nightLightModeRow.selected] ?? 'disabled';
        settings.set_string('night-light-mode', mode);
        const isCustom = mode === 'custom-schedule';
        nightLightStartRow.visible = isCustom;
        nightLightEndRow.visible = isCustom;
    });

    return {
        page,
        destroy() {
            cancellable.cancel();
            if (colorSettings && colorTempSignalId) {
                colorSettings.disconnect(colorTempSignalId);
                colorTempSignalId = null;
            }
            for (const id of signalIds)
                settings.disconnect(id);
            signalIds.length = 0;
        },
    };
}
