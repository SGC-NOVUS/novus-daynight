import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {debugLog} from './logger.js';

export function getOptionalSettings(schemaId) {
    const source = Gio.SettingsSchemaSource.get_default();
    if (!source)
        return null;

    const schema = source.lookup(schemaId, true);
    if (!schema)
        return null;

    return new Gio.Settings({settings_schema: schema});
}

export function settingsHasKey(settings, keyName) {
    return Boolean(settings?.settings_schema?.has_key(keyName));
}

export function getThemeDirectories() {
    const dirs = [];
    const seen = new Set();
    const addDir = path => {
        if (path && !seen.has(path)) {
            seen.add(path);
            dirs.push(path);
        }
    };

    const homeDir = GLib.get_home_dir();
    addDir(GLib.build_filenamev([homeDir, '.themes']));
    addDir(GLib.build_filenamev([homeDir, '.local', 'share', 'themes']));

    for (const dataDir of GLib.get_system_data_dirs())
        addDir(GLib.build_filenamev([dataDir, 'themes']));

    addDir('/usr/share/themes');
    addDir('/usr/local/share/themes');

    return dirs;
}

function isValidGtkThemeDir(themeDirPath, themeName) {
    if (themeName === 'Default' || themeName === 'Emacs')
        return false;

    const candidates = [
        GLib.build_filenamev([themeDirPath, 'gtk-3.0', 'gtk.css']),
        GLib.build_filenamev([themeDirPath, 'gtk-4.0', 'gtk.css']),
        GLib.build_filenamev([themeDirPath, 'gtk-3.20', 'gtk.css']),
    ];

    return candidates.some(cssPath => GLib.file_test(cssPath, GLib.FileTest.EXISTS));
}

export function getAvailableGtkThemes() {
    const themes = new Set(['Adwaita']);

    for (const dirPath of getThemeDirectories()) {
        const dir = Gio.File.new_for_path(dirPath);
        if (!dir.query_exists(null))
            continue;

        try {
            const enumerator = dir.enumerate_children(
                'standard::name,standard::type',
                Gio.FileQueryInfoFlags.NONE,
                null
            );

            let info;
            while ((info = enumerator.next_file(null))) {
                const name = info.get_name();
                if (!name || name.startsWith('.'))
                    continue;

                const fileType = info.get_file_type();
                if (fileType !== Gio.FileType.DIRECTORY &&
                    fileType !== Gio.FileType.SYMBOLIC_LINK)
                    continue;

                const fullPath = GLib.build_filenamev([dirPath, name]);
                if (GLib.file_test(fullPath, GLib.FileTest.IS_DIR) &&
                    isValidGtkThemeDir(fullPath, name))
                    themes.add(name);
            }
        } catch (e) {
            debugLog(`NovusDayNight: Could not scan theme directory ${dirPath}: ${e.message}`);
        }
    }

    return Array.from(themes).sort((a, b) => a.localeCompare(b));
}

export function inferThemePair(themeName, availableThemes = null) {
    const installed = new Set(availableThemes ?? getAvailableGtkThemes());
    const findInstalled = (...candidates) =>
        candidates.find(c => c && installed.has(c)) ?? null;

    if (!themeName) {
        const light = findInstalled('Yaru', 'Adwaita') ?? 'Adwaita';
        const dark = findInstalled(`${light}-dark`, 'Yaru-dark', 'Adwaita-dark') ?? light;
        return {light, dark};
    }

    if (themeName === 'HighContrast' || themeName === 'HighContrastInverse') {
        return {
            light: 'HighContrast',
            dark: findInstalled('HighContrastInverse', 'Adwaita-dark') ?? 'HighContrast',
        };
    }

    if (themeName.includes('-Dark-')) {
        const baseLight = themeName.replace('-Dark-', '-');
        return {
            light: findInstalled(baseLight, `${baseLight}-Light`) ?? themeName,
            dark: themeName,
        };
    }

    const suffixMatch = themeName.match(/^(.*?)-(dark|Dark|darker|Darker|light|Light)$/);
    const base = suffixMatch ? suffixMatch[1] : themeName;
    const mintDark = base.startsWith('Mint-Y-')
        ? base.replace(/^Mint-Y-/, 'Mint-Y-Dark-')
        : null;

    const light = findInstalled(base, `${base}-light`, `${base}-Light`) ?? themeName;
    const dark = findInstalled(
        `${base}-dark`,
        `${base}-Dark`,
        mintDark,
        base === 'Adwaita' ? 'Adwaita-dark' : null
    ) ?? light;

    return {light, dark};
}

