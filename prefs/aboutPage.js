import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

function addLinkRow(group, title, url, buttonLabel, iconName = null, subtitle = null) {
    const row = new Adw.ActionRow({
        title,
        subtitle: subtitle ?? url,
    });
    if (iconName)
        row.add_prefix(new Gtk.Image({icon_name: iconName}));

    const btn = new Gtk.Button({
        label: buttonLabel,
        valign: Gtk.Align.CENTER,
        tooltip_text: url,
    });
    btn.connect('clicked', () => {
        Gio.AppInfo.launch_default_for_uri(url, null);
    });
    row.add_suffix(btn);
    row.activatable_widget = btn;
    group.add(row);
}

const TRANSIENT_KEYS = new Set([
    'manual-mode-active',
    'manual-mode-is-dark',
    'calculated-sunrise',
    'calculated-sunset',
    'next-switch-time',
    'next-switch-mode',
    'monitors-last-detection',
]);

function serializeSettings(settings, metadata) {
    const keys = settings.settings_schema.list_keys().sort();
    const values = {};
    for (const key of keys) {
        if (TRANSIENT_KEYS.has(key))
            continue;
        values[key] = settings.get_value(key).deepUnpack();
    }
    return JSON.stringify({
        schema: 'org.gnome.shell.extensions.novus-daynight',
        uuid: metadata.uuid,
        exportedAt: new Date().toISOString(),
        settings: values,
    }, null, 2);
}

function applyImportedSettings(settings, payload) {
    if (!payload || typeof payload !== 'object' || typeof payload.settings !== 'object')
        throw new Error('Invalid configuration format');

    const schema = settings.settings_schema;
    const validKeys = new Set(schema.list_keys());
    let appliedCount = 0;

    for (const [key, val] of Object.entries(payload.settings)) {
        if (!validKeys.has(key) || TRANSIENT_KEYS.has(key))
            continue;

        const typeStr = schema.get_key(key).get_value_type().dup_string();
        try {
            if (typeStr === 'b' && typeof val === 'boolean') {
                settings.set_boolean(key, val);
                appliedCount++;
            } else if (typeStr === 's' && typeof val === 'string') {
                settings.set_string(key, val);
                appliedCount++;
            } else if (typeStr === 'i' && typeof val === 'number' && Number.isFinite(val)) {
                settings.set_int(key, Math.round(val));
                appliedCount++;
            } else if (typeStr === 'd' && typeof val === 'number' && Number.isFinite(val)) {
                settings.set_double(key, val);
                appliedCount++;
            } else if (typeStr === 'x' && typeof val === 'number' && Number.isFinite(val)) {
                settings.set_int64(key, Math.round(val));
                appliedCount++;
            }
        } catch {
            // Skip values that fail range validation
        }
    }

    return appliedCount;
}

