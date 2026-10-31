import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {BRIGHTNESS_TRANSITION_DURATIONS} from '../constants.js';
import {
    DDC_SERVICE_BUS,
    DdcServiceBackend,
    isBuiltinMonitor,
    probeDisplayController,
} from '../displayController.js';
import {BrightnessSliderRow} from './brightnessSliderRow.js';
import {DisplayManager} from './displayManager.js';
import {debugLog, debugWarn} from '../logger.js';

export class MonitorConfigDialog {
    constructor(parentWindow, settings) {
        this._parentWindow = parentWindow;
        this._settings = settings;
        this._displayManager = new DisplayManager(settings);
        this._cancellable = new Gio.Cancellable();

        this._dialog = null;
        this._toastOverlay = null;
        this._builtinGroup = null;
        this._externalGroup = null;
        this._ddcInfoGroup = null;
        this._refreshButton = null;

        this._detectionInProgress = false;
        this._builtinWidgets = [];
        this._externalWidgets = [];
        this._monitors = new Map();
        this._sliders = [];
        this._debounceTimers = new Map();
    }

    show() {
        this._createDialog();
        this._buildContent();
        this._dialog.present();
        this._loadMonitors();
    }

    _createDialog() {
        this._dialog = new Adw.Window({
            title: _('Monitor Configuration'),
            modal: true,
            transient_for: this._parentWindow,
            default_width: 680,
            default_height: 580,
        });

        this._toastOverlay = new Adw.ToastOverlay();
        this._contentBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 0,
        });

        this._toastOverlay.set_child(this._contentBox);
        this._dialog.set_content(this._toastOverlay);

        this._dialog.connect('close-request', () => {
            this._cleanup();
            return false;
        });
    }

    _clearDebounceTimer(timerKey) {
        const existing = this._debounceTimers.get(timerKey);
        if (existing) {
            GLib.Source.remove(existing);
            this._debounceTimers.delete(timerKey);
        }
    }

    _cleanup() {
        this._cancellable.cancel();

        for (const timeoutId of this._debounceTimers.values())
            GLib.Source.remove(timeoutId);
        this._debounceTimers.clear();

        this._destroySliders();
        this._monitors.clear();
        this._builtinWidgets = [];
        this._externalWidgets = [];
    }

    _destroySliders() {
        for (const slider of this._sliders)
            slider.destroy();
        this._sliders = [];
    }

    _buildContent() {
        const headerBar = new Adw.HeaderBar();
        this._contentBox.append(headerBar);

        this._refreshButton = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            tooltip_text: _('Detect external monitors'),
        });
        this._refreshButton.connect('clicked', () => this._refreshExternalMonitors());
        headerBar.pack_start(this._refreshButton);

        const scrolled = new Gtk.ScrolledWindow({
            vexpand: true,
            hexpand: true,
        });
        this._contentBox.append(scrolled);

        const clamp = new Adw.Clamp({
            maximum_size: 760,
            tightening_threshold: 580,
        });
        scrolled.set_child(clamp);

        const mainBox = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 24,
            margin_top: 24,
            margin_bottom: 24,
            margin_start: 12,
            margin_end: 12,
        });
        clamp.set_child(mainBox);

        mainBox.append(this._buildTransitionsGroup());

        this._builtinGroup = new Adw.PreferencesGroup({
            title: _('Built-in Display'),
        });
        mainBox.append(this._builtinGroup);

        this._externalGroup = new Adw.PreferencesGroup({
            title: _('External Monitors'),
            description: _('Each monitor can use independent day and night brightness levels'),
        });
        mainBox.append(this._externalGroup);

        this._ddcInfoGroup = this._buildDdcServiceInfoGroup();
        mainBox.append(this._ddcInfoGroup);
    }

    _buildTransitionsGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('Brightness Transitions'),
            description: _('Gradually adjust brightness before theme changes'),
        });

        const addDurationCombo = (title, subtitle, enabledKey, durationKey) => {
            const model = new Gtk.StringList();
            for (const item of BRIGHTNESS_TRANSITION_DURATIONS)
                model.append(_(item.label));

            const row = new Adw.ComboRow({title, subtitle, model});
            const enabled = this._settings.get_boolean(enabledKey);
            const savedVal = this._settings.get_int(durationKey);

            if (!enabled) {
                row.selected = 0;
            } else {
                const idx = BRIGHTNESS_TRANSITION_DURATIONS.findIndex(d => d.value === savedVal);
                row.selected = idx >= 0 ? idx : 5;
            }

            row.connect('notify::selected', () => {
                const entry = BRIGHTNESS_TRANSITION_DURATIONS[row.selected];
                if (!entry)
                    return;

                if (entry.value === 0) {
                    this._settings.set_boolean(enabledKey, false);
                } else {
                    this._settings.set_boolean(enabledKey, true);
                    this._settings.set_int(durationKey, entry.value);
                }
            });

            group.add(row);
        };

        addDurationCombo(
            _('Gradual brightening'),
            _('Gradually increase brightness before light mode'),
            'gradual-brightness-increase-enabled',
            'gradual-brightness-increase-duration'
        );

        addDurationCombo(
            _('Gradual dimming'),
            _('Gradually decrease brightness before dark mode'),
            'gradual-brightness-decrease-enabled',
            'gradual-brightness-decrease-duration'
        );

        return group;
    }

    _buildDdcServiceInfoGroup() {
        const group = new Adw.PreferencesGroup({
            title: _('External Monitor D-Bus Service'),
            visible: false,
        });

        const row = new Adw.ActionRow({
            title: _('ddcutil-service Not Detected'),
            subtitle: _(
                'External DDC/CI monitors not managed natively by Mutter require the ' +
                'com.ddcutil.DdcutilService session D-Bus service (package: ddcutil-service) ' +
                'and read/write access to /dev/i2c-*.'
            ),
            subtitle_selectable: true,
        });
        row.add_prefix(new Gtk.Image({icon_name: 'dialog-information-symbolic'}));
        row.set_tooltip_text(DDC_SERVICE_BUS);
        group.add(row);

        return group;
    }

    _clearGroupWidgets(group, trackedList) {
        for (const widget of trackedList)
            group.remove(widget);
        trackedList.length = 0;
    }

    async _loadMonitors() {
        const monitors = await this._displayManager.ensureBuiltinMonitor(this._cancellable);
        if (this._cancellable.is_cancelled())
            return;

        const ddcAvailable = await DdcServiceBackend.isServiceAvailable(this._cancellable);
        if (this._cancellable.is_cancelled())
            return;

        this._ddcInfoGroup.visible = !ddcAvailable;
        this._renderMonitors(monitors);
    }

    async _refreshExternalMonitors() {
        if (this._detectionInProgress)
            return;

        this._detectionInProgress = true;
        this._refreshButton.sensitive = false;

        this._clearGroupWidgets(this._externalGroup, this._externalWidgets);
        const loadingRow = new Adw.ActionRow({
            title: _('Detecting external monitors…'),
            subtitle: _('Querying Mutter and DdcutilService over D-Bus'),
        });
        const spinner = new Gtk.Spinner({spinning: true, valign: Gtk.Align.CENTER});
        loadingRow.add_prefix(spinner);
        this._externalGroup.add(loadingRow);
        this._externalWidgets.push(loadingRow);

        try {
            const [ddcAvailable, detectedExternals] = await Promise.all([
                DdcServiceBackend.isServiceAvailable(this._cancellable),
                this._displayManager.detectExternalMonitors(this._cancellable),
            ]);

            if (this._cancellable.is_cancelled())
                return;

            this._ddcInfoGroup.visible = !ddcAvailable && detectedExternals.length === 0;

            const cached = await this._displayManager.ensureBuiltinMonitor(this._cancellable);
            const merged = this._displayManager.mergeMonitors(detectedExternals, cached);
            const missing = this._displayManager.findMissingMonitors(detectedExternals, cached);
            const allMonitors = [...merged, ...missing];

            this._displayManager.saveMonitors(allMonitors, true);
            this._renderMonitors(allMonitors, missing);

            this._toastOverlay.add_toast(new Adw.Toast({
                title: detectedExternals.length > 0
                    ? _('Detected %d external monitor(s)').replace('%d', detectedExternals.length)
                    : _('No external DDC/CI monitors detected'),
                timeout: 3,
            }));
        } catch (e) {
            debugWarn(`NovusDayNight: Monitor detection failed: ${e.message}`);
        } finally {
            this._detectionInProgress = false;
            if (this._refreshButton)
                this._refreshButton.sensitive = true;
        }
    }

    _renderMonitors(monitors, missingList = []) {
        this._destroySliders();
        this._clearGroupWidgets(this._builtinGroup, this._builtinWidgets);
        this._clearGroupWidgets(this._externalGroup, this._externalWidgets);
        this._monitors.clear();

        for (const monitor of monitors)
            this._monitors.set(monitor.id, {...monitor});

        const missingIds = new Set(missingList.map(m => m.id));
        const builtin = monitors.find(m => isBuiltinMonitor(m));
        const externals = monitors.filter(m => !isBuiltinMonitor(m));

        this._builtinGroup.visible = Boolean(builtin);
        if (builtin) {
            const row = this._createMonitorRow(builtin, true, false);
            this._builtinGroup.add(row);
            this._builtinWidgets.push(row);
        }

        if (externals.length === 0) {
            const emptyRow = new Adw.ActionRow({
                title: _('No external monitors configured'),
                subtitle: _('Click the refresh button in the header bar to scan for external displays'),
            });
            emptyRow.add_prefix(new Gtk.Image({icon_name: 'video-display-symbolic'}));
            this._externalGroup.add(emptyRow);
            this._externalWidgets.push(emptyRow);
            return;
        }

        for (const ext of externals) {
            const row = this._createMonitorRow(ext, false, missingIds.has(ext.id));
            this._externalGroup.add(row);
            this._externalWidgets.push(row);
        }
    }

    _buildMonitorSubtitle(monitor, isBuiltin, isMissing) {
        if (isBuiltin)
            return _('Laptop or integrated panel via GNOME D-Bus');

        const details = [];
        if (monitor.connector)
            details.push(monitor.connector);
        else if (monitor.displayNumber)
            details.push(_('Display %d').replace('%d', monitor.displayNumber));

        if (monitor.serialNumber)
            details.push(`SN: ${monitor.serialNumber}`);
        if (isMissing)
            details.push(_('Disconnected'));

        return details.join(' • ');
    }

    _createMonitorRow(monitor, isBuiltin, isMissing) {
        const title = isBuiltin ? _('Built-in Display') : monitor.name;
        const subtitle = this._buildMonitorSubtitle(monitor, isBuiltin, isMissing);

        if (!monitor.initialized) {
            const row = new Adw.ActionRow({
                title,
                subtitle,
                sensitive: !isMissing,
            });
            row.add_prefix(new Gtk.Image({
                icon_name: isBuiltin ? 'computer-symbolic' : 'video-display-symbolic',
            }));

            const initButton = new Gtk.Button({
                label: _('Initialize…'),
                valign: Gtk.Align.CENTER,
                css_classes: ['suggested-action'],
            });
            initButton.connect('clicked', () => this._initializeMonitor(monitor.id, initButton));
            row.add_suffix(initButton);
            row.activatable_widget = initButton;
            return row;
        }

        const expander = new Adw.ExpanderRow({
            title,
            subtitle,
            show_enable_switch: true,
            enable_expansion: Boolean(monitor.enabled),
            expanded: Boolean(monitor.enabled),
            sensitive: !isMissing,
        });

        expander.connect('notify::enable-expansion', () => {
            const state = this._monitors.get(monitor.id);
            if (!state)
                return;
            state.enabled = expander.enable_expansion;
            expander.expanded = state.enabled;
            this._persistCurrentMonitors();
        });

        if (!isBuiltin && isMissing) {
            const removeRow = new Adw.ActionRow({
                title: _('Remove Saved Monitor'),
                subtitle: _('Delete stored brightness settings for this disconnected display'),
            });
            const removeBtn = new Gtk.Button({
                label: _('Remove'),
                valign: Gtk.Align.CENTER,
                css_classes: ['destructive-action'],
            });
            removeBtn.connect('clicked', () => {
                this._monitors.delete(monitor.id);
                this._persistCurrentMonitors();
                this._renderMonitors(Array.from(this._monitors.values()));
            });
            removeRow.add_suffix(removeBtn);
            expander.add_row(removeRow);
        }

        probeDisplayController(monitor, this._settings, this._cancellable)
            .then(controller => {
                if (this._cancellable.is_cancelled())
                    return;
                this._attachSliders(expander, monitor, controller);
            })
            .catch(e => {
                debugWarn(`NovusDayNight: Could not probe controller for ${monitor.name}: ${e.message}`);
            });

        return expander;
    }

    _attachSliders(expander, monitor, controller) {
        const displayName = isBuiltinMonitor(monitor) ? _('Built-in Display') : monitor.name;

        const addModeSlider = (rowTitle, rowSubtitle, propName, fallbackVal) => {
            const slider = new BrightnessSliderRow(
                rowTitle,
                rowSubtitle,
                null,
                controller,
                this._toastOverlay,
                displayName
            );
            this._sliders.push(slider);

            const adjustment = slider.getAdjustment();
            adjustment.set_value(monitor[propName] ?? fallbackVal);

            const timerKey = `${monitor.id}:${propName}`;
            adjustment.connect('value-changed', () => {
                const newVal = Math.round(adjustment.get_value());
                const state = this._monitors.get(monitor.id);
                if (!state)
                    return;

                state[propName] = newVal;
                this._clearDebounceTimer(timerKey);
                const id = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                    this._debounceTimers.delete(timerKey);
                    this._persistCurrentMonitors();
                    return GLib.SOURCE_REMOVE;
                });
                this._debounceTimers.set(timerKey, id);
            });

            expander.add_row(slider.getWidget());
        };

        addModeSlider(
            _('Light Mode Brightness'),
            _('Screen brightness during daytime (%)'),
            'lightBrightness',
            80
        );

        addModeSlider(
            _('Dark Mode Brightness'),
            _('Screen brightness at night (%)'),
            'darkBrightness',
            30
        );
    }

    async _initializeMonitor(monitorId, button) {
        const state = this._monitors.get(monitorId);
        if (!state)
            return;

        button.sensitive = false;
        button.label = _('Reading…');

        try {
            const controller = await probeDisplayController(state, this._settings, this._cancellable);
            const current = await controller.getBrightness(this._cancellable);
            if (this._cancellable.is_cancelled())
                return;

            const baseBrightness = current ?? 70;
            state.lightBrightness = Math.max(10, Math.min(100, baseBrightness));
            state.darkBrightness = Math.max(5, Math.min(100, Math.round(baseBrightness * 0.5)));
            state.initialized = true;
            state.enabled = true;

            this._persistCurrentMonitors();
            this._renderMonitors(Array.from(this._monitors.values()));
            debugLog(`NovusDayNight: Initialized ${state.name} at ${baseBrightness}%`);
        } catch (e) {
            debugWarn(`NovusDayNight: Failed to initialize ${state.name}: ${e.message}`);
            button.sensitive = true;
            button.label = _('Initialize…');
        }
    }

    _persistCurrentMonitors() {
        this._displayManager.saveMonitors(Array.from(this._monitors.values()), false);
    }
}
