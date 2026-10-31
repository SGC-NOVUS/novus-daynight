import Adw from 'gi://Adw';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {debugLog, debugWarn} from '../logger.js';

export class BrightnessSliderRow {
    constructor(title, subtitle, settingsKey, displayController, toastHost, monitorName) {
        this._title = title;
        this._subtitle = subtitle;
        this._settingsKey = settingsKey;
        this._controller = displayController;
        this._toastHost = toastHost;
        this._monitorName = monitorName;

        this._originalBrightness = null;
        this._brightnessQueryPromise = null;
        this._isGrabbed = false;
        this._previewToast = null;

        this._prevNonPreviewValue = null;
        this._currNonPreviewValue = null;
        this._recentNonPreviewChange = false;
        this._clearRecentChangeId = null;

        this._lastPreviewUpdate = 0;
        this._previewThrottleMs = 200;
        this._pendingPreviewValue = null;
        this._previewTimeoutId = null;

        this._brightnessInFlight = false;
        this._latestDesiredBrightness = null;
        this._lastPreviewPromise = null;

        this._buildWidget();
        this._setupPreviewHandlers();
    }

    _buildWidget() {
        this._row = new Adw.ActionRow({
            title: this._title,
            subtitle: this._subtitle,
        });

        const initialValue = this._settingsKey
            ? this._controller.settings.get_int(this._settingsKey)
            : 50;

        this._adjustment = new Gtk.Adjustment({
            lower: 1,
            upper: 100,
            step_increment: 1,
            page_increment: 10,
            value: initialValue,
        });

        this._prevNonPreviewValue = initialValue;
        this._currNonPreviewValue = initialValue;

        this._scale = new Gtk.Scale({
            orientation: Gtk.Orientation.HORIZONTAL,
            draw_value: true,
            value_pos: Gtk.PositionType.RIGHT,
            digits: 0,
            hexpand: true,
            valign: Gtk.Align.CENTER,
            adjustment: this._adjustment,
        });

        this._scaleBox = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            hexpand: true,
            valign: Gtk.Align.CENTER,
        });
        this._scaleBox.append(this._scale);
        this._row.add_suffix(this._scaleBox);
    }

    _clearPreviewTimer() {
        if (this._previewTimeoutId) {
            GLib.Source.remove(this._previewTimeoutId);
            this._previewTimeoutId = null;
        }
    }

    _clearRecentChangeIdle() {
        if (this._clearRecentChangeId) {
            GLib.Source.remove(this._clearRecentChangeId);
            this._clearRecentChangeId = null;
        }
    }

    _setupPreviewHandlers() {
        this._gesture = new Gtk.GestureClick();
        this._gesture.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
        this._scaleBox.add_controller(this._gesture);

        this._gesture.connect('pressed', () => this._onPreviewStart());
        this._gesture.connect('end', () => this._onPreviewEnd());

        this._valueChangedId = this._adjustment.connect('value-changed', () => {
            this._onPreviewUpdate();
        });

        const focusController = new Gtk.EventControllerFocus();
        focusController.connect('leave', () => {
            if (this._isGrabbed)
                this._onPreviewEnd();
        });
        this._scale.add_controller(focusController);
    }

    _onPreviewStart() {
        if (this._isGrabbed || !this._controller)
            return;

        this._isGrabbed = true;

        const fallbackValue = this._recentNonPreviewChange
            ? this._prevNonPreviewValue
            : this._currNonPreviewValue;
        this._recentNonPreviewChange = false;

        this._brightnessQueryPromise = this._controller.getBrightness().then(current => {
            this._originalBrightness = current ?? fallbackValue;
            return this._originalBrightness;
        }).catch(e => {
            debugWarn(`NovusDayNight: Failed to read brightness before preview: ${e.message}`);
            this._originalBrightness = fallbackValue;
            return this._originalBrightness;
        });

        if (this._previewToast)
            this._previewToast.dismiss();

        this._previewToast = new Adw.Toast({
            title: _('Previewing brightness on %s').replace('%s', this._monitorName),
            timeout: 0,
        });
        this._toastHost?.add_toast(this._previewToast);
    }

    _onPreviewUpdate() {
        if (!this._isGrabbed) {
            this._prevNonPreviewValue = this._currNonPreviewValue;
            this._currNonPreviewValue = Math.round(this._adjustment.get_value());
            this._recentNonPreviewChange = true;

            this._clearRecentChangeIdle();
            this._clearRecentChangeId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                this._recentNonPreviewChange = false;
                this._clearRecentChangeId = null;
                return GLib.SOURCE_REMOVE;
            });
            return;
        }

        const value = Math.round(this._adjustment.get_value());
        const elapsed = Date.now() - this._lastPreviewUpdate;
        this._pendingPreviewValue = value;

        if (elapsed >= this._previewThrottleMs) {
            this._applyPreviewBrightness(value);
            return;
        }

        this._clearPreviewTimer();
        this._previewTimeoutId = GLib.timeout_add(
            GLib.PRIORITY_DEFAULT,
            this._previewThrottleMs - elapsed,
            () => {
                this._previewTimeoutId = null;
                if (this._isGrabbed && this._pendingPreviewValue !== null) {
                    this._applyPreviewBrightness(this._pendingPreviewValue);
                    this._pendingPreviewValue = null;
                }
                return GLib.SOURCE_REMOVE;
            }
        );
    }

    _applyPreviewBrightness(value) {
        this._lastPreviewUpdate = Date.now();
        this._latestDesiredBrightness = value;

        if (!this._brightnessInFlight)
            this._processNextBrightness();
    }

    async _processNextBrightness() {
        if (this._latestDesiredBrightness === null || this._brightnessInFlight)
            return;

        if (!this._isGrabbed || !this._controller) {
            this._latestDesiredBrightness = null;
            return;
        }

        if (this._brightnessQueryPromise) {
            await this._brightnessQueryPromise;
            if (!this._isGrabbed || this._latestDesiredBrightness === null || !this._controller)
                return;
        }

        const target = this._latestDesiredBrightness;
        this._latestDesiredBrightness = null;
        this._brightnessInFlight = true;

        try {
            this._lastPreviewPromise = this._controller.setBrightness(target);
            await this._lastPreviewPromise;
        } catch (e) {
            debugWarn(`NovusDayNight: Preview setBrightness error: ${e.message}`);
        }

        this._brightnessInFlight = false;

        if (this._latestDesiredBrightness !== null && this._isGrabbed)
            this._processNextBrightness();
    }

    _onPreviewEnd() {
        if (!this._isGrabbed)
            return;

        this._clearPreviewTimer();
        this._clearRecentChangeIdle();

        this._isGrabbed = false;
        this._pendingPreviewValue = null;
        this._recentNonPreviewChange = false;

        const finalValue = Math.round(this._adjustment.get_value());
        if (this._settingsKey && this._controller)
            this._controller.settings.set_int(this._settingsKey, finalValue);

        if (this._previewToast) {
            this._previewToast.dismiss();
            this._previewToast = null;
        }

        this._restoreOriginalBrightness();
    }

    async _restoreOriginalBrightness() {
        this._latestDesiredBrightness = null;

        if (this._originalBrightness === null && this._brightnessQueryPromise)
            await this._brightnessQueryPromise;

        this._brightnessQueryPromise = null;

        if (this._lastPreviewPromise || this._brightnessInFlight) {
            try {
                if (this._lastPreviewPromise)
                    await this._lastPreviewPromise;
            } catch {
                // Handled in preview loop
            }
            this._lastPreviewPromise = null;
            this._brightnessInFlight = false;
        }

        if (this._originalBrightness === null || !this._controller)
            return;

        const brightnessToRestore = this._originalBrightness;
        this._originalBrightness = null;

        try {
            await this._controller.setBrightness(brightnessToRestore);
            debugLog(`NovusDayNight: Restored brightness on ${this._monitorName}`);
            this._toastHost?.add_toast(new Adw.Toast({
                title: _('Brightness restored on %s').replace('%s', this._monitorName),
                timeout: 2,
            }));
        } catch (e) {
            debugWarn(`NovusDayNight: Failed to restore brightness on ${this._monitorName}: ${e.message}`);
            this._toastHost?.add_toast(new Adw.Toast({
                title: _('Failed to restore brightness on %s').replace('%s', this._monitorName),
                timeout: 3,
            }));
        }
    }

    getWidget() {
        return this._row;
    }

    getAdjustment() {
        return this._adjustment;
    }

    destroy() {
        if (this._isGrabbed && this._originalBrightness !== null && this._controller) {
            this._controller.setBrightness(this._originalBrightness).catch(() => {});
            this._isGrabbed = false;
        }

        this._clearPreviewTimer();
        this._clearRecentChangeIdle();

        if (this._previewToast) {
            this._previewToast.dismiss();
            this._previewToast = null;
        }

        if (this._valueChangedId && this._adjustment) {
            this._adjustment.disconnect(this._valueChangedId);
            this._valueChangedId = null;
        }

        this._gesture = null;
        this._row = null;
        this._adjustment = null;
        this._scale = null;
        this._scaleBox = null;
        this._controller = null;
        this._toastHost = null;
        this._originalBrightness = null;
        this._brightnessQueryPromise = null;
        this._lastPreviewPromise = null;
        this._latestDesiredBrightness = null;
    }
}
