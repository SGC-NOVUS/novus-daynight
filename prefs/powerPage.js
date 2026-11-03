import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {
    BATTERY_STATE_CHARGING,
    BATTERY_STATE_DISCHARGING,
    BATTERY_STATE_FULLY_CHARGED,
    POWER_PROFILE_BALANCED,
    POWER_PROFILE_PERFORMANCE,
    POWER_PROFILE_POWER_SAVER,
    PowerController,
} from '../powerController.js';
import {SwapHibernateController} from '../swapHibernateController.js';

function getProfileOptions() {
    return [
        {id: POWER_PROFILE_PERFORMANCE, label: _('Performance'), icon: 'power-profile-performance-symbolic'},
        {id: POWER_PROFILE_BALANCED, label: _('Balanced'), icon: 'power-profile-balanced-symbolic'},
        {id: POWER_PROFILE_POWER_SAVER, label: _('Power Saver'), icon: 'power-profile-power-saver-symbolic'},
    ];
}

function getScenarioProfileOptions() {
    return [
        {id: POWER_PROFILE_PERFORMANCE, label: _('Performance (Maximum Power)')},
        {id: POWER_PROFILE_BALANCED, label: _('Balanced')},
        {id: POWER_PROFILE_POWER_SAVER, label: _('Power Saver (Maximum Battery Life)')},
        {id: 'keep', label: _('Keep current profile (Do not change)')},
    ];
}

function getTimeoutOptions() {
    return [
        {seconds: 60, label: `1 ${_('minute')}`},
        {seconds: 120, label: `2 ${_('minutes')}`},
        {seconds: 180, label: `3 ${_('minutes')}`},
        {seconds: 300, label: `5 ${_('minutes')}`},
        {seconds: 600, label: `10 ${_('minutes')}`},
        {seconds: 900, label: `15 ${_('minutes')}`},
        {seconds: 1800, label: `30 ${_('minutes')}`},
        {seconds: 0, label: _('Never')},
    ];
}

function getLidActionOptions() {
    return [
        {id: 'suspend', label: _('Suspend (Sleep)')},
        {id: 'hibernate', label: _('Hibernate')},
        {id: 'blank', label: _('Turn Off Display')},
        {id: 'nothing', label: _('Do Nothing')},
    ];
}

function getSleepTypeOptions() {
    return [
        {id: 'suspend', label: _('Suspend (Sleep)')},
        {id: 'hibernate', label: _('Hibernate')},
        {id: 'nothing', label: _('Do Nothing')},
    ];
}

function getCaffeineDurationOptions() {
    return [
        {seconds: 0, label: _('Indefinitely (Until turned off)')},
        {seconds: 1800, label: `30 ${_('minutes')}`},
        {seconds: 3600, label: `1 ${_('hour')}`},
        {seconds: 7200, label: `2 ${_('hours')}`},
    ];
}

function createModelFromList(list) {
    const model = new Gtk.StringList();
    for (const item of list)
        model.append(item.label);
    return model;
}

function getIndexForId(list, targetId) {
    const idx = list.findIndex(item => item.id === targetId);
    return idx >= 0 ? idx : 0;
}

function getIndexForSeconds(list, seconds) {
    const idx = list.findIndex(item => item.seconds === seconds);
    return idx >= 0 ? idx : 4;
}

function formatBytes(kbytes) {
    if (!kbytes || kbytes <= 0)
        return '0 MB';
    const mb = kbytes / 1024;
    if (mb < 1024)
        return `${Math.round(mb)} MB`;
    return `${(mb / 1024).toFixed(1)} GB`;
}

