import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GObject from 'gi://GObject';
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

const TIMEOUT_OPTIONS = [
    {seconds: 60, label: '1 ' + _('minute')},
    {seconds: 120, label: '2 ' + _('minutes')},
    {seconds: 180, label: '3 ' + _('minutes')},
    {seconds: 300, label: '5 ' + _('minutes')},
    {seconds: 600, label: '10 ' + _('minutes')},
    {seconds: 900, label: '15 ' + _('minutes')},
    {seconds: 1800, label: '30 ' + _('minutes')},
    {seconds: 0, label: _('Never')},
];

const SLEEP_ACTION_OPTIONS = [
    {id: 'suspend', label: _('Suspend (Sleep)')},
    {id: 'hibernate', label: _('Hibernate')},
    {id: 'blank', label: _('Turn Off Display')},
    {id: 'nothing', label: _('Do Nothing')},
];

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

function getIndexForSeconds(seconds) {
    const idx = TIMEOUT_OPTIONS.findIndex(item => item.seconds === seconds);
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

export function createPowerPage(window, settings) {
    const signalIds = [];
    const powerController = new PowerController(settings);
    const swapHibernateController = new SwapHibernateController(settings);

    let gsdPowerSettings = null;
    try {
        gsdPowerSettings = new Gio.Settings({schema_id: 'org.gnome.settings-daemon.plugins.power'});
    } catch {
        // GSD Power settings unavailable
    }

    const profileOptions = getProfileOptions();
    const scenarioOptions = getScenarioProfileOptions();

    const page = new Adw.PreferencesPage({
        title: _('Power'),
        icon_name: 'power-profile-balanced-symbolic',
    });

    // ==========================================
    // 1. Quick Settings Group
    // ==========================================
    const quickGroup = new Adw.PreferencesGroup({
        title: _('Quick Settings Menu'),
        description: _('Manage how power and sleep options appear in the GNOME Quick Settings panel.'),
    });
    page.add(quickGroup);

    const enableRow = new Adw.SwitchRow({
        title: _('Show Power Profiles in Quick Settings'),
        subtitle: _('Display Performance, Balanced, and Power Saver buttons in the menu'),
    });
    settings.bind('enable-power-profiles', enableRow, 'active', 0);
    quickGroup.add(enableRow);

    const quickHibRow = new Adw.SwitchRow({
        title: _('Show Hibernate Action in Quick Settings'),
        subtitle: _('One-click button to hibernate the system from the menu'),
    });
    settings.bind('show-quick-hibernate', quickHibRow, 'active', 0);
    quickGroup.add(quickHibRow);

    const quickSuspRow = new Adw.SwitchRow({
        title: _('Show Suspend Action in Quick Settings'),
        subtitle: _('One-click button to put the system to sleep from the menu'),
    });
    settings.bind('show-quick-suspend', quickSuspRow, 'active', 0);
    quickGroup.add(quickSuspRow);

    // ==========================================
    // 2. Smart Power Scenarios (AC / Battery / Thresholds)
    // ==========================================
    const scenariosGroup = new Adw.PreferencesGroup({
        title: _('Smart Power Scenarios (Windows-like Automation)'),
        description: _('Automatically adjust energy profiles and performance according to hardware power states.'),
    });
    page.add(scenariosGroup);

    const enableScenariosRow = new Adw.SwitchRow({
        title: _('Enable Smart Power Scenarios'),
        subtitle: _('Automatically switch profiles based on AC charger connection and battery state'),
    });
    settings.bind('power-scenarios-enabled', enableScenariosRow, 'active', 0);
    scenariosGroup.add(enableScenariosRow);

    const acModel = createModelFromList(scenarioOptions);
    const acRow = new Adw.ComboRow({
        title: _('When Plugged In (AC Power)'),
        subtitle: _('Profile to apply when the charger is connected'),
        model: acModel,
    });
    acRow.selected = getIndexForId(scenarioOptions, settings.get_string('power-ac-profile'));
    signalIds.push(acRow.connect('notify::selected', () => {
        const selected = scenarioOptions[acRow.selected]?.id || POWER_PROFILE_PERFORMANCE;
        settings.set_string('power-ac-profile', selected);
    }));
    scenariosGroup.add(acRow);

    const batModel = createModelFromList(scenarioOptions);
    const batRow = new Adw.ComboRow({
        title: _('When on Battery Power'),
        subtitle: _('Profile to apply when running on battery'),
        model: batModel,
    });
    batRow.selected = getIndexForId(scenarioOptions, settings.get_string('power-battery-profile'));
    signalIds.push(batRow.connect('notify::selected', () => {
        const selected = scenarioOptions[batRow.selected]?.id || POWER_PROFILE_BALANCED;
        settings.set_string('power-battery-profile', selected);
    }));
    scenariosGroup.add(batRow);

    const lowBatRow = new Adw.SwitchRow({
        title: _('Low Battery Auto Saver'),
        subtitle: _('Automatically switch to Power Saver when battery level drops below threshold'),
    });
    settings.bind('power-low-battery-enabled', lowBatRow, 'active', 0);
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
    signalIds.push(thresholdRow.connect('notify::value', () => {
        settings.set_int('power-low-battery-threshold', Math.round(thresholdRow.value));
    }));
    scenariosGroup.add(thresholdRow);

    const syncScenarioSensitivity = () => {
        const active = enableScenariosRow.active;
        acRow.sensitive = active;
        batRow.sensitive = active;
        lowBatRow.sensitive = active;
        thresholdRow.sensitive = active && lowBatRow.active;
    };
    signalIds.push(enableScenariosRow.connect('notify::active', syncScenarioSensitivity));
    signalIds.push(lowBatRow.connect('notify::active', syncScenarioSensitivity));
    syncScenarioSensitivity();

    // ==========================================
    // 3. Screen Inactivity & OLED Power Plans
    // ==========================================
    const displayPlansGroup = new Adw.PreferencesGroup({
        title: _('Power Plans: Display & Inactivity'),
        description: _('Fine-tune display blanking and screen timeout behavior for each power state.'),
    });
    page.add(displayPlansGroup);

    const enableTimeoutsRow = new Adw.SwitchRow({
        title: _('Adaptive Screen Inactivity Timeout'),
        subtitle: _('Automatically adjust screen blank delay based on whether you are on AC or Battery'),
    });
    settings.bind('power-profile-screen-timeouts', enableTimeoutsRow, 'active', 0);
    displayPlansGroup.add(enableTimeoutsRow);

    const timeoutAcModel = createModelFromList(TIMEOUT_OPTIONS);
    const timeoutAcRow = new Adw.ComboRow({
        title: _('Screen Blank on AC Power'),
        subtitle: _('Turn off display after idle time while plugged in'),
        model: timeoutAcModel,
    });
    timeoutAcRow.selected = getIndexForSeconds(settings.get_int('power-screen-timeout-ac'));
    signalIds.push(timeoutAcRow.connect('notify::selected', () => {
        const secs = TIMEOUT_OPTIONS[timeoutAcRow.selected]?.seconds ?? 900;
        settings.set_int('power-screen-timeout-ac', secs);
    }));
    displayPlansGroup.add(timeoutAcRow);

    const timeoutBatModel = createModelFromList(TIMEOUT_OPTIONS);
    const timeoutBatRow = new Adw.ComboRow({
        title: _('Screen Blank on Battery'),
        subtitle: _('Turn off display after idle time on battery'),
        model: timeoutBatModel,
    });
    timeoutBatRow.selected = getIndexForSeconds(settings.get_int('power-screen-timeout-battery'));
    signalIds.push(timeoutBatRow.connect('notify::selected', () => {
        const secs = TIMEOUT_OPTIONS[timeoutBatRow.selected]?.seconds ?? 300;
        settings.set_int('power-screen-timeout-battery', secs);
    }));
    displayPlansGroup.add(timeoutBatRow);

    const timeoutSaverModel = createModelFromList(TIMEOUT_OPTIONS);
    const timeoutSaverRow = new Adw.ComboRow({
        title: _('Screen Blank in Power Saver'),
        subtitle: _('Aggressively turn off display during low battery or power saver mode'),
        model: timeoutSaverModel,
    });
    timeoutSaverRow.selected = getIndexForSeconds(settings.get_int('power-screen-timeout-saver'));
    signalIds.push(timeoutSaverRow.connect('notify::selected', () => {
        const secs = TIMEOUT_OPTIONS[timeoutSaverRow.selected]?.seconds ?? 120;
        settings.set_int('power-screen-timeout-saver', secs);
    }));
    displayPlansGroup.add(timeoutSaverRow);

    const oledRow = new Adw.SwitchRow({
        title: _('OLED / Battery Dark Style Saver'),
        subtitle: _('Force dark mode when in Power Saver to maximize OLED display battery life'),
    });
    settings.bind('power-sync-oled-dark', oledRow, 'active', 0);
    displayPlansGroup.add(oledRow);

    const syncTimeoutSensitivity = () => {
        const active = enableTimeoutsRow.active;
        timeoutAcRow.sensitive = active;
        timeoutBatRow.sensitive = active;
        timeoutSaverRow.sensitive = active;
    };
    signalIds.push(enableTimeoutsRow.connect('notify::active', syncTimeoutSensitivity));
    syncTimeoutSensitivity();

    // ==========================================
    // 4. Laptop Lid & Sleep Actions (GNOME Power Daemon)
    // ==========================================
    if (gsdPowerSettings) {
        const lidGroup = new Adw.PreferencesGroup({
            title: _('Laptop Lid & Inactivity Sleep Actions'),
            description: _('Configure what happens when closing the laptop lid or after prolonged inactivity.'),
        });
        page.add(lidGroup);

        const lidAcModel = createModelFromList(SLEEP_ACTION_OPTIONS);
        const lidAcRow = new Adw.ComboRow({
            title: _('Lid Close on AC Power'),
            subtitle: _('Action when closing laptop lid while plugged in'),
            model: lidAcModel,
        });
        lidAcRow.selected = getIndexForId(SLEEP_ACTION_OPTIONS, gsdPowerSettings.get_string('lid-close-ac-action'));
        signalIds.push(lidAcRow.connect('notify::selected', () => {
            const action = SLEEP_ACTION_OPTIONS[lidAcRow.selected]?.id || 'suspend';
            gsdPowerSettings.set_string('lid-close-ac-action', action);
        }));
        lidGroup.add(lidAcRow);

        const lidBatModel = createModelFromList(SLEEP_ACTION_OPTIONS);
        const lidBatRow = new Adw.ComboRow({
            title: _('Lid Close on Battery'),
            subtitle: _('Action when closing laptop lid on battery'),
            model: lidBatModel,
        });
        lidBatRow.selected = getIndexForId(SLEEP_ACTION_OPTIONS, gsdPowerSettings.get_string('lid-close-battery-action'));
        signalIds.push(lidBatRow.connect('notify::selected', () => {
            const action = SLEEP_ACTION_OPTIONS[lidBatRow.selected]?.id || 'suspend';
            gsdPowerSettings.set_string('lid-close-battery-action', action);
        }));
        lidGroup.add(lidBatRow);

        const sleepTypeBatModel = createModelFromList([
            {id: 'suspend', label: _('Suspend (Sleep)')},
            {id: 'hibernate', label: _('Hibernate')},
            {id: 'nothing', label: _('Do Nothing')},
        ]);
        const sleepTypeBatRow = new Adw.ComboRow({
            title: _('Prolonged Inactivity Sleep Type on Battery'),
            subtitle: _('Whether to sleep or hibernate after inactivity timeout'),
            model: sleepTypeBatModel,
        });
        sleepTypeBatRow.selected = getIndexForId(SLEEP_ACTION_OPTIONS, gsdPowerSettings.get_string('sleep-inactive-battery-type'));
        signalIds.push(sleepTypeBatRow.connect('notify::selected', () => {
            const val = SLEEP_ACTION_OPTIONS[sleepTypeBatRow.selected]?.id || 'suspend';
            gsdPowerSettings.set_string('sleep-inactive-battery-type', val);
        }));
        lidGroup.add(sleepTypeBatRow);
    }

    // ==========================================
    // 5. Swap Memory Status & Telemetry
    // ==========================================
    const swapGroup = new Adw.PreferencesGroup({
        title: _('Swap Memory Management'),
        description: _('Swap space usage and kernel paging aggressiveness (/proc/swaps).'),
    });
    page.add(swapGroup);

    const swapUsageRow = new Adw.ActionRow({
        title: _('Swap Space Usage'),
        subtitle: _('Reading swap information…'),
    });
    swapGroup.add(swapUsageRow);

    const swappinessRow = new Adw.ActionRow({
        title: _('Kernel Swappiness (vm.swappiness)'),
        subtitle: _('Loading…'),
    });
    swapGroup.add(swappinessRow);

    const swapDeviceRow = new Adw.ActionRow({
        title: _('Active Swap Device'),
        subtitle: _('None'),
    });
    swapGroup.add(swapDeviceRow);

    const swapHealthRow = new Adw.ActionRow({
        title: _('Hibernation Memory Capacity'),
        subtitle: _('Analyzing…'),
    });
    swapGroup.add(swapHealthRow);

    // ==========================================
    // 6. Hibernation Diagnostics & Emergency Trigger
    // ==========================================
    const hibGroup = new Adw.PreferencesGroup({
        title: _('Hibernation & Deep Sleep'),
        description: _('Systemd login1 hibernation state, resume partition, and emergency fallback.'),
    });
    page.add(hibGroup);

    const hibStatusRow = new Adw.ActionRow({
        title: _('Systemd Hibernation Capability'),
        subtitle: _('Checking systemd login1…'),
    });
    hibGroup.add(hibStatusRow);

    const hibActionBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        valign: Gtk.Align.CENTER,
    });
    const hibTestBtn = new Gtk.Button({
        label: _('Hibernate Now'),
        icon_name: 'weather-snow-symbolic',
    });
    hibTestBtn.connect('clicked', () => swapHibernateController.hibernate(true));
    hibActionBox.append(hibTestBtn);
    hibStatusRow.add_suffix(hibActionBox);

    const critHibRow = new Adw.SwitchRow({
        title: _('Emergency Auto-Hibernate on Critical Battery'),
        subtitle: _('Save session state to swap and hibernate when battery is almost exhausted'),
    });
    settings.bind('power-critical-battery-hibernate', critHibRow, 'active', 0);
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
    signalIds.push(critThreshRow.connect('notify::value', () => {
        settings.set_int('power-critical-battery-threshold', Math.round(critThreshRow.value));
    }));
    hibGroup.add(critThreshRow);

    signalIds.push(critHibRow.connect('notify::active', () => {
        critThreshRow.sensitive = critHibRow.active;
    }));
    critThreshRow.sensitive = critHibRow.active;

    // ==========================================
    // 7. Day / Night Schedule Automation
    // ==========================================
    const scheduleGroup = new Adw.PreferencesGroup({
        title: _('Day / Night Schedule Automation'),
        description: _('Synchronize energy profiles with solar or custom Day/Night periods.'),
    });
    page.add(scheduleGroup);

    const autoSwitchRow = new Adw.SwitchRow({
        title: _('Automate by Day / Night Schedule'),
        subtitle: _('Switch power profiles when Day or Night transitions trigger'),
    });
    settings.bind('auto-power-profile-schedule', autoSwitchRow, 'active', 0);
    scheduleGroup.add(autoSwitchRow);

    const lightModel = createModelFromList(profileOptions);
    const lightRow = new Adw.ComboRow({
        title: _('Day Mode Profile'),
        subtitle: _('Energy profile to apply during daytime'),
        model: lightModel,
    });
    lightRow.selected = getIndexForId(profileOptions, settings.get_string('light-power-profile'));
    signalIds.push(lightRow.connect('notify::selected', () => {
        const selectedId = profileOptions[lightRow.selected]?.id || POWER_PROFILE_BALANCED;
        settings.set_string('light-power-profile', selectedId);
    }));
    scheduleGroup.add(lightRow);

    const darkModel = createModelFromList(profileOptions);
    const darkRow = new Adw.ComboRow({
        title: _('Night Mode Profile'),
        subtitle: _('Energy profile to apply during nighttime (e.g. quiet fan operation)'),
        model: darkModel,
    });
    darkRow.selected = getIndexForId(profileOptions, settings.get_string('dark-power-profile'));
    signalIds.push(darkRow.connect('notify::selected', () => {
        const selectedId = profileOptions[darkRow.selected]?.id || POWER_PROFILE_POWER_SAVER;
        settings.set_string('dark-power-profile', selectedId);
    }));
    scheduleGroup.add(darkRow);

    const syncScheduleSensitivity = () => {
        const active = autoSwitchRow.active;
        lightRow.sensitive = active;
        darkRow.sensitive = active;
    };
    signalIds.push(autoSwitchRow.connect('notify::active', syncScheduleSensitivity));
    syncScheduleSensitivity();

    // ==========================================
    // 8. Live Telemetry & D-Bus Diagnostics
    // ==========================================
    const statusGroup = new Adw.PreferencesGroup({
        title: _('Live Telemetry & D-Bus Control'),
        description: _('Real-time connection status to power-profiles-daemon and UPower.'),
    });
    page.add(statusGroup);

    const powerSourceRow = new Adw.ActionRow({
        title: _('Power Source & Battery'),
        subtitle: _('Reading telemetry…'),
    });
    statusGroup.add(powerSourceRow);

    const activeScenarioRow = new Adw.ActionRow({
        title: _('Active Scenario'),
        subtitle: _('Manual / Default'),
    });
    statusGroup.add(activeScenarioRow);

    const activeProfileRow = new Adw.ActionRow({
        title: _('Current Active Profile'),
        subtitle: _('Unknown'),
    });
    statusGroup.add(activeProfileRow);

    // Live quick switch buttons
    const testBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 8,
        valign: Gtk.Align.CENTER,
    });

    const perfBtn = new Gtk.Button({
        label: _('Performance'),
        icon_name: 'power-profile-performance-symbolic',
    });
    perfBtn.connect('clicked', () => powerController.setActiveProfile(POWER_PROFILE_PERFORMANCE));

    const balBtn = new Gtk.Button({
        label: _('Balanced'),
        icon_name: 'power-profile-balanced-symbolic',
    });
    balBtn.connect('clicked', () => powerController.setActiveProfile(POWER_PROFILE_BALANCED));

    const saveBtn = new Gtk.Button({
        label: _('Power Saver'),
        icon_name: 'power-profile-power-saver-symbolic',
    });
    saveBtn.connect('clicked', () => powerController.setActiveProfile(POWER_PROFILE_POWER_SAVER));

    testBox.append(perfBtn);
    testBox.append(balBtn);
    testBox.append(saveBtn);
    activeProfileRow.add_suffix(testBox);

    const updateDaemonUI = () => {
        const isAvail = powerController.isAvailable();
        const active = powerController.getActiveProfile();
        const onBat = powerController.isOnBattery();
        const pct = powerController.getBatteryPercentage();
        const bState = powerController.getBatteryState();
        const hasBat = powerController.hasBattery();

        // Power Source Telemetry
        if (hasBat) {
            let stateStr = '';
            if (bState === BATTERY_STATE_CHARGING)
                stateStr = _('Charging');
            else if (bState === BATTERY_STATE_DISCHARGING)
                stateStr = _('Discharging');
            else if (bState === BATTERY_STATE_FULLY_CHARGED)
                stateStr = _('Fully charged');

            const stateTag = stateStr ? ` (${stateStr})` : '';
            powerSourceRow.subtitle = onBat
                ? `🔋 ${_('On Battery')}: ${pct}%${stateTag}`
                : `🔌 ${_('Connected to AC Charger')}: ${pct}%${stateTag}`;
        } else {
            powerSourceRow.subtitle = `🔌 ${_('Desktop / AC Power (No battery detected)')}`;
        }

        // Scenario status
        const lastScen = powerController.getLastScenario();
        if (lastScen === 'low-battery')
            activeScenarioRow.subtitle = `⚠️ ${_('Low Battery Threshold triggered')}`;
        else if (lastScen === 'battery')
            activeScenarioRow.subtitle = `🔋 ${_('Battery Scenario active')}`;
        else if (lastScen === 'ac')
            activeScenarioRow.subtitle = `🔌 ${_('AC Power Scenario active')}`;
        else
            activeScenarioRow.subtitle = _('Standard / Manual control');

        // Active profile
        let profileName = _('Not set');
        if (active === POWER_PROFILE_PERFORMANCE)
            profileName = _('Performance (Maximum Power)');
        else if (active === POWER_PROFILE_BALANCED)
            profileName = _('Balanced');
        else if (active === POWER_PROFILE_POWER_SAVER)
            profileName = _('Power Saver (Maximum Battery Life)');

        activeProfileRow.subtitle = profileName;

        perfBtn.sensitive = isAvail;
        balBtn.sensitive = isAvail;
        saveBtn.sensitive = isAvail;
    };

    const updateSwapHibUI = () => {
        const swap = swapHibernateController.getSwapStats();
        const canHib = swapHibernateController.canHibernate();
        const rawHib = swapHibernateController.getHibernateCapabilityRaw();

        // Swap stats
        if (swap.totalKb > 0) {
            swapUsageRow.subtitle = `${formatBytes(swap.totalKb)} ${_('total')} • ${formatBytes(swap.usedKb)} ${_('used')} (${swap.percent}%) • ${formatBytes(swap.freeKb)} ${_('free')}`;
        } else {
            swapUsageRow.subtitle = `⚠️ ${_('No swap partition or file detected')}`;
        }

        swappinessRow.subtitle = `${swap.swappiness} (${swap.swappiness <= 20 ? _('Low - favors RAM over disk') : _('Default kernel paging')})`;

        if (swap.devices.length > 0) {
            const dev = swap.devices[0];
            swapDeviceRow.subtitle = `${dev.filename} [${dev.type}, ${_('priority')}: ${dev.priority}, ${_('size')}: ${formatBytes(dev.sizeKb)}]`;
        } else {
            swapDeviceRow.subtitle = _('No active swap devices');
        }

        // Swap vs RAM for hibernation
        if (swap.totalKb >= swap.memTotalKb) {
            swapHealthRow.subtitle = `✅ ${_('Swap size (%s) is greater than RAM (%s) — optimal for full memory dumps').replace('%s', formatBytes(swap.totalKb)).replace('%s', formatBytes(swap.memTotalKb))}`;
        } else if (swap.totalKb > 0) {
            swapHealthRow.subtitle = `⚠️ ${_('Swap size (%s) is smaller than RAM (%s). Recommended to enlarge swap for reliable hibernation.').replace('%s', formatBytes(swap.totalKb)).replace('%s', formatBytes(swap.memTotalKb))}`;
        } else {
            swapHealthRow.subtitle = `❌ ${_('Swap space is required for hibernation.')}`;
        }

        // Hibernate status
        if (canHib) {
            hibStatusRow.subtitle = `✅ ${_('Ready (Kernel & systemd support active)')}`;
            hibTestBtn.sensitive = true;
        } else {
            const devName = swap.devices.length > 0 ? swap.devices[0].filename : 'swap';
            hibStatusRow.subtitle = `⚠️ ${_('Not configured in kernel (Status: %s). Configure resume=%s in GRUB.').replace('%s', rawHib).replace('%s', devName)}`;
            hibTestBtn.sensitive = false;
        }
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
            for (const id of signalIds) {
                try {
                    GObject.signal_handler_disconnect(window, id);
                } catch {
                    // Ignore
                }
            }
            powerController.destroy();
            swapHibernateController.destroy();
        },
    };
}
