import GLib from 'gi://GLib';
import {
    getAvailableDualWallpapers,
    getAvailableGtkThemes,
    getOptionalSettings,
    inferThemePair,
    settingsHasKey,
    toFileUri,
    toLocalPath,
    yaruPairForAccentColor,
} from './themeUtils.js';
import {debugLog} from './logger.js';

export class ThemeController {
    constructor(settings, options = {}) {
        this._settings = settings;
        this._notify = options.notify ?? null;
        this._onApplied = options.onApplied ?? null;
        this._ = options.gettext ?? (s => s);

        this._interfaceSettings = getOptionalSettings('org.gnome.desktop.interface');
        this._colorSettings = getOptionalSettings('org.gnome.settings-daemon.plugins.color');
        this._bgSettings = getOptionalSettings('org.gnome.desktop.background');
        this._screensaverSettings = getOptionalSettings('org.gnome.desktop.screensaver');

        this._accentChangedId = null;
        this._lastIsDark = null;

        this._setupAccentSync();
    }

    _setupAccentSync() {
        if (!this._interfaceSettings || !settingsHasKey(this._interfaceSettings, 'accent-color'))
            return;

        this._accentChangedId = this._interfaceSettings.connect('changed::accent-color', () => {
            if (!this._settings?.get_boolean('sync-ubuntu-accent'))
                return;

            const lightTheme = this._settings.get_string('light-theme');
            const darkTheme = this._settings.get_string('dark-theme');
            if (!lightTheme.startsWith('Yaru') && !darkTheme.startsWith('Yaru'))
                return;

            const accent = this._interfaceSettings.get_string('accent-color');
            const pair = yaruPairForAccentColor(accent);
            if (!pair)
                return;

            debugLog(`NovusDayNight: Syncing Yaru pair for accent '${accent}' -> ${pair.light} / ${pair.dark}`);
            this._settings.set_string('light-theme', pair.light);
            this._settings.set_string('dark-theme', pair.dark);

            const isDark = this._lastIsDark ?? !this.isCurrentlyInLightMode();
            const targetTheme = isDark ? pair.dark : pair.light;
            if (this._interfaceSettings.get_string('gtk-theme') !== targetTheme)
                this._interfaceSettings.set_string('gtk-theme', targetTheme);
        });
    }

    switchTheme(isDark, showNotification = true, manualModeActive = false) {
        if (!this._settings)
            return;

        this._lastIsDark = isDark;

        const theme = isDark
            ? this._settings.get_string('dark-theme')
            : this._settings.get_string('light-theme');
        const trueLightMode = this._settings.get_boolean('true-light-mode');
        const colorScheme = trueLightMode
            ? (isDark ? 'prefer-dark' : 'prefer-light')
            : (isDark ? 'prefer-dark' : 'default');

        let themeAlreadySet = false;

        if (this._interfaceSettings) {
            const currentTheme = this._interfaceSettings.get_string('gtk-theme');
            const hasColorScheme = settingsHasKey(this._interfaceSettings, 'color-scheme');
            const currentScheme = hasColorScheme
                ? this._interfaceSettings.get_string('color-scheme')
                : '';

            themeAlreadySet = currentTheme === theme &&
                (!hasColorScheme || currentScheme === colorScheme);

            if (!themeAlreadySet) {
                this._interfaceSettings.set_string('gtk-theme', theme);
                if (hasColorScheme)
                    this._interfaceSettings.set_string('color-scheme', colorScheme);
            }
        }

        const wallpaperUri = this._applyWallpaper(isDark);

        if (this._colorSettings) {
            const nightLightMode = this._settings.get_string('night-light-mode');
            if (nightLightMode === 'sync-with-theme') {
                this._colorSettings.set_boolean('night-light-enabled', isDark);
            } else if (nightLightMode === 'custom-schedule') {
                this.updateNightLightSchedule();
            }
        }

        if (this._onApplied)
            this._onApplied({theme, isDark, wallpaperUri});

        if (themeAlreadySet)
            return;

        debugLog(`NovusDayNight: Applied ${isDark ? 'dark' : 'light'} theme (${theme}), scheme=${colorScheme}`);

        if (showNotification && !manualModeActive &&
            this._settings.get_boolean('show-notifications') && this._notify) {
            const title = this._('Novus DayNight');
            const body = isDark
                ? this._('Switched to dark mode')
                : this._('Switched to light mode');
            const icon = isDark ? 'weather-clear-night-symbolic' : 'weather-clear-symbolic';
            this._notify(title, body, icon);
        }
    }