export function createAboutPage(window, settings, metadata) {
    const cancellable = new Gio.Cancellable();
    const page = new Adw.PreferencesPage({
        title: _('About'),
        icon_name: 'help-about-symbolic',
    });

    const heroGroup = new Adw.PreferencesGroup();
    page.add(heroGroup);

    const heroBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        margin_top: 24,
        margin_bottom: 24,
        margin_start: 16,
        margin_end: 16,
        hexpand: true,
    });

    heroBox.append(new Gtk.Image({
        icon_name: 'preferences-desktop-theme-symbolic',
        pixel_size: 72,
        halign: Gtk.Align.CENTER,
    }));

    heroBox.append(new Gtk.Label({
        label: metadata.name || 'SGC-NOVUS Tools',
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD_CHAR,
        justify: Gtk.Justification.CENTER,
        css_classes: ['title-1'],
    }));

    const versionStr = metadata['version-name'] ||
        (metadata.version ? `v${metadata.version}` : null);
    const badgeText = versionStr
        ? `${versionStr} • ${metadata.uuid}`
        : metadata.uuid;

    heroBox.append(new Gtk.Label({
        label: badgeText,
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD_CHAR,
        justify: Gtk.Justification.CENTER,
        css_classes: ['dim-label'],
    }));

    heroBox.append(new Gtk.Label({
        label: _(
            'Complete GNOME desktop automation: Day/Night theme switching, ' +
            'display brightness, Night Light sync, and Power Profile switching.'
        ),
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD_CHAR,
        justify: Gtk.Justification.CENTER,
        max_width_chars: 48,
        margin_top: 8,
        css_classes: ['dim-label'],
    }));

    heroGroup.add(new Adw.PreferencesRow({
        child: new Adw.Clamp({maximum_size: 550, child: heroBox}),
        activatable: false,
        css_classes: ['card'],
    }));

    const backupGroup = new Adw.PreferencesGroup({
        title: _('Configuration Backup & Restore'),
        description: _('Export your settings to a JSON file, restore from a backup, or reset to factory defaults.'),
    });
    page.add(backupGroup);

    const exportRow = new Adw.ActionRow({
        title: _('Export Configuration'),
        subtitle: _('Save all current preferences to a portable JSON file'),
    });
    exportRow.add_prefix(new Gtk.Image({icon_name: 'document-save-symbolic'}));
    const exportBtn = new Gtk.Button({
        label: _('Export…'),
        valign: Gtk.Align.CENTER,
    });
    exportBtn.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({
            title: _('Export Configuration'),
            initial_name: 'novus-tools-config.json',
        });
        dialog.save(window, cancellable, (dlg, res) => {
            try {
                const file = dlg.save_finish(res);
                if (!file)
                    return;

                const jsonText = serializeSettings(settings, metadata);
                const bytes = new GLib.Bytes(new TextEncoder().encode(jsonText));
                file.replace_contents_bytes_async(
                    bytes,
                    null,
                    false,
                    Gio.FileCreateFlags.REPLACE_DESTINATION,
                    cancellable,
                    (f, writeRes) => {
                        try {
                            f.replace_contents_finish(writeRes);
                            window.add_toast(new Adw.Toast({
                                title: _('Configuration exported successfully'),
                                timeout: 3,
                            }));
                        } catch {
                            window.add_toast(new Adw.Toast({
                                title: _('Failed to write configuration file'),
                                timeout: 3,
                            }));
                        }
                    }
                );
            } catch {
                // User cancelled save dialog
            }
        });
    });
    exportRow.add_suffix(exportBtn);
    exportRow.activatable_widget = exportBtn;
    backupGroup.add(exportRow);

    const importRow = new Adw.ActionRow({
        title: _('Import Configuration'),
        subtitle: _('Load and apply settings from a previously exported JSON file'),
    });
    importRow.add_prefix(new Gtk.Image({icon_name: 'document-open-symbolic'}));
    const importBtn = new Gtk.Button({
        label: _('Import…'),
        valign: Gtk.Align.CENTER,
    });
    importBtn.connect('clicked', () => {
        const dialog = new Gtk.FileDialog({
            title: _('Import Configuration'),
        });
        const filter = new Gtk.FileFilter();
        filter.set_name(_('JSON Configuration Files'));
        filter.add_mime_type('application/json');
        filter.add_pattern('*.json');
        const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
        filters.append(filter);
        dialog.filters = filters;

        dialog.open(window, cancellable, (dlg, res) => {
            try {
                const file = dlg.open_finish(res);
                if (!file)
                    return;

                file.load_contents_async(cancellable, (f, loadRes) => {
                    try {
                        const [ok, contents] = f.load_contents_finish(loadRes);
                        if (!ok || !contents)
                            return;

                        const parsed = JSON.parse(new TextDecoder('utf-8').decode(contents));
                        const count = applyImportedSettings(settings, parsed);
                        window.add_toast(new Adw.Toast({
                            title: _('Imported %d settings successfully').replace('%d', count),
                            timeout: 3,
                        }));
                    } catch {
                        window.add_toast(new Adw.Toast({
                            title: _('Invalid configuration file'),
                            timeout: 3,
                        }));
                    }
                });
            } catch {
                // User cancelled open dialog
            }
        });
    });
    importRow.add_suffix(importBtn);
    importRow.activatable_widget = importBtn;
    backupGroup.add(importRow);

    const resetRow = new Adw.ActionRow({
        title: _('Reset All Settings'),
        subtitle: _('Restore all extension preferences to their factory defaults'),
    });
    resetRow.add_prefix(new Gtk.Image({icon_name: 'edit-clear-all-symbolic'}));
    const resetBtn = new Gtk.Button({
        label: _('Reset Defaults'),
        valign: Gtk.Align.CENTER,
        css_classes: ['destructive-action'],
    });
    resetBtn.connect('clicked', () => {
        for (const key of settings.settings_schema.list_keys())
            settings.reset(key);
        window.add_toast(new Adw.Toast({
            title: _('All settings restored to defaults'),
            timeout: 3,
        }));
    });
    resetRow.add_suffix(resetBtn);
    resetRow.activatable_widget = resetBtn;
    backupGroup.add(resetRow);

    const authorGroup = new Adw.PreferencesGroup({
        title: _('Developer & Organization'),
    });
    page.add(authorGroup);

    const authorRow = new Adw.ActionRow({
        title: _('Author'),
        subtitle: 'SGC-NOVUS (System Generations Core Novus)',
    });
    authorRow.add_prefix(new Gtk.Image({icon_name: 'avatar-default-symbolic'}));
    authorGroup.add(authorRow);

    addLinkRow(
        authorGroup,
        _('Official Website'),
        'https://sgc-novus.fun',
        _('Visit'),
        'web-browser-symbolic'
    );

    const linksGroup = new Adw.PreferencesGroup({
        title: _('Project Links'),
    });
    page.add(linksGroup);

    addLinkRow(
        linksGroup,
        _('GitHub Repository'),
        'https://github.com/SGC-NOVUS/novus-tools',
        _('Open'),
        'software-update-available-symbolic'
    );

    addLinkRow(
        linksGroup,
        _('Report an Issue / Suggestion'),
        'https://github.com/SGC-NOVUS/novus-tools/issues',
        _('Issues'),
        'help-browser-symbolic'
    );

    const creditsGroup = new Adw.PreferencesGroup({
        title: _('Credits & License'),
    });
    page.add(creditsGroup);

    const licenseRow = new Adw.ActionRow({
        title: _('License'),
        subtitle: _('GNU General Public License v3.0 (GPL-3.0)'),
    });
    licenseRow.add_prefix(new Gtk.Image({icon_name: 'emblem-favorite-symbolic'}));
    creditsGroup.add(licenseRow);

    addLinkRow(
        creditsGroup,
        _('suncalc Library'),
        'https://github.com/mourner/suncalc',
        _('View'),
        null,
        _('Solar calculations by Vladimir Agafonkin (BSD-2-Clause)')
    );

    return {
        page,
        destroy() {
            cancellable.cancel();
        },
    };
}
