import GObject from 'gi://GObject';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import {QuickMenuToggle, SystemIndicator} from 'resource:///org/gnome/shell/ui/quickSettings.js';
import {gettext as _} from 'resource:///org/gnome/shell/extensions/extension.js';
import {
    POWER_PROFILE_BALANCED,
    POWER_PROFILE_PERFORMANCE,
    POWER_PROFILE_POWER_SAVER,
} from './powerController.js';

const NovusQuickMenuToggle = GObject.registerClass(
class NovusQuickMenuToggle extends QuickMenuToggle {
    _init(extension, controller) {
        super._init({
            title: _('SGC-NOVUS'),
            subtitle: _('Auto Schedule'),
            iconName: 'weather-clear-symbolic',
            toggleMode: false,
        });

        this._extension = extension;
        this._controller = controller;
        this._powerController = controller.getPowerController();
        this._swapHibernateController = controller.getSwapHibernateController();

        this.menu.setHeader(
            'preferences-desktop-theme-symbolic',
            _('SGC-NOVUS Tools'),
            _('Theme, display & power management')
        );

        // --- Schedule & Theme Section ---
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

        // --- Power Profiles Section ---
        this._powerSeparator = new PopupMenu.PopupSeparatorMenuItem(_('Power Profile'));
        this.menu.addMenuItem(this._powerSeparator);

        this._powerPerformanceItem = new PopupMenu.PopupImageMenuItem(
            _('Performance'),
            'power-profile-performance-symbolic'
        );
        this._powerPerformanceItem.connect('activate', () => {
            this._powerController?.setActiveProfile(POWER_PROFILE_PERFORMANCE);
        });
        this.menu.addMenuItem(this._powerPerformanceItem);

        this._powerBalancedItem = new PopupMenu.PopupImageMenuItem(
            _('Balanced'),
            'power-profile-balanced-symbolic'
        );
        this._powerBalancedItem.connect('activate', () => {
            this._powerController?.setActiveProfile(POWER_PROFILE_BALANCED);
        });
        this.menu.addMenuItem(this._powerBalancedItem);

        this._powerSaverItem = new PopupMenu.PopupImageMenuItem(
            _('Power Saver'),
            'power-profile-power-saver-symbolic'
        );
        this._powerSaverItem.connect('activate', () => {
            this._powerController?.setActiveProfile(POWER_PROFILE_POWER_SAVER);
        });
        this.menu.addMenuItem(this._powerSaverItem);

        // --- Sleep & Hibernate Actions ---
        this._sleepSeparator = new PopupMenu.PopupSeparatorMenuItem(_('System Sleep'));
        this.menu.addMenuItem(this._sleepSeparator);

        this._suspendItem = new PopupMenu.PopupImageMenuItem(
            _('Suspend (Sleep)'),
            'media-playback-pause-symbolic'
        );
        this._suspendItem.connect('activate', () => {
            this._swapHibernateController?.suspend(true);
        });
        this.menu.addMenuItem(this._suspendItem);

        this._hibernateItem = new PopupMenu.PopupImageMenuItem(
            _('Hibernate'),
            'weather-snow-symbolic'
        );
        this._hibernateItem.connect('activate', () => {
            this._swapHibernateController?.hibernate(true);
        });
        this.menu.addMenuItem(this._hibernateItem);

        // --- Settings Section ---
        this.menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem());

        this._prefsItem = new PopupMenu.PopupImageMenuItem(
            _('SGC-NOVUS Settings…'),
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
        if (!this._controller)
            return;

        const isManual = this._controller.isManualModeActive();
        const isDark = this._controller.isCurrentlyDark();
        const icon = isDark ? 'weather-clear-night-symbolic' : 'weather-clear-symbolic';

        this.iconName = icon;
        this.checked = !isManual;

        const modeWord = isDark ? _('Night') : _('Day');
        const activeProfile = this._powerController?.getActiveProfile();

        let profileLabel = '';
        if (activeProfile === POWER_PROFILE_PERFORMANCE)
            profileLabel = _('Performance');
        else if (activeProfile === POWER_PROFILE_BALANCED)
            profileLabel = _('Balanced');
        else if (activeProfile === POWER_PROFILE_POWER_SAVER)
            profileLabel = _('Power Saver');

        let pwrIndicator = '';
        if (this._powerController?.hasBattery()) {
            const onBat = this._powerController.isOnBattery();
            const pct = this._powerController.getBatteryPercentage();
            pwrIndicator = onBat ? `🔋 ${pct}%` : '⚡ AC';
        }

        if (profileLabel) {
            const pwrTag = pwrIndicator ? `${pwrIndicator} • ` : '';
            this.subtitle = isManual
                ? `${pwrTag}${modeWord}`
                : `${pwrTag}${profileLabel}`;
        } else {
            this.subtitle = isManual
                ? `${_('Manual')} • ${modeWord}`
                : `${_('Auto')} • ${modeWord}`;
        }

        const nextTime = this._controller.getNextSwitchTimeShort();
        const headerSubtitle = isManual
            ? _('Manual override active')
            : (nextTime ? _('Next switch at %s').replace('%s', nextTime) : _('Following schedule'));
        this.menu.setHeader(icon, _('SGC-NOVUS Tools'), headerSubtitle);

        this._autoItem.setOrnament(
            !isManual ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE
        );
        this._lightItem.setOrnament(
            isManual && !isDark ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE
        );
        this._darkItem.setOrnament(
            isManual && isDark ? PopupMenu.Ornament.CHECK : PopupMenu.Ornament.NONE
        );

        // Power profile visibility & check ornaments
        const powerAvailable = this._powerController?.isAvailable();
        const settings = this._controller.getSettings();
        const powerEnabled = settings ? settings.get_boolean('enable-power-profiles') : true;
        const showPower = Boolean(powerAvailable && powerEnabled);

        this._powerSeparator.visible = showPower;
        this._powerPerformanceItem.visible = showPower;
        this._powerBalancedItem.visible = showPower;
        this._powerSaverItem.visible = showPower;

        if (showPower) {
            this._powerPerformanceItem.setOrnament(
                activeProfile === POWER_PROFILE_PERFORMANCE
                    ? PopupMenu.Ornament.CHECK
                    : PopupMenu.Ornament.NONE
            );
            this._powerBalancedItem.setOrnament(
                activeProfile === POWER_PROFILE_BALANCED
                    ? PopupMenu.Ornament.CHECK
                    : PopupMenu.Ornament.NONE
            );
            this._powerSaverItem.setOrnament(
                activeProfile === POWER_PROFILE_POWER_SAVER
                    ? PopupMenu.Ornament.CHECK
                    : PopupMenu.Ornament.NONE
            );
        }

        // Sleep & Hibernate visibility
        const showHib = settings ? settings.get_boolean('show-quick-hibernate') : true;
        const showSusp = settings ? settings.get_boolean('show-quick-suspend') : false;
        const showSleepGroup = Boolean(showHib || showSusp);

        this._sleepSeparator.visible = showSleepGroup;
        this._suspendItem.visible = showSusp;
        this._hibernateItem.visible = showHib;

        if (showHib && this._hibernateItem.label) {
            const canHib = this._swapHibernateController?.canHibernate();
            this._hibernateItem.reactive = Boolean(canHib);
            this._hibernateItem.label.text = canHib
                ? _('Hibernate')
                : `${_('Hibernate')} (${_('Not configured')})`;
        }
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