    _applyWallpaper(isDark) {
        const mode = this._settings.get_string('wallpaper-mode');
        if (!mode || mode === 'disabled')
            return '';

        let activeUri = '';

        if (mode === 'dual') {
            let lightUri = this._settings.get_string('dual-wallpaper-light-uri');
            let darkUri = this._settings.get_string('dual-wallpaper-dark-uri');

            if (!lightUri || !GLib.file_test(toLocalPath(lightUri), GLib.FileTest.EXISTS) ||
                !darkUri || !GLib.file_test(toLocalPath(darkUri), GLib.FileTest.EXISTS)) {
                const pairs = getAvailableDualWallpapers();
                if (pairs.length > 0) {
                    lightUri = toFileUri(pairs[0].light);
                    darkUri = toFileUri(pairs[0].dark);
                    this._settings.set_string('dual-wallpaper-name', pairs[0].name);
                    this._settings.set_string('dual-wallpaper-light-uri', lightUri);
                    this._settings.set_string('dual-wallpaper-dark-uri', darkUri);
                }
            }

            const fmtLight = lightUri ? toFileUri(lightUri) : '';
            const fmtDark = darkUri ? toFileUri(darkUri) : '';

            if (this._bgSettings) {
                if (fmtLight)
                    this._bgSettings.set_string('picture-uri', fmtLight);
                if (fmtDark && settingsHasKey(this._bgSettings, 'picture-uri-dark'))
                    this._bgSettings.set_string('picture-uri-dark', fmtDark);
            }
            activeUri = isDark ? (fmtDark || fmtLight) : (fmtLight || fmtDark);
        } else if (mode === 'separate') {
            const selected = isDark
                ? this._settings.get_string('dark-wallpaper-uri')
                : this._settings.get_string('light-wallpaper-uri');

            if (selected && selected.trim().length > 0) {
                activeUri = toFileUri(selected.trim());
                if (this._bgSettings) {
                    this._bgSettings.set_string('picture-uri', activeUri);
                    if (settingsHasKey(this._bgSettings, 'picture-uri-dark'))
                        this._bgSettings.set_string('picture-uri-dark', activeUri);
                }
            }
        }

        if (activeUri && this._screensaverSettings &&
            this._settings.get_boolean('sync-lock-screen-wallpaper') &&
            settingsHasKey(this._screensaverSettings, 'picture-uri')) {
            this._screensaverSettings.set_string('picture-uri', activeUri);
        }

        return activeUri;
    }

    updateNightLightSchedule() {
        if (!this._colorSettings)
            return;

        const startTime = this._settings.get_string('night-light-start-time');
        const endTime = this._settings.get_string('night-light-end-time');
        const [startH, startM] = startTime.split(':').map(Number);
        const [endH, endM] = endTime.split(':').map(Number);

        if (Number.isNaN(startH) || Number.isNaN(startM) ||
            Number.isNaN(endH) || Number.isNaN(endM))
            return;

        this._colorSettings.set_boolean('night-light-enabled', true);
        this._colorSettings.set_boolean('night-light-schedule-automatic', false);
        this._colorSettings.set_double('night-light-schedule-from', startH + startM / 60);
        this._colorSettings.set_double('night-light-schedule-to', endH + endM / 60);
    }

    isCurrentlyInLightMode() {
        if (this._interfaceSettings && settingsHasKey(this._interfaceSettings, 'color-scheme'))
            return this._interfaceSettings.get_string('color-scheme') !== 'prefer-dark';
        return this._lastIsDark !== true;
    }

    initializeDefaultThemes() {
        if (!this._settings)
            return;

        const available = getAvailableGtkThemes();
        const lightTheme = this._settings.get_string('light-theme');
        const darkTheme = this._settings.get_string('dark-theme');
        const currentTheme = this._interfaceSettings?.get_string('gtk-theme') ?? '';

        const isFactoryDefault = lightTheme === 'Adwaita' &&
            darkTheme === 'Adwaita-dark' &&
            currentTheme !== '' &&
            currentTheme !== 'Adwaita' &&
            currentTheme !== 'Adwaita-dark';
        const isIdenticalPair = lightTheme === darkTheme;

        if (isFactoryDefault || isIdenticalPair) {
            const seed = isFactoryDefault ? currentTheme : (lightTheme || currentTheme);
            const pair = inferThemePair(seed, available);
            this._settings.set_string('light-theme', pair.light);
            this._settings.set_string('dark-theme', pair.dark);
            debugLog(`NovusDayNight: Initialized theme pair -> ${pair.light} / ${pair.dark}`);
        }
    }

    destroy() {
        if (this._accentChangedId && this._interfaceSettings) {
            this._interfaceSettings.disconnect(this._accentChangedId);
            this._accentChangedId = null;
        }
        this._settings = null;
        this._interfaceSettings = null;
        this._colorSettings = null;
        this._bgSettings = null;
        this._screensaverSettings = null;
        this._notify = null;
        this._onApplied = null;
    }
}