export function yaruPairForAccentColor(accentColor, availableThemes = null) {
    const installed = new Set(availableThemes ?? getAvailableGtkThemes());
    if (!installed.has('Yaru'))
        return null;

    const accentCandidates = {
        orange: ['Yaru'],
        blue: ['Yaru-blue'],
        teal: ['Yaru-prussiangreen', 'Yaru-viridian'],
        green: ['Yaru-olive', 'Yaru-sage', 'Yaru-viridian'],
        yellow: ['Yaru-yellow'],
        red: ['Yaru-red'],
        pink: ['Yaru-magenta'],
        purple: ['Yaru-purple'],
        slate: ['Yaru-sage'],
        brown: ['Yaru-wartybrown', 'Yaru-bark'],
    };

    const candidates = accentCandidates[accentColor] ?? ['Yaru'];
    const light = candidates.find(c => installed.has(c)) ?? 'Yaru';
    const dark = installed.has(`${light}-dark`)
        ? `${light}-dark`
        : (installed.has('Yaru-dark') ? 'Yaru-dark' : light);

    return {light, dark};
}

export function toFileUri(pathOrUri) {
    if (!pathOrUri)
        return '';
    if (pathOrUri.startsWith('file://'))
        return pathOrUri;
    return Gio.File.new_for_path(pathOrUri).get_uri();
}

export function toLocalPath(pathOrUri) {
    if (!pathOrUri)
        return '';
    if (!pathOrUri.startsWith('file://'))
        return pathOrUri;
    return Gio.File.new_for_uri(pathOrUri).get_path() ?? pathOrUri.slice(7);
}

function unescapeXml(text) {
    return text
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'");
}

export function getAvailableDualWallpapers() {
    const list = [];
    const seenPairs = new Set();
    const homeDir = GLib.get_home_dir();

    const dirs = [
        '/usr/share/gnome-background-properties',
        '/usr/local/share/gnome-background-properties',
        GLib.build_filenamev([homeDir, '.local', 'share', 'gnome-background-properties']),
    ];

    const langPrefs = GLib.get_language_names()
        .map(lang => lang.split('.')[0])
        .filter(lang => lang && lang !== 'C' && lang !== 'POSIX');

    for (const dirPath of dirs) {
        const dir = Gio.File.new_for_path(dirPath);
        if (!dir.query_exists(null))
            continue;

        try {
            const enumerator = dir.enumerate_children(
                'standard::name',
                Gio.FileQueryInfoFlags.NONE,
                null
            );

            let info;
            while ((info = enumerator.next_file(null))) {
                const fileName = info.get_name();
                if (!fileName.endsWith('.xml'))
                    continue;

                const [ok, bytes] = dir.get_child(fileName).load_contents(null);
                if (!ok || !bytes)
                    continue;

                const xml = new TextDecoder('utf-8').decode(bytes);
                const wpRegex = /<wallpaper([^>]*)>([\s\S]*?)<\/wallpaper>/g;
                let match;

                while ((match = wpRegex.exec(xml)) !== null) {
                    const attrs = match[1] ?? '';
                    const block = match[2] ?? '';

                    if (/deleted\s*=\s*["']true["']/i.test(attrs))
                        continue;

                    const lightMatch = /<filename>([^<]+)<\/filename>/.exec(block);
                    const darkMatch = /<filename-dark>([^<]+)<\/filename-dark>/.exec(block);
                    if (!lightMatch || !darkMatch)
                        continue;

                    const lightPath = unescapeXml(lightMatch[1].trim());
                    const darkPath = unescapeXml(darkMatch[1].trim());

                    if (!GLib.file_test(toLocalPath(lightPath), GLib.FileTest.EXISTS) ||
                        !GLib.file_test(toLocalPath(darkPath), GLib.FileTest.EXISTS))
                        continue;

                    const pairKey = `${lightPath}|${darkPath}`;
                    if (seenPairs.has(pairKey))
                        continue;
                    seenPairs.add(pairKey);

                    const defaultNameMatch = /<name>([^<]+)<\/name>/.exec(block);
                    const baseId = defaultNameMatch
                        ? unescapeXml(defaultNameMatch[1].trim())
                        : GLib.path_get_basename(lightPath);

                    const localizedNames = new Map();
                    const locRegex = /<name\s+xml:lang=["']([^"']+)["']>([^<]+)<\/name>/g;
                    let locMatch;
                    while ((locMatch = locRegex.exec(block)) !== null)
                        localizedNames.set(locMatch[1], unescapeXml(locMatch[2].trim()));

                    let displayName = baseId;
                    for (const lang of langPrefs) {
                        if (localizedNames.has(lang)) {
                            displayName = localizedNames.get(lang);
                            break;
                        }
                    }

                    list.push({
                        id: baseId,
                        name: displayName,
                        light: lightPath,
                        dark: darkPath,
                    });
                }
            }
        } catch (e) {
            debugLog(`NovusDayNight: Could not read wallpaper metadata in ${dirPath}: ${e.message}`);
        }
    }

    return list;
}
