import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';

const NovusQuickMenuToggle = GObject.registerClass(
class NovusQuickMenuToggle extends QuickMenuToggle {
    _init(extension, controller) {
        super._init({
            title: _('DayNight'),
            subtitle: _('Auto Schedule'),
            iconName: 'weather-clear-symbolic',
            toggleMode: false,
        });

        this._extension = extension;
        this._controller = controller;

        this.menu.setHeader(
            'preferences-desktop-theme-symbolic',
            _('Novus DayNight'),
            _('Automatic theme & brightness')
        );

        this._autoItem = new PopupMenu.PopupImageMenuItem(
            _('Automatic Schedule'),
            'emblem-synchronizing-symbolic'
        );
        this._autoItem.connect('activate', () => this._controller.resetToAutomatic());
        this.menu.addMenuItem(this._autoItem);

        this._lightItem = new PopupMenu.PopupImageMenuItem(
            _('Day Mode (Light)'),
            'weather-clear-symbolic'
        );
        this._lightItem.connect('activate', () => this._controller.forceThemeSwitch(false));
        this.menu.addMenuItem(this._lightItem);

        this._darkItem = new PopupMenu.PopupImageMenuItem(
            _('Night Mode (Dark)'),
            'weather-clear-night-symbolic'
        );
        this._darkItem.connect('activate', () => this._controller.forceThemeSwitch(true));
        this.menu.addMenuItem(this._darkItem);

        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._prefsItem = new PopupMenu.PopupImageMenuItem(
            _('DayNight Settings…'),
            'preferences-system-symbolic'
        );
        this._prefsItem.connect('activate', () => {
            Main.overview.hide();
            Main.panel.closeQuickSettings();
            this._extension.openPreferences();
        });
        this.menu.addMenuItem(this._prefsItem);

        this.connect('clicked', () => {
            if (this._controller.isManualModeActive())
                this._controller.resetToAutomatic();
            else
                this._controller.forceThemeSwitch(!this._controller.isCurrentlyDark());
        });

        this.syncState();
    }

    syncState() {
        const isManual = this._controller.isManualModeActive();
        const isDark = this._controller.isCurrentlyDark();
        const icon = isDark ? 'weather-clear-night-symbolic' : 'weather-clear-symbolic';

        this.iconName = icon;
        this.checked = !isManual;

        const modeWord = isDark ? _('Night') : _('Day');
        this.subtitle = isManual
            ? `${_('Manual')} • ${modeWord}`
            : `${_('Auto')} • ${modeWord}`;

        const nextTime = this._controller.getNextSwitchTimeShort();
        const headerSubtitle = isManual
            ? _('Manual override active')
            : (nextTime ? _('Next switch at %s').replace('%s', nextTime) : _('Following schedule'));
        this.menu.setHeader(icon, _('Novus DayNight'), headerSubtitle);

        this._autoItem.setOrnament(
            !isManual ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE
        );
        this._lightItem.setOrnament(
            isManual && !isDark ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE
        );
        this._darkItem.setOrnament(
            isManual && isDark ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE
        );
    }
});

export const NovusQuickSettingsIndicator = GObject.registerClass(
class NovusQuickSettingsIndicator extends SystemIndicator {
    _init(extension, controller) {
        super._init();

        this._toggle = new NovusQuickMenuToggle(extension, controller);
        this.quickSettingsItems.push(this._toggle);

        Main.panel.statusArea.quickSettings.addExternalIndicator(this);
    }

    syncState() {
        this._toggle?.syncState();
    }

    destroy() {
        for (const item of this.quickSettingsItems)
            item.destroy();
        this.quickSettingsItems = [];
        this._toggle = null;
        super.destroy();
    }
});
