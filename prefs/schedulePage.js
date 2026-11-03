import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {DARK_TRIGGERS, LIGHT_TRIGGERS} from '../constants.js';
import {debugLog, debugWarn} from '../logger.js';
import {isValidTimeString} from '../timeCalculator.js';

function getLocationSubtitle(settings) {
    const lat = settings.get_string('manual-latitude');
    const lng = settings.get_string('manual-longitude');
    const name = settings.get_string('location-name');

    if (lat && lng)
        return name || `${lat}, ${lng}`;
    return _('Not configured - using custom times');
}

function addPrefixIcon(row, iconName) {
    row.add_prefix(new Gtk.Image({icon_name: iconName}));
}

export function createSchedulePage(window, settings, uuid) {
    const cancellable = new Gio.Cancellable();
    const signalIds = [];
    let soupSession = null;
    let updatingProgrammatically = false;

    const page = new Adw.PreferencesPage({
        title: _('Schedule'),
        icon_name: 'alarm-symbolic',
    });

    const timingGroup = new Adw.PreferencesGroup({
        title: _('Theme Switch Timing'),
    });
    page.add(timingGroup);

    const timingInfoIcon = new Gtk.Image({icon_name: 'dialog-information-symbolic'});
    const timingInfoRow = new Adw.ActionRow({
        title: _('Configure your location below to use solar events'),
        subtitle: _('Solar events include sunrise, sunset, dawn, dusk, and more'),
    });
    timingInfoRow.add_prefix(timingInfoIcon);
    timingGroup.add(timingInfoRow);

    const lightTriggerModel = new Gtk.StringList();
    for (const label of [
        _('First Hint of Light (astronomical dawn)'),
        _('Early Dawn (nautical twilight)'),
        _('Dawn (civil twilight)'),
        _('Sunrise'),
        _('Sun Fully Up'),
        _('Morning Golden Hour Ends'),
        _('Solar Noon'),
        _('Custom Time'),
    ])
        lightTriggerModel.append(label);

    const savedLightIdx = LIGHT_TRIGGERS.indexOf(settings.get_string('light-mode-trigger'));
    const lightTriggerRow = new Adw.ComboRow({
        title: _('Light Mode'),
        model: lightTriggerModel,
        selected: savedLightIdx >= 0 ? savedLightIdx : 3,
    });
    addPrefixIcon(lightTriggerRow, 'weather-clear-symbolic');
    timingGroup.add(lightTriggerRow);

    const customLightTimeRow = new Adw.EntryRow({
        title: _('Light Mode Time'),
        text: settings.get_string('custom-light-time'),
        show_apply_button: true,
    });
    addPrefixIcon(customLightTimeRow, 'preferences-system-time-symbolic');
    timingGroup.add(customLightTimeRow);

    const darkTriggerModel = new Gtk.StringList();
    for (const label of [
        _('Solar Noon'),
        _('Evening Golden Hour Begins'),
        _('Sunset Begins'),
        _('Sunset'),
        _('Dusk (civil twilight)'),
        _('Late Dusk (nautical twilight)'),
        _('Nightfall (astronomical dusk)'),
        _('Solar Midnight'),
        _('Custom Time'),
    ])
        darkTriggerModel.append(label);

    const savedDarkIdx = DARK_TRIGGERS.indexOf(settings.get_string('dark-mode-trigger'));
    const darkTriggerRow = new Adw.ComboRow({
        title: _('Dark Mode'),
        model: darkTriggerModel,
        selected: savedDarkIdx >= 0 ? savedDarkIdx : 3,
    });
    addPrefixIcon(darkTriggerRow, 'weather-clear-night-symbolic');
    timingGroup.add(darkTriggerRow);

    const customDarkTimeRow = new Adw.EntryRow({
        title: _('Dark Mode Time'),
        text: settings.get_string('custom-dark-time'),
        show_apply_button: true,
    });
    addPrefixIcon(customDarkTimeRow, 'preferences-system-time-symbolic');
    timingGroup.add(customDarkTimeRow);

    const locationGroup = new Adw.PreferencesGroup({
        title: _('Configure Location'),
    });
    page.add(locationGroup);

    const locationExpander = new Adw.ExpanderRow({
        title: _('Location Settings'),
        subtitle: getLocationSubtitle(settings),
        show_enable_switch: false,
    });
    addPrefixIcon(locationExpander, 'mark-location-symbolic');
    locationGroup.add(locationExpander);

    const latitudeRow = new Adw.EntryRow({
        title: _('Latitude'),
        text: settings.get_string('manual-latitude'),
        input_purpose: Gtk.InputPurpose.NUMBER,
    });
    locationExpander.add_row(latitudeRow);

    const longitudeRow = new Adw.EntryRow({
        title: _('Longitude'),
        text: settings.get_string('manual-longitude'),
        input_purpose: Gtk.InputPurpose.NUMBER,
    });
    locationExpander.add_row(longitudeRow);

    const autoDetectRow = new Adw.ActionRow({
        title: _('Detect My Location'),
        subtitle: settings.get_string('location-name') ||
            _('Automatically detect your approximate location'),
    });

    const infoIcon = new Gtk.Image({
        icon_name: 'dialog-information-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: [
            _('About Auto-Detection:'),
            '',
            _('Uses native Linux GeoClue2 service for coordinates'),
            _('Falls back to ipinfo.io if GeoClue2 is unavailable'),
            _('Reverse geocoding via OpenStreetMap for city name'),
        ].join('\n'),
    });

    const spinner = new Gtk.Spinner({
        valign: Gtk.Align.CENTER,
        visible: false,
    });

    const detectButton = new Gtk.Button({
        label: _('Detect'),
        valign: Gtk.Align.CENTER,
        css_classes: ['suggested-action'],
    });

    autoDetectRow.add_suffix(infoIcon);
    autoDetectRow.add_suffix(spinner);
    autoDetectRow.add_suffix(detectButton);
    autoDetectRow.activatable_widget = detectButton;
    locationExpander.add_row(autoDetectRow);

    let lastLat = settings.get_string('manual-latitude');
    let lastLng = settings.get_string('manual-longitude');

    settings.bind('manual-latitude', latitudeRow, 'text', Gio.SettingsBindFlags.DEFAULT);
    settings.bind('manual-longitude', longitudeRow, 'text', Gio.SettingsBindFlags.DEFAULT);

    latitudeRow.connect('notify::text', () => {
        const cur = latitudeRow.get_text();
        if (updatingProgrammatically) {
            lastLat = cur;
            return;
        }
        if (cur !== lastLat) {
            lastLat = cur;
            settings.set_string('location-name', '');
            autoDetectRow.subtitle = _('Automatically detect your approximate location');
        }
    });

    longitudeRow.connect('notify::text', () => {
        const cur = longitudeRow.get_text();
        if (updatingProgrammatically) {
            lastLng = cur;
            return;
        }
        if (cur !== lastLng) {
            lastLng = cur;
            settings.set_string('location-name', '');
            autoDetectRow.subtitle = _('Automatically detect your approximate location');
        }
    });

    const updateTriggerVisibility = () => {
        const lat = settings.get_string('manual-latitude').trim();
        const lng = settings.get_string('manual-longitude').trim();
        const hasCoords = lat !== '' && lng !== '';

        if (hasCoords) {
            timingInfoIcon.set_from_icon_name('emblem-ok-symbolic');
            timingInfoRow.title = _('Location configured');
            timingInfoRow.subtitle = _('Solar events are now available for automatic theme switching');
            lightTriggerRow.visible = true;
            darkTriggerRow.visible = true;
            customLightTimeRow.visible = LIGHT_TRIGGERS[lightTriggerRow.selected] === 'custom';
            customDarkTimeRow.visible = DARK_TRIGGERS[darkTriggerRow.selected] === 'custom';
        } else {
            timingInfoIcon.set_from_icon_name('dialog-information-symbolic');
            timingInfoRow.title = _('Configure your location below to use solar events');
            timingInfoRow.subtitle = _('Solar events include sunrise, sunset, dawn, dusk, and more');
            lightTriggerRow.visible = false;
            darkTriggerRow.visible = false;
            customLightTimeRow.visible = true;
            customDarkTimeRow.visible = true;
        }
    };

    updateTriggerVisibility();

    const syncLocationSubtitle = () => {
        locationExpander.subtitle = getLocationSubtitle(settings);
        updateTriggerVisibility();
    };

    signalIds.push(settings.connect('changed::manual-latitude', syncLocationSubtitle));
    signalIds.push(settings.connect('changed::manual-longitude', syncLocationSubtitle));
    signalIds.push(settings.connect('changed::location-name', syncLocationSubtitle));

    lightTriggerRow.connect('notify::selected', () => {
        const val = LIGHT_TRIGGERS[lightTriggerRow.selected] ?? 'sunrise';
        settings.set_string('light-mode-trigger', val);
        updateTriggerVisibility();
    });

    darkTriggerRow.connect('notify::selected', () => {
        const val = DARK_TRIGGERS[darkTriggerRow.selected] ?? 'sunset';
        settings.set_string('dark-mode-trigger', val);
        updateTriggerVisibility();
    });

    const bindValidatedTimeRow = (entryRow, settingKey) => {
        entryRow.connect('notify::text', () => {
            const valid = isValidTimeString(entryRow.get_text());
            if (valid)
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

    bindValidatedTimeRow(customLightTimeRow, 'custom-light-time');
    bindValidatedTimeRow(customDarkTimeRow, 'custom-dark-time');

    const applyDetectedLocation = (latStr, lngStr, locName) => {
        if (cancellable.is_cancelled())
            return;

        updatingProgrammatically = true;
        latitudeRow.set_text(latStr);
        longitudeRow.set_text(lngStr);
        settings.set_string('location-name', locName);
        autoDetectRow.subtitle = locName;
        locationExpander.subtitle = locName;
        updatingProgrammatically = false;

        window.add_toast(new Adw.Toast({
            title: `${_('Location detected')}: ${locName}`,
            timeout: 3,
        }));
    };

    const reverseGeocode = async (Soup, session, latStr, lngStr) => {
        const url =
            `https://nominatim.openstreetmap.org/reverse?format=json&lat=${latStr}&lon=${lngStr}&zoom=10`;
        const msg = Soup.Message.new('GET', url);
        msg.request_headers.append(
            'User-Agent',
            'SGC-NOVUS-Tools/2.0 (https://github.com/SGC-NOVUS/novus-tools)'
        );

        try {
            const bytes = await new Promise((resolve, reject) => {
                session.send_and_read_async(
                    msg,
                    GLib.PRIORITY_DEFAULT,
                    cancellable,
                    (sess, res) => {
                        try {
                            resolve(sess.send_and_read_finish(res));
                        } catch (e) {
                            reject(e);
                        }
                    }
                );
            });

            const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
            if (data.address) {
                const parts = [];
                const locality = data.address.city || data.address.town || data.address.village;
                if (locality)
                    parts.push(locality);
                if (data.address.state)
                    parts.push(data.address.state);
                if (data.address.country)
                    parts.push(data.address.country);
                if (parts.length > 0)
                    return parts.join(', ');
            }
        } catch (e) {
            debugWarn(`Reverse geocoding skipped: ${e.message}`);
        }

        return _('Location detected');
    };

    const detectLocation = async () => {
        detectButton.sensitive = false;
        spinner.visible = true;
        spinner.start();

        try {
            let coords = null;

            try {
                const {default: Geoclue} = await import('gi://Geoclue?version=2.0');
                const simple = await new Promise((resolve, reject) => {
                    Geoclue.Simple.new(
                        uuid,
                        Geoclue.AccuracyLevel.CITY,
                        cancellable,
                        (_src, res) => {
                            try {
                                resolve(Geoclue.Simple.new_finish(res));
                            } catch (e) {
                                reject(e);
                            }
                        }
                    );
                });
                const loc = simple?.get_location();
                if (loc && (loc.latitude !== 0 || loc.longitude !== 0)) {
                    coords = {
                        lat: loc.latitude.toFixed(4),
                        lng: loc.longitude.toFixed(4),
                    };
                    debugLog(`GeoClue2 resolved ${coords.lat}, ${coords.lng}`);
                }
            } catch (e) {
                debugLog(`GeoClue2 unavailable (${e.message}), falling back to ipinfo.io`);
            }

            const {default: Soup} = await import('gi://Soup?version=3.0');
            soupSession = new Soup.Session();

            if (!coords) {
                const locMsg = Soup.Message.new('GET', 'https://ipinfo.io/loc');
                const bytes = await new Promise((resolve, reject) => {
                    soupSession.send_and_read_async(
                        locMsg,
                        GLib.PRIORITY_DEFAULT,
                        cancellable,
                        (sess, res) => {
                            try {
                                resolve(sess.send_and_read_finish(res));
                            } catch (e) {
                                reject(e);
                            }
                        }
                    );
                });

                const status = locMsg.get_status();
                if (status === 429) {
                    throw new Error(
                        _('Rate limit exceeded. Please try again tomorrow or enter coordinates manually.')
                    );
                }
                if (status !== 200)
                    throw new Error(_('Location service returned error %d').replace('%d', status));

                const raw = new TextDecoder().decode(bytes.get_data()).trim();
                const [lat, lng] = raw.split(',');
                if (!lat || !lng)
                    throw new Error(_('Invalid location data received'));

                coords = {lat: lat.trim(), lng: lng.trim()};
            }

            const locName = await reverseGeocode(Soup, soupSession, coords.lat, coords.lng);
            applyDetectedLocation(coords.lat, coords.lng, locName);
        } catch (e) {
            if (!cancellable.is_cancelled()) {
                window.add_toast(new Adw.Toast({
                    title: `${_('Location Detection Failed')}: ${
                        e.message || _('Unable to detect your location. Please enter coordinates manually.')
                    }`,
                    timeout: 5,
                }));
            }
        } finally {
            if (!cancellable.is_cancelled()) {
                spinner.stop();
                spinner.visible = false;
                detectButton.sensitive = true;
            }
        }
    };

    detectButton.connect('clicked', () => {
        detectLocation();
    });

    return {
        page,
        destroy() {
            cancellable.cancel();
            if (soupSession) {
                soupSession.abort();
                soupSession = null;
            }
            for (const id of signalIds)
                settings.disconnect(id);
            signalIds.length = 0;
        },
    };
}
