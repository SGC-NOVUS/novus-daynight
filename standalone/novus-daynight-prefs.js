#!/usr/bin/env -S gjs -m
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import system from 'system';

const UUID = 'NDN@sgc-novus.fun';

function resolvePaths() {
    const scriptFile = Gio.File.new_for_uri(import.meta.url);
    const standaloneDir = scriptFile.get_parent().get_path();
    const rootDir = scriptFile.get_parent().get_parent().get_path();
    return {standaloneDir, rootDir};
}

function tryOpenGnomeShellPrefs() {
    const desktop = (GLib.getenv('XDG_CURRENT_DESKTOP') || '').toLowerCase();
    if (!desktop.includes('gnome') && !desktop.includes('ubuntu'))
        return Promise.resolve(false);

    const extDir = GLib.build_filenamev([
        GLib.get_user_data_dir(),
        'gnome-shell',
        'extensions',
        UUID,
    ]);
    const sysExtDir = `/usr/share/gnome-shell/extensions/${UUID}`;
    if (!GLib.file_test(extDir, GLib.FileTest.IS_DIR) &&
        !GLib.file_test(sysExtDir, GLib.FileTest.IS_DIR))
        return Promise.resolve(false);

    return new Promise(resolve => {
        Gio.DBus.session.call(
            'org.gnome.Shell.Extensions',
            '/org/gnome/Shell/Extensions',
            'org.gnome.Shell.Extensions',
            'OpenExtensionPrefs',
            new GLib.Variant('(ssa{sv})', [UUID, '', {}]),
            null,
            Gio.DBusCallFlags.NO_AUTO_START,
            1000,
            null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                    resolve(true);
                } catch {
                    resolve(false);
                }
            }
        );
    });
}

function readMetadata(rootDir) {
    const metaPath = GLib.build_filenamev([rootDir, 'metadata.json']);
    try {
        const [ok, bytes] = GLib.file_get_contents(metaPath);
        if (ok && bytes) {
            const parsed = JSON.parse(new TextDecoder('utf-8').decode(bytes));
            return {...parsed, path: rootDir};
        }
    } catch {
        // Fallback metadata
    }
    return {
        uuid: UUID,
        name: 'SGC-NOVUS Tools',
        'gettext-domain': 'novus-daynight',
        'settings-schema': 'org.gnome.shell.extensions.novus-daynight',
        path: rootDir,
    };
}

function stageStandalonePrefsModule(rootDir, standaloneDir) {
    const baseRuntime = GLib.get_user_runtime_dir() || GLib.get_tmp_dir();
    const stageDir = GLib.build_filenamev([baseRuntime, 'novus-daynight-prefs-ui']);
    const stagePrefsSubdir = GLib.build_filenamev([stageDir, 'prefs']);
    GLib.mkdir_with_parents(stagePrefsSubdir, 0o700);

    const shimUri = Gio.File.new_for_path(
        GLib.build_filenamev([standaloneDir, 'standalonePrefsShim.js'])
    ).get_uri();

    const rewriteFiles = [
        'prefs.js',
        'prefs/appearancePage.js',
        'prefs/schedulePage.js',
        'prefs/powerPage.js',
        'prefs/brightnessPage.js',
        'prefs/statusPage.js',
        'prefs/aboutPage.js',
        'prefs/monitorDialog.js',
        'prefs/brightnessSliderRow.js',
    ];

    for (const relPath of rewriteFiles) {
        const srcPath = GLib.build_filenamev([rootDir, relPath]);
        const dstPath = GLib.build_filenamev([stageDir, relPath]);
        const [ok, bytes] = GLib.file_get_contents(srcPath);
        if (!ok || !bytes)
            throw new Error(`Could not read ${srcPath}`);

        const srcText = new TextDecoder('utf-8').decode(bytes);
        const rewritten = srcText.replace(
            /resource:\/\/\/org\/gnome\/Shell\/Extensions\/js\/extensions\/prefs\.js/g,
            shimUri
        );
        GLib.file_set_contents(dstPath, rewritten);
    }

    const linkFiles = [
        'constants.js',
        'powerController.js',
        'swapHibernateController.js',
        'themeUtils.js',
        'displayController.js',
        'logger.js',
        'prefs/dbusClient.js',
        'prefs/displayManager.js',
    ];

    for (const relPath of linkFiles) {
        const srcPath = GLib.build_filenamev([rootDir, relPath]);
        const dstPath = GLib.build_filenamev([stageDir, relPath]);
        const dstFile = Gio.File.new_for_path(dstPath);
        if (GLib.file_test(dstPath, GLib.FileTest.IS_SYMLINK) || dstFile.query_exists(null))
            dstFile.delete(null);
        dstFile.make_symbolic_link(srcPath, null);
    }

    return Gio.File.new_for_path(GLib.build_filenamev([stageDir, 'prefs.js'])).get_uri();
}

export async function runPrefsCli(argv) {
    const forceStandalone = argv.includes('--standalone-window');
    const smokeTest = argv.includes('--smoke-test');

    if (!forceStandalone && !smokeTest && await tryOpenGnomeShellPrefs())
        return 0;

    const {standaloneDir, rootDir} = resolvePaths();
    const metadata = readMetadata(rootDir);
    const stagedPrefsUri = stageStandalonePrefsModule(rootDir, standaloneDir);
    const {default: NovusDayNightPreferences} = await import(stagedPrefsUri);

    Adw.init();

    const app = new Adw.Application({
        application_id: 'fun.sgc_novus.NovusDayNight.Prefs',
        flags: Gio.ApplicationFlags.NON_UNIQUE,
    });

    app.connect('activate', () => {
        const win = new Adw.PreferencesWindow({
            application: app,
            title: 'Novus DayNight',
            default_width: 740,
            default_height: 680,
            search_enabled: true,
        });

        const prefs = new NovusDayNightPreferences(metadata);
        prefs.initTranslations();
        prefs.fillPreferencesWindow(win);
        win.present();

        if (smokeTest) {
            const settings = prefs.getSettings();
            settings.set_string('monitors', JSON.stringify([{
                id: 'builtin',
                name: 'Built-in Display',
                type: 'mutter-dbus',
                enabled: true,
                initialized: true,
                lightBrightness: 80,
                darkBrightness: 30,
                lastSeen: Date.now(),
            }]));

            import(
                Gio.File.new_for_path(
                    GLib.build_filenamev([
                        GLib.path_get_dirname(Gio.File.new_for_uri(stagedPrefsUri).get_path()),
                        'prefs',
                        'monitorDialog.js',
                    ])
                ).get_uri()
            ).then(({MonitorConfigDialog}) => {
                const dialog = new MonitorConfigDialog(win, settings);
                dialog.show();
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                    dialog._dialog?.close();
                    win.close();
                    app.quit();
                    return GLib.SOURCE_REMOVE;
                });
            }).catch(e => {
                printerr(`MonitorConfigDialog smoke test error: ${e}\n`);
                system.exit(1);
            });
        }
    });

    return app.runAsync([]);
}

const _invokedProgram = system.programPath || system.programInvocationName || '';
if (_invokedProgram.endsWith('novus-daynight-prefs.js')) {
    const code = await runPrefsCli(system.programArgs);
    system.exit(code);
}
