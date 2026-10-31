import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
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

export function createAboutPage(metadata) {
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
        label: metadata.name || 'Novus DayNight',
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
            'Automatic light and dark theme switching based on sunrise/sunset ' +
            'with smooth display brightness control.'
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
        'https://github.com/SGC-NOVUS/novus-daynight',
        _('Open'),
        'software-update-available-symbolic'
    );

    addLinkRow(
        linksGroup,
        _('Report an Issue / Suggestion'),
        'https://github.com/SGC-NOVUS/novus-daynight/issues',
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
        _('Upstream Project'),
        'https://github.com/amritashan/auto-theme-switcher',
        _('View'),
        null,
        _('Based on Automatic Theme Switcher by Amritashan S. Lal (GPL-3.0)')
    );

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
        destroy() {},
    };
}
