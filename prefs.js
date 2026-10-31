import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {setDebugLogging} from './logger.js';
import {createAboutPage} from './prefs/aboutPage.js';
import {createAppearancePage} from './prefs/appearancePage.js';
import {createBrightnessPage} from './prefs/brightnessPage.js';
import {createSchedulePage} from './prefs/schedulePage.js';
import {createStatusPage} from './prefs/statusPage.js';

export default class NovusDayNightPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.set_default_size(740, 680);

        const settings = this.getSettings();
        setDebugLogging(settings.get_boolean('debug-logging'));
        const debugLogSignalId = settings.connect('changed::debug-logging', () => {
            setDebugLogging(settings.get_boolean('debug-logging'));
        });

        const pages = [
            createAppearancePage(window, settings),
            createSchedulePage(window, settings, this.metadata.uuid),
            createBrightnessPage(window, settings),
            createStatusPage(settings),
            createAboutPage(this.metadata),
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
