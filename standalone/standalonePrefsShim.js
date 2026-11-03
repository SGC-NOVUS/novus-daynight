import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gettext from 'gettext';

const DEFAULT_DOMAIN = 'novus-daynight';
let _activeDomain = DEFAULT_DOMAIN;

export function gettext(str) {
    return Gettext.dgettext(_activeDomain, str);
}

export function pgettext(context, str) {
    return Gettext.dpgettext(_activeDomain, context, str);
}

export function ngettext(singular, plural, n) {
    return Gettext.dngettext(_activeDomain, singular, plural, n);
}

export class ExtensionPreferences {
    constructor(metadata = {}) {
        this.metadata = metadata;
        this.uuid = metadata.uuid || 'Novus_Tools@sgc-novus.fun';
        this.path = metadata.path || GLib.get_current_dir();
        this.dir = Gio.File.new_for_path(this.path);
    }

    initTranslations(domain) {
        _activeDomain = domain || this.metadata?.['gettext-domain'] || DEFAULT_DOMAIN;
        const localLocaleDir = GLib.build_filenamev([this.path, 'locale']);
        if (GLib.file_test(localLocaleDir, GLib.FileTest.IS_DIR))
            Gettext.bindtextdomain(_activeDomain, localLocaleDir);
        else
            Gettext.bindtextdomain(_activeDomain, '/usr/share/locale');
    }

    getSettings(schema) {
        const schemaId = schema ||
            this.metadata?.['settings-schema'] ||
            'org.gnome.shell.extensions.novus-daynight';
        const localSchemasDir = GLib.build_filenamev([this.path, 'schemas']);
        const compiledPath = GLib.build_filenamev([localSchemasDir, 'gschemas.compiled']);
        const defaultSource = Gio.SettingsSchemaSource.get_default();

        if (GLib.file_test(compiledPath, GLib.FileTest.EXISTS)) {
            const schemaSource = Gio.SettingsSchemaSource.new_from_directory(
                localSchemasDir,
                defaultSource,
                false
            );
            const schemaObj = schemaSource.lookup(schemaId, true);
            if (schemaObj)
                return new Gio.Settings({settings_schema: schemaObj});
        }

        if (defaultSource) {
            const sysSchema = defaultSource.lookup(schemaId, true);
            if (sysSchema)
                return new Gio.Settings({settings_schema: sysSchema});
        }

        throw new Error(`GSettings schema '${schemaId}' not found.`);
    }

    gettext(str) {
        return gettext(str);
    }

    ngettext(s, p, n) {
        return ngettext(s, p, n);
    }

    pgettext(ctx, str) {
        return pgettext(ctx, str);
    }
}
