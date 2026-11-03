import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {WALLPAPER_MODES} from '../constants.js';
import {
    getAvailableDualWallpapers,
    getAvailableGtkThemes,
    getAvailableIconThemes,
    getOptionalSettings,
    inferIconThemePair,
    inferThemePair,
    settingsHasKey,
    toFileUri,
} from '../themeUtils.js';
import {triggerExtensionAction} from './dbusClient.js';

function selectComboString(row, model, target) {
    for (let i = 0; i < model.get_n_items(); i++) {
        if (model.get_string(i) === target) {
            if (row.selected !== i)
                row.selected = i;
            break;
        }
    }
}

function addPrefixIcon(row, iconName) {
    row.add_prefix(new Gtk.Image({icon_name: iconName}));
}

export function createAppearancePage(window, settings) {
    const cancellable = new Gio.Cancellable();
    const signalIds = [];
    const bgSettings = getOptionalSettings('org.gnome.desktop.background');
    const interfaceSettings = getOptionalSettings('org.gnome.desktop.interface');

    const page = new Adw.PreferencesPage({
        title: _('Appearance'),
        icon_name: 'preferences-desktop-theme-symbolic',
    });

    const overrideGroup = new Adw.PreferencesGroup({
        title: _('Manual Override Active'),
    });
    const overrideRow = new Adw.ActionRow({
        subtitle: _('Click Reset to follow the day/night schedule again.'),
    });
    addPrefixIcon(overrideRow, 'dialog-warning-symbolic');
    const overrideResetButton = new Gtk.Button({
        label: _('Reset'),
        valign: Gtk.Align.CENTER,
        css_classes: ['suggested-action'],
    });
    overrideResetButton.connect('clicked', () => {
        triggerExtensionAction(settings, 'ResetToAutomatic', null, cancellable).catch(() => {});
    });
    overrideRow.add_suffix(overrideResetButton);
    overrideRow.activatable_widget = overrideResetButton;
    overrideGroup.add(overrideRow);
    page.add(overrideGroup);

    const updateOverrideVisibility = () => {
        const active = settings.get_boolean('manual-mode-active');
        overrideGroup.visible = active;
        if (active) {
            const isDark = settings.get_boolean('manual-mode-is-dark');
            overrideRow.title = isDark
                ? _('Override set to Dark mode')
                : _('Override set to Light mode');
        }
    };
    updateOverrideVisibility();
    signalIds.push(settings.connect('changed::manual-mode-active', updateOverrideVisibility));
    signalIds.push(settings.connect('changed::manual-mode-is-dark', updateOverrideVisibility));

    const themeGroup = new Adw.PreferencesGroup({
        title: _('Theme Settings'),
    });
    page.add(themeGroup);

    const availableThemes = getAvailableGtkThemes();
    for (const savedKey of ['light-theme', 'dark-theme']) {
        const saved = settings.get_string(savedKey);
        if (saved && !availableThemes.includes(saved))
            availableThemes.push(saved);
    }
    availableThemes.sort((a, b) => a.localeCompare(b));

    const lightThemeModel = new Gtk.StringList();
    const darkThemeModel = new Gtk.StringList();
    for (const theme of availableThemes) {
        lightThemeModel.append(theme);
        darkThemeModel.append(theme);
    }

    const lightThemeRow = new Adw.ComboRow({
        title: _('Light Theme'),
        subtitle: _('Theme to use during the day'),
        model: lightThemeModel,
    });
    addPrefixIcon(lightThemeRow, 'weather-clear-symbolic');
    themeGroup.add(lightThemeRow);

    const darkThemeRow = new Adw.ComboRow({
        title: _('Dark Theme'),
        subtitle: _('Theme to use at night'),
        model: darkThemeModel,
    });
    addPrefixIcon(darkThemeRow, 'weather-clear-night-symbolic');
    themeGroup.add(darkThemeRow);

    selectComboString(lightThemeRow, lightThemeModel, settings.get_string('light-theme'));
    selectComboString(darkThemeRow, darkThemeModel, settings.get_string('dark-theme'));

    lightThemeRow.connect('notify::selected', () => {
        const selected = lightThemeRow.selected_item;
        if (selected && settings.get_string('light-theme') !== selected.string)
            settings.set_string('light-theme', selected.string);
    });

    darkThemeRow.connect('notify::selected', () => {
        const selected = darkThemeRow.selected_item;
        if (selected && settings.get_string('dark-theme') !== selected.string)
            settings.set_string('dark-theme', selected.string);
    });

    signalIds.push(settings.connect('changed::light-theme', () => {
        selectComboString(lightThemeRow, lightThemeModel, settings.get_string('light-theme'));
    }));
    signalIds.push(settings.connect('changed::dark-theme', () => {
        selectComboString(darkThemeRow, darkThemeModel, settings.get_string('dark-theme'));
    }));

    const availableIconThemes = getAvailableIconThemes();
    for (const savedKey of ['light-icon-theme', 'dark-icon-theme']) {
        const saved = settings.get_string(savedKey);
        if (saved && !availableIconThemes.includes(saved))
            availableIconThemes.push(saved);
    }
    availableIconThemes.sort((a, b) => a.localeCompare(b));

    const lightIconModel = new Gtk.StringList();
    const darkIconModel = new Gtk.StringList();
    for (const iconTheme of availableIconThemes) {
        lightIconModel.append(iconTheme);
        darkIconModel.append(iconTheme);
    }

    const syncIconRow = new Adw.SwitchRow({
        title: _('Sync Icon Theme with Day / Night'),
        subtitle: _('Switch icon packs (e.g. Papirus-Light / Papirus-Dark) automatically'),
    });
    addPrefixIcon(syncIconRow, 'applications-graphics-symbolic');
    settings.bind('sync-icon-theme', syncIconRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    themeGroup.add(syncIconRow);

    const lightIconRow = new Adw.ComboRow({
        title: _('Light Icon Theme'),
        subtitle: _('Icon theme to use during the day'),
        model: lightIconModel,
        visible: settings.get_boolean('sync-icon-theme'),
    });
    addPrefixIcon(lightIconRow, 'weather-clear-symbolic');
    themeGroup.add(lightIconRow);

    const darkIconRow = new Adw.ComboRow({
        title: _('Dark Icon Theme'),
        subtitle: _('Icon theme to use at night'),
        model: darkIconModel,
        visible: settings.get_boolean('sync-icon-theme'),
    });
    addPrefixIcon(darkIconRow, 'weather-clear-night-symbolic');
    themeGroup.add(darkIconRow);

    selectComboString(lightIconRow, lightIconModel, settings.get_string('light-icon-theme'));
    selectComboString(darkIconRow, darkIconModel, settings.get_string('dark-icon-theme'));

    lightIconRow.connect('notify::selected', () => {
        const selected = lightIconRow.selected_item;
        if (selected && settings.get_string('light-icon-theme') !== selected.string)
            settings.set_string('light-icon-theme', selected.string);
    });

    darkIconRow.connect('notify::selected', () => {
        const selected = darkIconRow.selected_item;
        if (selected && settings.get_string('dark-icon-theme') !== selected.string)
            settings.set_string('dark-icon-theme', selected.string);
    });

    signalIds.push(settings.connect('changed::light-icon-theme', () => {
        selectComboString(lightIconRow, lightIconModel, settings.get_string('light-icon-theme'));
    }));
    signalIds.push(settings.connect('changed::dark-icon-theme', () => {
        selectComboString(darkIconRow, darkIconModel, settings.get_string('dark-icon-theme'));
    }));
    signalIds.push(settings.connect('changed::sync-icon-theme', () => {
        const syncIcon = settings.get_boolean('sync-icon-theme');
        lightIconRow.visible = syncIcon;
        darkIconRow.visible = syncIcon;
    }));

    const autoPairRow = new Adw.ActionRow({
        title: _('Auto-Pair Light & Dark Themes'),
        subtitle: _('Automatically match the selected theme with its light/dark counterpart'),
    });
    addPrefixIcon(autoPairRow, 'emblem-synchronizing-symbolic');
    const autoPairBtn = new Gtk.Button({
        label: _('Auto-Pair'),
        valign: Gtk.Align.CENTER,
    });
    autoPairBtn.connect('clicked', () => {
        const seed = lightThemeRow.selected_item?.string || settings.get_string('light-theme');
        const pair = inferThemePair(seed, availableThemes);
        selectComboString(lightThemeRow, lightThemeModel, pair.light);
        selectComboString(darkThemeRow, darkThemeModel, pair.dark);
        settings.set_string('light-theme', pair.light);
        settings.set_string('dark-theme', pair.dark);

        if (settings.get_boolean('sync-icon-theme')) {
            const iconSeed = lightIconRow.selected_item?.string || settings.get_string('light-icon-theme');
            const iconPair = inferIconThemePair(iconSeed, availableIconThemes);
            selectComboString(lightIconRow, lightIconModel, iconPair.light);
            selectComboString(darkIconRow, darkIconModel, iconPair.dark);
            settings.set_string('light-icon-theme', iconPair.light);
            settings.set_string('dark-icon-theme', iconPair.dark);
        }

        window.add_toast(new Adw.Toast({
            title: _('Paired themes: %s / %s').replace('%s', pair.light).replace('%s', pair.dark),
            timeout: 3,
        }));
    });
    autoPairRow.add_suffix(autoPairBtn);
    autoPairRow.activatable_widget = autoPairBtn;
    themeGroup.add(autoPairRow);

    if (interfaceSettings && settingsHasKey(interfaceSettings, 'accent-color')) {
        const accentSyncRow = new Adw.SwitchRow({
            title: _('Sync with System Accent Color'),
            subtitle: _('Automatically switch Yaru light/dark variants when accent color changes'),
        });
        addPrefixIcon(accentSyncRow, 'preferences-color-symbolic');
        settings.bind(
            'sync-ubuntu-accent',
            accentSyncRow,
            'active',
            Gio.SettingsBindFlags.DEFAULT
        );
        themeGroup.add(accentSyncRow);
    }

    const quickSettingsRow = new Adw.SwitchRow({
        title: _('Show in Quick Settings'),
        subtitle: _('Add DayNight mode switcher to the GNOME top-bar system menu'),
    });
    addPrefixIcon(quickSettingsRow, 'preferences-system-symbolic');
    settings.bind(
        'show-quick-settings',
        quickSettingsRow,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    themeGroup.add(quickSettingsRow);

    const trueLightModeRow = new Adw.SwitchRow({
        title: _('True Light Mode'),
        subtitle: _('Use prefer-light color scheme during daytime'),
    });
    addPrefixIcon(trueLightModeRow, 'display-brightness-symbolic');
    settings.bind(
        'true-light-mode',
        trueLightModeRow,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    themeGroup.add(trueLightModeRow);

    const notificationsRow = new Adw.SwitchRow({
        title: _('Show Notifications'),
        subtitle: _('Display a notification when theme switches automatically'),
    });
    addPrefixIcon(notificationsRow, 'preferences-system-notifications-symbolic');
    settings.bind(
        'show-notifications',
        notificationsRow,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    themeGroup.add(notificationsRow);

    const wallpaperGroup = new Adw.PreferencesGroup({
        title: _('Desktop Wallpaper'),
        description: _('Support for dual day/night wallpaper pairs and separate custom images'),
    });
    page.add(wallpaperGroup);

    const wallpaperModeModel = new Gtk.StringList();
    wallpaperModeModel.append(_('Disabled'));
    wallpaperModeModel.append(_('Dual Wallpaper Theme (Day & Night in pair)'));
    wallpaperModeModel.append(_('Separate Custom Files (Day and Night separately)'));

    const savedWpMode = settings.get_string('wallpaper-mode') || 'disabled';
    const initialWpIdx = Math.max(0, WALLPAPER_MODES.indexOf(savedWpMode));

    const wallpaperModeRow = new Adw.ComboRow({
        title: _('Wallpaper Mode'),
        model: wallpaperModeModel,
        selected: initialWpIdx,
    });
    addPrefixIcon(wallpaperModeRow, 'preferences-desktop-wallpaper-symbolic');
    wallpaperGroup.add(wallpaperModeRow);

    const dualWpList = getAvailableDualWallpapers();
    const dualWpModel = new Gtk.StringList();
    for (const wp of dualWpList)
        dualWpModel.append(wp.name);

    const savedDualName = settings.get_string('dual-wallpaper-name');
    const initialDualIdx = Math.max(0, dualWpList.findIndex(w => w.name === savedDualName));

    const dualWpRow = new Adw.ComboRow({
        title: _('Dual Wallpaper Pair'),
        subtitle: _('System day/night wallpapers with automatic smooth transition'),
        model: dualWpModel,
        selected: dualWpList.length > 0 ? initialDualIdx : 0,
        visible: WALLPAPER_MODES[initialWpIdx] === 'dual',
    });
    addPrefixIcon(dualWpRow, 'image-x-generic-symbolic');
    wallpaperGroup.add(dualWpRow);

    dualWpRow.connect('notify::selected', () => {
        const selected = dualWpList[dualWpRow.selected];
        if (!selected)
            return;

        const lightUri = toFileUri(selected.light);
        const darkUri = toFileUri(selected.dark);
        settings.set_string('dual-wallpaper-name', selected.name);
        settings.set_string('dual-wallpaper-light-uri', lightUri);
        settings.set_string('dual-wallpaper-dark-uri', darkUri);
        bgSettings?.set_string('picture-uri', lightUri);
        if (bgSettings && settingsHasKey(bgSettings, 'picture-uri-dark'))
            bgSettings.set_string('picture-uri-dark', darkUri);
    });

    const addCustomWallpaperChooser = (title, key, isDark, iconName) => {
        const currentUri = settings.get_string(key);
        const row = new Adw.ActionRow({
            title,
            subtitle: currentUri ? currentUri.replace(/^file:\/\//, '') : _('No wallpaper selected'),
            visible: WALLPAPER_MODES[initialWpIdx] === 'separate',
        });
        addPrefixIcon(row, iconName);

        const chooseBtn = new Gtk.Button({
            label: _('Choose File…'),
            valign: Gtk.Align.CENTER,
        });
        chooseBtn.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({title});
            const filter = new Gtk.FileFilter();
            filter.set_name(_('Image Files'));
            filter.add_pixbuf_formats();
            const filters = new Gio.ListStore({item_type: Gtk.FileFilter});
            filters.append(filter);
            dialog.filters = filters;

            dialog.open(window, cancellable, (dlg, result) => {
                try {
                    const file = dlg.open_finish(result);
                    if (!file)
                        return;

                    const uri = file.get_uri();
                    row.subtitle = file.get_path() ?? uri;
                    settings.set_string(key, uri);
                    if (isDark) {
                        if (bgSettings && settingsHasKey(bgSettings, 'picture-uri-dark'))
                            bgSettings.set_string('picture-uri-dark', uri);
                    } else {
                        bgSettings?.set_string('picture-uri', uri);
                    }
                } catch {
                    // User cancelled file chooser
                }
            });
        });

        const clearBtn = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: _('Clear'),
            css_classes: ['flat'],
        });
        clearBtn.connect('clicked', () => {
            row.subtitle = _('No wallpaper selected');
            settings.set_string(key, '');
        });

        row.add_suffix(chooseBtn);
        row.add_suffix(clearBtn);
        wallpaperGroup.add(row);
        return row;
    };

    const lightWpRow = addCustomWallpaperChooser(
        _('Light Mode Wallpaper'),
        'light-wallpaper-uri',
        false,
        'weather-clear-symbolic'
    );
    const darkWpRow = addCustomWallpaperChooser(
        _('Dark Mode Wallpaper'),
        'dark-wallpaper-uri',
        true,
        'weather-clear-night-symbolic'
    );

    const lockScreenWpRow = new Adw.SwitchRow({
        title: _('Sync Lock Screen Wallpaper'),
        subtitle: _('Apply the active day/night wallpaper to the lock screen as well'),
        visible: WALLPAPER_MODES[initialWpIdx] !== 'disabled',
    });
    addPrefixIcon(lockScreenWpRow, 'system-lock-screen-symbolic');
    settings.bind(
        'sync-lock-screen-wallpaper',
        lockScreenWpRow,
        'active',
        Gio.SettingsBindFlags.DEFAULT
    );
    wallpaperGroup.add(lockScreenWpRow);

    wallpaperModeRow.connect('notify::selected', () => {
        const mode = WALLPAPER_MODES[wallpaperModeRow.selected] ?? 'disabled';
        settings.set_string('wallpaper-mode', mode);
        dualWpRow.visible = mode === 'dual';
        lightWpRow.visible = mode === 'separate';
        darkWpRow.visible = mode === 'separate';
        lockScreenWpRow.visible = mode !== 'disabled';

        if (mode === 'dual') {
            const selected = dualWpList[dualWpRow.selected];
            if (selected) {
                bgSettings?.set_string('picture-uri', toFileUri(selected.light));
                if (bgSettings && settingsHasKey(bgSettings, 'picture-uri-dark'))
                    bgSettings.set_string('picture-uri-dark', toFileUri(selected.dark));
            }
        } else if (mode === 'separate') {
            const lightUri = settings.get_string('light-wallpaper-uri');
            const darkUri = settings.get_string('dark-wallpaper-uri');
            if (lightUri)
                bgSettings?.set_string('picture-uri', toFileUri(lightUri));
            if (darkUri && bgSettings && settingsHasKey(bgSettings, 'picture-uri-dark'))
                bgSettings.set_string('picture-uri-dark', toFileUri(darkUri));
        }
    });

    return {
        page,
        destroy() {
            cancellable.cancel();
            for (const id of signalIds)
                settings.disconnect(id);
            signalIds.length = 0;
        },
    };
}
