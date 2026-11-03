import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {setDebugLogging} from './logger.js';
import {createAboutPage} from './prefs/aboutPage.js';
import {createAppearancePage} from './prefs/appearancePage.js';
import {createBrightnessPage} from './prefs/brightnessPage.js';
import {createPowerPage} from './prefs/powerPage.js';
import {createSchedulePage} from './prefs/schedulePage.js';
import {createStatusPage} from './prefs/statusPage.js';

export default class SGCNovusToolsPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(760, 700);
        window.search_enabled = true;

        const settings = this.getSettings();
        setDebugLogging(settings.get_boolean('debug-logging'));
        const debugLogSignalId = settings.connect('changed::debug-logging', () => {
            setDebugLogging(settings.get_boolean('debug-logging'));
        });

        const pages = [
            createAppearancePage(window, settings),
            createSchedulePage(window, settings, this.metadata.uuid),
            createPowerPage(window, settings),
            createBrightnessPage(window, settings),
            createStatusPage(settings),
            createAboutPage(window, settings, this.metadata),
        ];

        for (const {page} of pages)
            window.add(page);

        window.connect('close-request', () => {
            for (const entry of pages)
                entry.destroy();

            settings.disconnect(debugLogSignalId);
            return false;
        });
    }
}