function formatDurationSeconds(seconds) {
    if (!seconds || seconds <= 0)
        return '';
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.round((seconds % 3600) / 60);
    if (hours > 0)
        return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

function addPrefixIcon(row, iconName) {
    const image = new Gtk.Image({icon_name: iconName});
    row.add_prefix(image);
    return image;
}

export function createPowerPage(_window, settings) {
    const powerController = new PowerController(settings, {enableAutomation: false});
    const swapHibernateController = new SwapHibernateController(settings, {autoRefreshSwap: true});

    let gsdPowerSettings = null;
    try {
        gsdPowerSettings = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.power'});
    } catch {
        // GSD Power settings unavailable on this system
    }

    const profileOptions = getProfileOptions();
    const scenarioOptions = getScenarioProfileOptions();
    const timeoutOptions = getTimeoutOptions();
    const lidActionOptions = getLidActionOptions();
    const sleepTypeOptions = getSleepTypeOptions();
    const caffeineDurationOptions = getCaffeineDurationOptions();

    const page = new Adw.PreferencesPage({
        title: _('Power'),
        icon_name: 'power-profile-balanced-symbolic',
    });

    const statusGroup = new Adw.PreferencesGroup({
        title: _('Live Telemetry & D-Bus Control'),
        description: _('Real-time connection status to power-profiles-daemon and UPower.'),
    });
    page.add(statusGroup);

    const activeProfileRow = new Adw.ActionRow({
        title: _('Current Active Profile'),
        subtitle: _('Unknown'),
    });
    const activeProfileIcon = addPrefixIcon(activeProfileRow, 'power-profile-balanced-symbolic');
    statusGroup.add(activeProfileRow);

    const profileSwitchBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        valign: Gtk.Align.CENTER,
        css_classes: ['linked'],
    });

    const perfBtn = new Gtk.Button({
        icon_name: 'power-profile-performance-symbolic',
        tooltip_text: _('Performance'),
    });
    perfBtn.connect('clicked', () => powerController.setActiveProfile(POWER_PROFILE_PERFORMANCE));

    const balBtn = new Gtk.Button({
        icon_name: 'power-profile-balanced-symbolic',
        tooltip_text: _('Balanced'),
    });
    balBtn.connect('clicked', () => powerController.setActiveProfile(POWER_PROFILE_BALANCED));

    const saveBtn = new Gtk.Button({
        icon_name: 'power-profile-power-saver-symbolic',
        tooltip_text: _('Power Saver'),
    });
    saveBtn.connect('clicked', () => powerController.setActiveProfile(POWER_PROFILE_POWER_SAVER));

    profileSwitchBox.append(perfBtn);
    profileSwitchBox.append(balBtn);
    profileSwitchBox.append(saveBtn);
    activeProfileRow.add_suffix(profileSwitchBox);

    const powerSourceRow = new Adw.ActionRow({
        title: _('Power Source & Battery'),
        subtitle: _('Reading telemetry…'),
    });
    const powerSourceIcon = addPrefixIcon(powerSourceRow, 'battery-good-symbolic');
    statusGroup.add(powerSourceRow);

    const batteryHealthRow = new Adw.ActionRow({
        title: _('Battery Health & Power Draw'),
        subtitle: _('Analyzing battery telemetry…'),
        visible: false,
    });
    addPrefixIcon(batteryHealthRow, 'utilities-system-monitor-symbolic');
    statusGroup.add(batteryHealthRow);

    const activeScenarioRow = new Adw.ActionRow({
        title: _('Active Scenario'),
        subtitle: _('Standard / Manual control'),
    });
    const activeScenarioIcon = addPrefixIcon(activeScenarioRow, 'emblem-system-symbolic');
    statusGroup.add(activeScenarioRow);

    const quickGroup = new Adw.PreferencesGroup({
        title: _('Quick Settings Menu'),
        description: _('Manage how power and sleep options appear in the GNOME Quick Settings panel.'),
    });
    page.add(quickGroup);

    const enableRow = new Adw.SwitchRow({
        title: _('Show Power Profiles in Quick Settings'),
        subtitle: _('Display Performance, Balanced, and Power Saver buttons in the menu'),
    });
    addPrefixIcon(enableRow, 'power-profile-balanced-symbolic');
    settings.bind('enable-power-profiles', enableRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    quickGroup.add(enableRow);

    const quickHibRow = new Adw.SwitchRow({
        title: _('Show Hibernate Action in Quick Settings'),
        subtitle: _('One-click button to hibernate the system from the menu'),
    });
    addPrefixIcon(quickHibRow, 'weather-snow-symbolic');
    settings.bind('show-quick-hibernate', quickHibRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    quickGroup.add(quickHibRow);

    const quickSuspRow = new Adw.SwitchRow({
        title: _('Show Suspend Action in Quick Settings'),
        subtitle: _('One-click button to put the system to sleep from the menu'),
    });
    addPrefixIcon(quickSuspRow, 'weather-clear-night-symbolic');
    settings.bind('show-quick-suspend', quickSuspRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    quickGroup.add(quickSuspRow);

    const quickCaffeineRow = new Adw.SwitchRow({
        title: _('Show Keep Awake (Caffeine) in Quick Settings'),
        subtitle: _('Prevent screen blanking and automatic system sleep from the top bar menu'),
    });
    addPrefixIcon(quickCaffeineRow, 'my-caffeine-on-symbolic');
    settings.bind('show-quick-caffeine', quickCaffeineRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    quickGroup.add(quickCaffeineRow);

    const caffeineDurIdx = Math.max(
        0,
        caffeineDurationOptions.findIndex(o => o.seconds === settings.get_int('caffeine-default-duration'))
    );
    const caffeineDurRow = new Adw.ComboRow({
        title: _('Keep Awake Duration'),
        subtitle: _('Default duration before Keep Awake automatically turns off'),
        model: createModelFromList(caffeineDurationOptions),
        selected: caffeineDurIdx,
    });
    addPrefixIcon(caffeineDurRow, 'preferences-system-time-symbolic');
    caffeineDurRow.connect('notify::selected', () => {
        const secs = caffeineDurationOptions[caffeineDurRow.selected]?.seconds ?? 0;
        settings.set_int('caffeine-default-duration', secs);
    });
    quickGroup.add(caffeineDurRow);

    const scenariosGroup = new Adw.PreferencesGroup({
        title: _('Smart Power Scenarios (Windows-like Automation)'),
        description: _('Automatically adjust energy profiles and performance according to hardware power states.'),
    });
    page.add(scenariosGroup);

    const enableScenariosRow = new Adw.SwitchRow({
        title: _('Enable Smart Power Scenarios'),
        subtitle: _('Automatically switch profiles based on AC charger connection and battery state'),
    });
    addPrefixIcon(enableScenariosRow, 'emblem-system-symbolic');
    settings.bind('power-scenarios-enabled', enableScenariosRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    scenariosGroup.add(enableScenariosRow);

    const acRow = new Adw.ComboRow({
        title: _('When Plugged In (AC Power)'),
        subtitle: _('Profile to apply when the charger is connected'),
        model: createModelFromList(scenarioOptions),
        selected: getIndexForId(scenarioOptions, settings.get_string('power-ac-profile')),
    });
    addPrefixIcon(acRow, 'ac-adapter-symbolic');
    acRow.connect('notify::selected', () => {
        const selected = scenarioOptions[acRow.selected]?.id || POWER_PROFILE_PERFORMANCE;
        settings.set_string('power-ac-profile', selected);
    });
    scenariosGroup.add(acRow);

    const batRow = new Adw.ComboRow({
        title: _('When on Battery Power'),
        subtitle: _('Profile to apply when running on battery'),
        model: createModelFromList(scenarioOptions),
        selected: getIndexForId(scenarioOptions, settings.get_string('power-battery-profile')),
    });
    addPrefixIcon(batRow, 'battery-good-symbolic');
    batRow.connect('notify::selected', () => {
        const selected = scenarioOptions[batRow.selected]?.id || POWER_PROFILE_BALANCED;
        settings.set_string('power-battery-profile', selected);
    });
    scenariosGroup.add(batRow);

    const lowBatRow = new Adw.SwitchRow({
        title: _('Low Battery Auto Saver'),
        subtitle: _('Automatically switch to Power Saver when battery level drops below threshold'),
    });
    addPrefixIcon(lowBatRow, 'battery-caution-symbolic');
    settings.bind('power-low-battery-enabled', lowBatRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    scenariosGroup.add(lowBatRow);

    const thresholdRow = new Adw.SpinRow({
        title: _('Low Battery Threshold (%)'),
        subtitle: _('Battery percentage that triggers maximum power saving'),
        adjustment: new Gtk.Adjustment({
            lower: 5,
            upper: 50,
            step_increment: 5,
            page_increment: 10,
            value: settings.get_int('power-low-battery-threshold'),
        }),
    });
    addPrefixIcon(thresholdRow, 'battery-low-symbolic');
    thresholdRow.connect('notify::value', () => {
        settings.set_int('power-low-battery-threshold', Math.round(thresholdRow.value));
    });
    scenariosGroup.add(thresholdRow);

    const syncScenarioSensitivity = () => {
        const active = enableScenariosRow.active;
        acRow.sensitive = active;
        batRow.sensitive = active;
        lowBatRow.sensitive = active;
        thresholdRow.sensitive = active && lowBatRow.active;
    };
    enableScenariosRow.connect('notify::active', syncScenarioSensitivity);
    lowBatRow.connect('notify::active', syncScenarioSensitivity);
    syncScenarioSensitivity();

    const scheduleGroup = new Adw.PreferencesGroup({
        title: _('Day / Night Schedule Automation'),
        description: _('Synchronize energy profiles with solar or custom Day/Night periods.'),
    });
    page.add(scheduleGroup);

    const autoSwitchRow = new Adw.SwitchRow({
        title: _('Automate by Day / Night Schedule'),
        subtitle: _('Switch power profiles when Day or Night transitions trigger'),
    });
    addPrefixIcon(autoSwitchRow, 'alarm-symbolic');
    settings.bind('auto-power-profile-schedule', autoSwitchRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    scheduleGroup.add(autoSwitchRow);

    const lightRow = new Adw.ComboRow({
        title: _('Day Mode Profile'),
        subtitle: _('Energy profile to apply during daytime'),
        model: createModelFromList(profileOptions),
        selected: getIndexForId(profileOptions, settings.get_string('light-power-profile')),
    });
    addPrefixIcon(lightRow, 'weather-clear-symbolic');
    lightRow.connect('notify::selected', () => {
        const selectedId = profileOptions[lightRow.selected]?.id || POWER_PROFILE_BALANCED;
        settings.set_string('light-power-profile', selectedId);
    });
    scheduleGroup.add(lightRow);

    const darkRow = new Adw.ComboRow({
        title: _('Night Mode Profile'),
        subtitle: _('Energy profile to apply during nighttime (e.g. quiet fan operation)'),
        model: createModelFromList(profileOptions),
        selected: getIndexForId(profileOptions, settings.get_string('dark-power-profile')),
    });
    addPrefixIcon(darkRow, 'weather-clear-night-symbolic');
    darkRow.connect('notify::selected', () => {
        const selectedId = profileOptions[darkRow.selected]?.id || POWER_PROFILE_POWER_SAVER;
        settings.set_string('dark-power-profile', selectedId);
    });
    scheduleGroup.add(darkRow);

    const syncScheduleSensitivity = () => {
        const active = autoSwitchRow.active;
        lightRow.sensitive = active;
        darkRow.sensitive = active;
    };
    autoSwitchRow.connect('notify::active', syncScheduleSensitivity);
    syncScheduleSensitivity();

    const displayPlansGroup = new Adw.PreferencesGroup({
        title: _('Power Plans: Display & Inactivity'),
        description: _('Fine-tune display blanking and screen timeout behavior for each power state.'),
    });
    page.add(displayPlansGroup);

    const enableTimeoutsRow = new Adw.SwitchRow({
        title: _('Adaptive Screen Inactivity Timeout'),
        subtitle: _('Automatically adjust screen blank delay based on whether you are on AC or Battery'),
    });
    addPrefixIcon(enableTimeoutsRow, 'preferences-desktop-display-symbolic');
    settings.bind('power-profile-screen-timeouts', enableTimeoutsRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    displayPlansGroup.add(enableTimeoutsRow);

    const timeoutAcRow = new Adw.ComboRow({
        title: _('Screen Blank on AC Power'),
        subtitle: _('Turn off display after idle time while plugged in'),
        model: createModelFromList(timeoutOptions),
        selected: getIndexForSeconds(timeoutOptions, settings.get_int('power-screen-timeout-ac')),
    });
    addPrefixIcon(timeoutAcRow, 'ac-adapter-symbolic');
    timeoutAcRow.connect('notify::selected', () => {
        const secs = timeoutOptions[timeoutAcRow.selected]?.seconds ?? 900;
        settings.set_int('power-screen-timeout-ac', secs);
    });
    displayPlansGroup.add(timeoutAcRow);

    const timeoutBatRow = new Adw.ComboRow({
        title: _('Screen Blank on Battery'),
        subtitle: _('Turn off display after idle time on battery'),
        model: createModelFromList(timeoutOptions),
        selected: getIndexForSeconds(timeoutOptions, settings.get_int('power-screen-timeout-battery')),
    });
    addPrefixIcon(timeoutBatRow, 'battery-good-symbolic');
    timeoutBatRow.connect('notify::selected', () => {
        const secs = timeoutOptions[timeoutBatRow.selected]?.seconds ?? 300;
        settings.set_int('power-screen-timeout-battery', secs);
    });
    displayPlansGroup.add(timeoutBatRow);

    const timeoutSaverRow = new Adw.ComboRow({
        title: _('Screen Blank in Power Saver'),
        subtitle: _('Aggressively turn off display during low battery or power saver mode'),
        model: createModelFromList(timeoutOptions),
        selected: getIndexForSeconds(timeoutOptions, settings.get_int('power-screen-timeout-saver')),
    });
    addPrefixIcon(timeoutSaverRow, 'power-profile-power-saver-symbolic');
    timeoutSaverRow.connect('notify::selected', () => {
        const secs = timeoutOptions[timeoutSaverRow.selected]?.seconds ?? 120;
        settings.set_int('power-screen-timeout-saver', secs);
    });
    displayPlansGroup.add(timeoutSaverRow);

    const oledRow = new Adw.SwitchRow({
        title: _('OLED / Battery Dark Style Saver'),
        subtitle: _('Force dark mode when in Power Saver to maximize OLED display battery life'),
    });
    addPrefixIcon(oledRow, 'weather-clear-night-symbolic');
    settings.bind('power-sync-oled-dark', oledRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    displayPlansGroup.add(oledRow);

    const lowHzRow = new Adw.SwitchRow({
        title: _('Auto 60 Hz Refresh Rate on Battery / Saver'),
        subtitle: _('Automatically reduce high refresh rate displays (120/144/165 Hz) to 60 Hz in Power Saver or on battery'),
    });
    addPrefixIcon(lowHzRow, 'video-display-symbolic');
    settings.bind('power-auto-low-refresh-rate', lowHzRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    displayPlansGroup.add(lowHzRow);

    const kbdAutoRow = new Adw.SwitchRow({
        title: _('Automate Keyboard Backlight'),
        subtitle: _('Turn on keyboard backlight at night and off during daytime via UPower D-Bus'),
    });
    addPrefixIcon(kbdAutoRow, 'input-keyboard-symbolic');
    settings.bind('kbd-backlight-auto', kbdAutoRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    displayPlansGroup.add(kbdAutoRow);

    const kbdLevelRow = new Adw.SpinRow({
        title: _('Night Keyboard Backlight Level (%)'),
        subtitle: _('Target keyboard backlight brightness at night'),
        adjustment: new Gtk.Adjustment({
            lower: 10,
            upper: 100,
            step_increment: 10,
            page_increment: 25,
            value: settings.get_int('kbd-backlight-night-level'),
        }),
    });
    addPrefixIcon(kbdLevelRow, 'display-brightness-symbolic');
    kbdLevelRow.connect('notify::value', () => {
        settings.set_int('kbd-backlight-night-level', Math.round(kbdLevelRow.value));
    });
    displayPlansGroup.add(kbdLevelRow);

    const kbdSaverOffRow = new Adw.SwitchRow({
        title: _('Turn Off Keyboard Backlight in Power Saver'),
        subtitle: _('Extinguish keyboard LEDs when Power Saver profile is active'),
    });
    addPrefixIcon(kbdSaverOffRow, 'power-profile-power-saver-symbolic');
    settings.bind('kbd-backlight-off-in-saver', kbdSaverOffRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    displayPlansGroup.add(kbdSaverOffRow);

    const syncKbdSensitivity = () => {
        kbdLevelRow.sensitive = kbdAutoRow.active;
    };
    kbdAutoRow.connect('notify::active', syncKbdSensitivity);
    syncKbdSensitivity();

    const syncTimeoutSensitivity = () => {
        const active = enableTimeoutsRow.active;
        timeoutAcRow.sensitive = active;
        timeoutBatRow.sensitive = active;
        timeoutSaverRow.sensitive = active;
    };
    enableTimeoutsRow.connect('notify::active', syncTimeoutSensitivity);
    syncTimeoutSensitivity();

    if (gsdPowerSettings) {
        const lidGroup = new Adw.PreferencesGroup({
            title: _('Laptop Lid & Inactivity Sleep Actions'),
            description: _('Configure what happens when closing the laptop lid or after prolonged inactivity.'),
        });
        page.add(lidGroup);

        const lidAcRow = new Adw.ComboRow({
            title: _('Lid Close on AC Power'),
            subtitle: _('Action when closing laptop lid while plugged in'),
            model: createModelFromList(lidActionOptions),
            selected: getIndexForId(lidActionOptions, gsdPowerSettings.get_string('lid-close-ac-action')),
        });
        addPrefixIcon(lidAcRow, 'ac-adapter-symbolic');
        lidAcRow.connect('notify::selected', () => {
            const action = lidActionOptions[lidAcRow.selected]?.id || 'suspend';
            gsdPowerSettings.set_string('lid-close-ac-action', action);
        });
        lidGroup.add(lidAcRow);

        const lidBatRow = new Adw.ComboRow({
            title: _('Lid Close on Battery'),
            subtitle: _('Action when closing laptop lid on battery'),
            model: createModelFromList(lidActionOptions),
            selected: getIndexForId(lidActionOptions, gsdPowerSettings.get_string('lid-close-battery-action')),
        });
        addPrefixIcon(lidBatRow, 'battery-good-symbolic');
        lidBatRow.connect('notify::selected', () => {
            const action = lidActionOptions[lidBatRow.selected]?.id || 'suspend';
            gsdPowerSettings.set_string('lid-close-battery-action', action);
        });
        lidGroup.add(lidBatRow);

        const sleepTypeAcRow = new Adw.ComboRow({
            title: _('Prolonged Inactivity Sleep Type on AC Power'),
            subtitle: _('Whether to sleep or hibernate after inactivity timeout while plugged in'),
            model: createModelFromList(sleepTypeOptions),
            selected: getIndexForId(sleepTypeOptions, gsdPowerSettings.get_string('sleep-inactive-ac-type')),
        });
        addPrefixIcon(sleepTypeAcRow, 'preferences-system-time-symbolic');
        sleepTypeAcRow.connect('notify::selected', () => {
            const val = sleepTypeOptions[sleepTypeAcRow.selected]?.id || 'nothing';
            gsdPowerSettings.set_string('sleep-inactive-ac-type', val);
        });
        lidGroup.add(sleepTypeAcRow);

        const sleepTypeBatRow = new Adw.ComboRow({
            title: _('Prolonged Inactivity Sleep Type on Battery'),
            subtitle: _('Whether to sleep or hibernate after inactivity timeout'),
            model: createModelFromList(sleepTypeOptions),
            selected: getIndexForId(sleepTypeOptions, gsdPowerSettings.get_string('sleep-inactive-battery-type')),
        });
        addPrefixIcon(sleepTypeBatRow, 'preferences-system-time-symbolic');
        sleepTypeBatRow.connect('notify::selected', () => {
            const val = sleepTypeOptions[sleepTypeBatRow.selected]?.id || 'suspend';
            gsdPowerSettings.set_string('sleep-inactive-battery-type', val);
        });
        lidGroup.add(sleepTypeBatRow);
    }

    const hibGroup = new Adw.PreferencesGroup({
        title: _('Hibernation & Deep Sleep'),
        description: _('Systemd login1 hibernation state, resume partition, and emergency fallback.'),
    });
    page.add(hibGroup);

    const hibStatusRow = new Adw.ActionRow({
        title: _('Systemd Hibernation Capability'),
        subtitle: _('Checking systemd login1…'),
    });
    const hibStatusIcon = addPrefixIcon(hibStatusRow, 'weather-snow-symbolic');
    hibGroup.add(hibStatusRow);

    const hibActionBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        valign: Gtk.Align.CENTER,
    });
    const hibTestBtn = new Gtk.Button({
        child: new Adw.ButtonContent({
            icon_name: 'weather-snow-symbolic',
            label: _('Hibernate Now'),
        }),
    });
    hibTestBtn.connect('clicked', () => swapHibernateController.hibernate(true));
    hibActionBox.append(hibTestBtn);

    const hybridSleepBtn = new Gtk.Button({
        child: new Adw.ButtonContent({
            icon_name: 'weather-clear-night-symbolic',
            label: _('Hybrid Sleep'),
        }),
    });
    hybridSleepBtn.connect('clicked', () => swapHibernateController.hybridSleep(true));
    hibActionBox.append(hybridSleepBtn);

    hibStatusRow.add_suffix(hibActionBox);

    const preferSthRow = new Adw.SwitchRow({
        title: _('Prefer Suspend-then-Hibernate'),
        subtitle: _('Use systemd SuspendThenHibernate for sleep actions when supported by the system'),
    });
    addPrefixIcon(preferSthRow, 'weather-clear-night-symbolic');
    settings.bind('prefer-suspend-then-hibernate', preferSthRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    hibGroup.add(preferSthRow);

    const critHibRow = new Adw.SwitchRow({
        title: _('Emergency Auto-Hibernate on Critical Battery'),
        subtitle: _('Save session state to swap and hibernate when battery is almost exhausted'),
    });
    addPrefixIcon(critHibRow, 'battery-empty-symbolic');
    settings.bind('power-critical-battery-hibernate', critHibRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    hibGroup.add(critHibRow);

    const critThreshRow = new Adw.SpinRow({
        title: _('Critical Battery Threshold (%)'),
        subtitle: _('Battery percentage that triggers emergency hibernation'),
        adjustment: new Gtk.Adjustment({
            lower: 2,
            upper: 15,
            step_increment: 1,
            page_increment: 2,
            value: settings.get_int('power-critical-battery-threshold'),
        }),
    });
    addPrefixIcon(critThreshRow, 'dialog-warning-symbolic');
    critThreshRow.connect('notify::value', () => {
        settings.set_int('power-critical-battery-threshold', Math.round(critThreshRow.value));
    });
    hibGroup.add(critThreshRow);

    critHibRow.connect('notify::active', () => {
        critThreshRow.sensitive = critHibRow.active;
    });
    critThreshRow.sensitive = critHibRow.active;

    const swapGroup = new Adw.PreferencesGroup({
        title: _('Swap Memory Management'),
        description: _('Swap space usage and kernel paging aggressiveness (/proc/swaps).'),
    });
    const refreshSwapBtn = new Gtk.Button({
        icon_name: 'view-refresh-symbolic',
        valign: Gtk.Align.CENTER,
        tooltip_text: _('Refresh'),
        css_classes: ['flat'],
    });
    refreshSwapBtn.connect('clicked', () => {
        swapHibernateController.refreshSwapStats();
    });
    swapGroup.set_header_suffix(refreshSwapBtn);
    page.add(swapGroup);

    const swapUsageRow = new Adw.ActionRow({
        title: _('Swap Space Usage'),
        subtitle: _('Reading swap information…'),
    });
    addPrefixIcon(swapUsageRow, 'drive-harddisk-symbolic');
    const swapLevelBar = new Gtk.LevelBar({
        min_value: 0,
        max_value: 100,
        value: 0,
        valign: Gtk.Align.CENTER,
        width_request: 110,
    });
    swapUsageRow.add_suffix(swapLevelBar);
    swapGroup.add(swapUsageRow);

    const swappinessRow = new Adw.ActionRow({
        title: _('Kernel Swappiness (vm.swappiness)'),
        subtitle: _('Loading…'),
    });
    addPrefixIcon(swappinessRow, 'applications-system-symbolic');
    swapGroup.add(swappinessRow);

    const swapDeviceRow = new Adw.ActionRow({
        title: _('Active Swap Device'),
        subtitle: _('None'),
    });
    addPrefixIcon(swapDeviceRow, 'drive-multidisk-symbolic');
    swapGroup.add(swapDeviceRow);

    const swapHealthRow = new Adw.ActionRow({
        title: _('Hibernation Memory Capacity'),
        subtitle: _('Analyzing…'),
    });
    const swapHealthIcon = addPrefixIcon(swapHealthRow, 'dialog-information-symbolic');
    swapGroup.add(swapHealthRow);

    const setButtonActiveStyle = (btn, isActive) => {
        if (isActive)
            btn.add_css_class('suggested-action');
        else
            btn.remove_css_class('suggested-action');
    };

    const updateDaemonUI = () => {
        const isAvail = powerController.isAvailable();
        const active = powerController.getActiveProfile();
        const onBat = powerController.isOnBattery();
        const pct = powerController.getBatteryPercentage();
        const bState = powerController.getBatteryState();
        const hasBat = powerController.hasBattery();

        if (hasBat) {
            let stateStr = '';
            let timeStr = '';
            if (bState === BATTERY_STATE_CHARGING) {
                stateStr = _('Charging');
                timeStr = formatDurationSeconds(powerController.getTimeToFull());
                powerSourceIcon.set_from_icon_name('battery-full-charging-symbolic');
            } else if (bState === BATTERY_STATE_DISCHARGING) {
                stateStr = _('Discharging');
                timeStr = formatDurationSeconds(powerController.getTimeToEmpty());
                powerSourceIcon.set_from_icon_name(
                    pct <= 20 ? 'battery-caution-symbolic' : 'battery-good-symbolic'
                );
            } else if (bState === BATTERY_STATE_FULLY_CHARGED) {
                stateStr = _('Fully charged');
                powerSourceIcon.set_from_icon_name('battery-full-charged-symbolic');
            } else {
                powerSourceIcon.set_from_icon_name(
                    onBat ? 'battery-good-symbolic' : 'ac-adapter-symbolic'
                );
            }

            const details = [stateStr, timeStr].filter(Boolean).join(' • ');
            const stateTag = details ? ` (${details})` : '';
            powerSourceRow.subtitle = onBat
                ? `${_('On Battery')}: ${pct}%${stateTag}`
                : `${_('Connected to AC Charger')}: ${pct}%${stateTag}`;

            const rateWatts = powerController.getEnergyRate();
            const healthPct = powerController.getBatteryHealth();
            const cycles = powerController.getChargeCycles();
            const healthParts = [];
            if (rateWatts > 0)
                healthParts.push(`${_('Power Draw')}: ${rateWatts.toFixed(1)} W`);
            if (healthPct > 0)
                healthParts.push(`${_('Health')}: ${healthPct}%`);
            if (cycles > 0)
                healthParts.push(`${_('Cycles')}: ${cycles}`);

            batteryHealthRow.visible = healthParts.length > 0;
            if (healthParts.length > 0)
                batteryHealthRow.subtitle = healthParts.join(' • ');
        } else {
            powerSourceIcon.set_from_icon_name('ac-adapter-symbolic');
            powerSourceRow.subtitle = _('Desktop / AC Power (No battery detected)');
            batteryHealthRow.visible = false;
        }

        const lastScen = powerController.getLastScenario();
        if (lastScen === 'low-battery') {
            activeScenarioIcon.set_from_icon_name('dialog-warning-symbolic');
            activeScenarioRow.subtitle = _('Low Battery Threshold triggered');
        } else if (lastScen === 'battery') {
            activeScenarioIcon.set_from_icon_name('battery-good-symbolic');
            activeScenarioRow.subtitle = _('Battery Scenario active');
        } else if (lastScen === 'ac') {
            activeScenarioIcon.set_from_icon_name('ac-adapter-symbolic');
            activeScenarioRow.subtitle = _('AC Power Scenario active');
        } else {
            activeScenarioIcon.set_from_icon_name('emblem-system-symbolic');
            activeScenarioRow.subtitle = _('Standard / Manual control');
        }

        let profileName = _('Not set');
        if (active === POWER_PROFILE_PERFORMANCE) {
            profileName = _('Performance (Maximum Power)');
            activeProfileIcon.set_from_icon_name('power-profile-performance-symbolic');
        } else if (active === POWER_PROFILE_BALANCED) {
            profileName = _('Balanced');
            activeProfileIcon.set_from_icon_name('power-profile-balanced-symbolic');
        } else if (active === POWER_PROFILE_POWER_SAVER) {
            profileName = _('Power Saver (Maximum Battery Life)');
            activeProfileIcon.set_from_icon_name('power-profile-power-saver-symbolic');
        }

        activeProfileRow.subtitle = profileName;

        perfBtn.sensitive = isAvail;
        balBtn.sensitive = isAvail;
        saveBtn.sensitive = isAvail;

        setButtonActiveStyle(perfBtn, active === POWER_PROFILE_PERFORMANCE);
        setButtonActiveStyle(balBtn, active === POWER_PROFILE_BALANCED);
        setButtonActiveStyle(saveBtn, active === POWER_PROFILE_POWER_SAVER);
    };

    const updateSwapHibUI = () => {
        const swap = swapHibernateController.getSwapStats();
        const canHib = swapHibernateController.canHibernate();
        const rawHib = swapHibernateController.getHibernateCapabilityRaw();

        if (swap.totalKb > 0) {
            swapUsageRow.subtitle = `${formatBytes(swap.totalKb)} ${_('total')} • ${formatBytes(swap.usedKb)} ${_('used')} (${swap.percent}%) • ${formatBytes(swap.freeKb)} ${_('free')}`;
            swapLevelBar.visible = true;
            swapLevelBar.value = Math.min(100, Math.max(0, swap.percent));
        } else {
            swapUsageRow.subtitle = _('No swap partition or file detected');
            swapLevelBar.visible = false;
        }

        swappinessRow.subtitle = `${swap.swappiness} (${swap.swappiness <= 20 ? _('Low - favors RAM over disk') : _('Default kernel paging')})`;

        if (swap.devices.length > 0) {
            const dev = swap.devices[0];
            swapDeviceRow.subtitle = `${dev.filename} [${dev.type}, ${_('priority')}: ${dev.priority}, ${_('size')}: ${formatBytes(dev.sizeKb)}]`;
        } else {
            swapDeviceRow.subtitle = _('No active swap devices');
        }

        if (swap.totalKb >= swap.memTotalKb && swap.memTotalKb > 0) {
            swapHealthIcon.set_from_icon_name('emblem-ok-symbolic');
            swapHealthRow.subtitle = _('Swap size (%s) is greater than RAM (%s) — optimal for full memory dumps')
                .replace('%s', formatBytes(swap.totalKb))
                .replace('%s', formatBytes(swap.memTotalKb));
        } else if (swap.totalKb > 0) {
            swapHealthIcon.set_from_icon_name('dialog-warning-symbolic');
            swapHealthRow.subtitle = _('Swap size (%s) is smaller than RAM (%s). Recommended to enlarge swap for reliable hibernation.')
                .replace('%s', formatBytes(swap.totalKb))
                .replace('%s', formatBytes(swap.memTotalKb));
        } else {
            swapHealthIcon.set_from_icon_name('dialog-error-symbolic');
            swapHealthRow.subtitle = _('Swap space is required for hibernation.');
        }

        if (canHib) {
            hibStatusIcon.set_from_icon_name('emblem-ok-symbolic');
            hibStatusRow.subtitle = _('Ready (Kernel & systemd support active)');
            hibTestBtn.sensitive = true;
        } else {
            const devName = swap.devices.length > 0 ? swap.devices[0].filename : 'swap';
            hibStatusIcon.set_from_icon_name('dialog-warning-symbolic');
            hibStatusRow.subtitle = _('Not configured in kernel (Status: %s). Configure resume=%s in GRUB.')
                .replace('%s', rawHib)
                .replace('%s', devName);
            hibTestBtn.sensitive = false;
        }
        hybridSleepBtn.sensitive = swapHibernateController.canHybridSleep();
        preferSthRow.sensitive = swapHibernateController.canSuspendThenHibernate();
    };

    const removePowerListener = powerController.addChangeListener(updateDaemonUI);
    const removeSwapListener = swapHibernateController.addChangeListener(updateSwapHibUI);

    updateDaemonUI();
    updateSwapHibUI();

    return {
        page,
        destroy() {
            removePowerListener();
            removeSwapListener();
            powerController.destroy();
            swapHibernateController.destroy();
        },
    };
}
