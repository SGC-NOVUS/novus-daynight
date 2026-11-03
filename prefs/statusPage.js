import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';
import Pango from 'gi://Pango';
import {gettext as _} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import {
    DEBUG_INFO_REFRESH_INTERVAL_SECONDS,
    DEBUG_TIME_UPDATE_INTERVAL_SECONDS,
    MS_PER_SECOND,
} from '../constants.js';
import {
    POWER_PROFILE_BALANCED,
    POWER_PROFILE_PERFORMANCE,
    POWER_PROFILE_POWER_SAVER,
} from '../powerController.js';
import {fetchExtensionDebugInfo, triggerExtensionAction} from './dbusClient.js';

function createValueLabel(initialText = 'N/A') {
    return new Gtk.Label({
        label: initialText,
        ellipsize: Pango.EllipsizeMode.END,
        valign: Gtk.Align.CENTER,
        xalign: 1,
    });
}

function setLabelValue(label, text) {
    if (!label)
        return;
    const value = text || 'N/A';
    label.set_label(value);
    label.set_tooltip_text(value !== 'N/A' ? value : null);
}

export function createStatusPage(settings) {
    const cancellable = new Gio.Cancellable();
    let timeUpdateId = null;
    let debugRefreshId = null;
    let nextEventTimestamp = null;
    const dynamicMonitorRows = [];

    const page = new Adw.PreferencesPage({
        title: _('Status'),
        icon_name: 'dialog-information-symbolic',
    });

    const heroGroup = new Adw.PreferencesGroup();
    page.add(heroGroup);

    const heroBox = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 8,
        margin_top: 18,
        margin_bottom: 18,
        margin_start: 16,
        margin_end: 16,
        hexpand: true,
    });

    const heroIcon = new Gtk.Image({
        icon_name: 'weather-clear-symbolic',
        pixel_size: 64,
        halign: Gtk.Align.CENTER,
    });
    heroBox.append(heroIcon);

    const heroTitle = new Gtk.Label({
        label: _('Checking status…'),
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD_CHAR,
        justify: Gtk.Justification.CENTER,
        css_classes: ['title-1'],
    });
    heroBox.append(heroTitle);

    const heroCountdownBox = new Gtk.Box({
        orientation: Gtk.Orientation.HORIZONTAL,
        spacing: 6,
        halign: Gtk.Align.CENTER,
    });
    heroCountdownBox.append(new Gtk.Image({icon_name: 'preferences-system-time-symbolic'}));
    const heroCountdownLabel = new Gtk.Label({
        label: _('Calculating…'),
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD_CHAR,
        justify: Gtk.Justification.CENTER,
        css_classes: ['heading'],
    });
    heroCountdownBox.append(heroCountdownLabel);
    heroBox.append(heroCountdownBox);

    const heroSubtitle = new Gtk.Label({
        label: '',
        wrap: true,
        wrap_mode: Pango.WrapMode.WORD_CHAR,
        justify: Gtk.Justification.CENTER,
        max_width_chars: 52,
        css_classes: ['dim-label'],
    });
    heroBox.append(heroSubtitle);

    const buttonFlow = new Gtk.FlowBox({
        orientation: Gtk.Orientation.HORIZONTAL,
        selection_mode: Gtk.SelectionMode.NONE,
        halign: Gtk.Align.CENTER,
        column_spacing: 8,
        row_spacing: 8,
        max_children_per_line: 3,
        min_children_per_line: 1,
        margin_top: 10,
    });

    const lightBtn = new Gtk.Button({
        child: new Adw.ButtonContent({
            icon_name: 'weather-clear-symbolic',
            label: _('Day (Light)'),
        }),
        tooltip_text: _('Preview Light Theme'),
    });
    buttonFlow.append(lightBtn);

    const darkBtn = new Gtk.Button({
        child: new Adw.ButtonContent({
            icon_name: 'weather-clear-night-symbolic',
            label: _('Night (Dark)'),
        }),
        tooltip_text: _('Preview Dark Theme'),
    });
    buttonFlow.append(darkBtn);

    const autoBtn = new Gtk.Button({
        child: new Adw.ButtonContent({
            icon_name: 'emblem-synchronizing-symbolic',
            label: _('Auto Schedule'),
        }),
        tooltip_text: _('Return to automatic schedule'),
        css_classes: ['suggested-action'],
    });
    buttonFlow.append(autoBtn);

    heroBox.append(buttonFlow);

    const heroRow = new Adw.PreferencesRow({
        child: new Adw.Clamp({maximum_size: 550, child: heroBox}),
        activatable: false,
        css_classes: ['card'],
    });
    heroGroup.add(heroRow);

    const addInfoRow = (group, title, iconName = null) => {
        const row = new Adw.ActionRow({title});
        if (iconName)
            row.add_prefix(new Gtk.Image({icon_name: iconName}));
        const label = createValueLabel();
        row.add_suffix(label);
        group.add(row);
        return label;
    };

    const scheduleGroup = new Adw.PreferencesGroup({title: _('Schedule Information')});
    page.add(scheduleGroup);

    const currentTimeLabel = addInfoRow(scheduleGroup, _('Current Time'), 'preferences-system-time-symbolic');
    const currentModeLabel = addInfoRow(scheduleGroup, _('Active Period'), 'preferences-desktop-theme-symbolic');
    const lightTimeLabel = addInfoRow(scheduleGroup, _('Light Mode Switch Time'), 'weather-clear-symbolic');
    const darkTimeLabel = addInfoRow(scheduleGroup, _('Dark Mode Switch Time'), 'weather-clear-night-symbolic');
    const timeToNextLabel = addInfoRow(scheduleGroup, _('Time Until Next Switch'), 'alarm-symbolic');
    const calculationMethodLabel = addInfoRow(scheduleGroup, _('Calculation Method'), 'emblem-system-symbolic');

    const powerGroup = new Adw.PreferencesGroup({title: _('Power & Energy Status')});
    page.add(powerGroup);

    const activeProfileLabel = addInfoRow(powerGroup, _('Current Active Profile'), 'power-profile-balanced-symbolic');
    const powerSourceLabel = addInfoRow(powerGroup, _('Power Source & Battery'), 'battery-good-symbolic');
    const activeScenarioLabel = addInfoRow(powerGroup, _('Active Scenario'), 'emblem-system-symbolic');

    const locationGroup = new Adw.PreferencesGroup({title: _('Location Information')});
    page.add(locationGroup);

    const locationNameLabel = addInfoRow(locationGroup, _('Location'), 'mark-location-symbolic');
    const coordinatesLabel = addInfoRow(locationGroup, _('Coordinates'), 'find-location-symbolic');
    const timezoneLabel = addInfoRow(locationGroup, _('Timezone'), 'preferences-system-time-symbolic');

    const solarTimesGroup = new Adw.PreferencesGroup({title: _('Calculated Solar Times')});
    page.add(solarTimesGroup);

    const createSolarRows = expander => {
        const labels = {};
        const events = [
            ['firstLight', _('First Hint of Light')],
            ['nauticalDawn', _('Early Dawn')],
            ['dawn', _('Dawn')],
            ['sunrise', _('Sunrise')],
            ['sunriseEnd', _('Sun Fully Up')],
            ['goldenHourEnd', _('Morning Golden Hour Ends')],
            ['solarNoon', _('Solar Noon')],
            ['goldenHour', _('Evening Golden Hour Begins')],
            ['sunsetStart', _('Sunset Begins')],
            ['sunset', _('Sunset')],
            ['dusk', _('Dusk')],
            ['nauticalDusk', _('Late Dusk')],
            ['lastLight', _('Nightfall')],
        ];

        for (const [key, title] of events) {
            const row = new Adw.ActionRow({title});
            const label = createValueLabel();
            row.add_suffix(label);
            expander.add_row(row);
            labels[key] = label;
        }
        return labels;
    };

    const todayExpander = new Adw.ExpanderRow({
        title: _('Today'),
        subtitle: _('Loading…'),
    });
    solarTimesGroup.add(todayExpander);
    const todayLabels = createSolarRows(todayExpander);

    const tomorrowExpander = new Adw.ExpanderRow({
        title: _('Tomorrow'),
        subtitle: _('Loading…'),
    });
    solarTimesGroup.add(tomorrowExpander);
    const tomorrowLabels = createSolarRows(tomorrowExpander);

    const brightnessGroup = new Adw.PreferencesGroup({title: _('Brightness Control')});
    page.add(brightnessGroup);

    const brightnessEnabledLabel = addInfoRow(
        brightnessGroup,
        _('Brightness Control Status'),
        'display-brightness-symbolic'
    );

    const brightnessDetailsExpander = new Adw.ExpanderRow({
        title: _('Brightness Details'),
        subtitle: _('Click to expand'),
    });
    brightnessDetailsExpander.add_prefix(new Gtk.Image({icon_name: 'video-display-symbolic'}));
    brightnessGroup.add(brightnessDetailsExpander);

    const brightnessStateLabel = createValueLabel();
    const brightnessStateRow = new Adw.ActionRow({title: _('Brightness State')});
    brightnessStateRow.add_suffix(brightnessStateLabel);
    brightnessDetailsExpander.add_row(brightnessStateRow);

    const nextTransitionLabel = createValueLabel();
    const nextTransitionRow = new Adw.ActionRow({title: _('Next Transition')});
    nextTransitionRow.add_suffix(nextTransitionLabel);
    brightnessDetailsExpander.add_row(nextTransitionRow);

    const diagGroup = new Adw.PreferencesGroup({title: _('Diagnostics & Logging')});
    page.add(diagGroup);

    const debugLoggingRow = new Adw.SwitchRow({
        title: _('Debug Logging'),
        subtitle: _('Write verbose diagnostics to the system journal'),
    });
    debugLoggingRow.add_prefix(new Gtk.Image({icon_name: 'utilities-terminal-symbolic'}));
    settings.bind('debug-logging', debugLoggingRow, 'active', Gio.SettingsBindFlags.DEFAULT);
    diagGroup.add(debugLoggingRow);

    const refreshRow = new Adw.ActionRow({
        title: _('Refresh Status'),
        subtitle: _('Update all displayed values immediately'),
    });
    refreshRow.add_prefix(new Gtk.Image({icon_name: 'view-refresh-symbolic'}));
    const refreshButton = new Gtk.Button({
        label: _('Refresh'),
        valign: Gtk.Align.CENTER,
    });
    refreshRow.add_suffix(refreshButton);
    refreshRow.activatable_widget = refreshButton;
    diagGroup.add(refreshRow);

    const renderMonitorBrightnessList = monitors => {
        for (const row of dynamicMonitorRows)
            brightnessGroup.remove(row);
        dynamicMonitorRows.length = 0;

        if (!monitors || monitors.length === 0) {
            const emptyRow = new Adw.ActionRow({
                title: _('No monitors configured'),
            });
            emptyRow.add_prefix(new Gtk.Image({icon_name: 'video-display-symbolic'}));
            brightnessGroup.add(emptyRow);
            dynamicMonitorRows.push(emptyRow);
            return;
        }

        for (const monitor of monitors) {
            const detail = _('Light: %s, Dark: %s, Current: %s')
                .replace('%s', monitor.lightBrightness || 'N/A')
                .replace('%s', monitor.darkBrightness || 'N/A')
                .replace('%s', monitor.currentBrightness || 'N/A');

            const row = new Adw.ActionRow({
                title: monitor.name || _('Unknown Monitor'),
                subtitle: detail,
            });
            row.add_prefix(new Gtk.Image({icon_name: 'video-display-symbolic'}));
            brightnessGroup.add(row);
            dynamicMonitorRows.push(row);
        }
    };

    const updateSolarSection = (solarData, labels, expander, defaultTitle) => {
        if (solarData) {
            expander.title = `${defaultTitle} — ${solarData.date}`;
            expander.subtitle = _('Sunrise: %s, Sunset: %s')
                .replace('%s', solarData.sunrise)
                .replace('%s', solarData.sunset);

            for (const [key, label] of Object.entries(labels))
                setLabelValue(label, solarData[key]);
        } else {
            expander.title = defaultTitle;
            expander.subtitle = _('No coordinates set');
            for (const label of Object.values(labels))
                setLabelValue(label, 'N/A');
        }
    };

    const refreshDebugInfo = async () => {
        const debugInfo = await fetchExtensionDebugInfo(cancellable);
        if (cancellable.is_cancelled())
            return;

        if (!debugInfo) {
            nextEventTimestamp = null;
            heroIcon.set_from_icon_name('dialog-warning-symbolic');
            heroTitle.set_label(_('Background Service Offline'));
            heroCountdownLabel.set_label(_('Inactive'));
            heroSubtitle.set_label(
                _('Enable SGC-NOVUS Tools in GNOME Extensions to start automatic switching')
            );
            return;
        }

        const isDark = debugInfo.manualModeActive
            ? debugInfo.manualModeIsDark
            : (debugInfo.currentMode === 'night' || debugInfo.currentMode === 'dark');

        heroIcon.set_from_icon_name(
            isDark ? 'weather-clear-night-symbolic' : 'weather-clear-symbolic'
        );
        heroTitle.set_label(
            isDark ? _('Night Mode (Dark Theme)') : _('Day Mode (Light Theme)')
        );

        if (debugInfo.manualModeActive) {
            heroCountdownLabel.set_label(_('Manual Mode'));
            heroSubtitle.set_label(
                _('Automatic schedule paused • Click "Auto Schedule" to resume')
            );
        } else if (debugInfo.nextEventTime) {
            const nextType = debugInfo.nextEventType === 'dark' ? _('Dark') : _('Light');
            heroSubtitle.set_label(
                _('Next switch to %s theme at %s')
                    .replace('%s', nextType)
                    .replace('%s', debugInfo.nextEventTime)
            );
        }

        setLabelValue(currentTimeLabel, debugInfo.currentTime);
        setLabelValue(lightTimeLabel, debugInfo.lightTime);
        setLabelValue(darkTimeLabel, debugInfo.darkTime);

        const calcMethod = debugInfo.calculationMethod === 'Custom times'
            ? _('Custom times')
            : (debugInfo.calculationMethod === 'Solar events (local calculation)'
                ? _('Solar events (local calculation)')
                : (debugInfo.calculationMethod || 'N/A'));
        setLabelValue(calculationMethodLabel, calcMethod);

        if (debugInfo.manualModeActive) {
            const chosen = debugInfo.manualModeIsDark ? _('Dark') : _('Light');
            setLabelValue(currentModeLabel, _('%s mode (manual)').replace('%s', chosen));
            setLabelValue(timeToNextLabel, _('Off until reset'));
            nextEventTimestamp = null;
        } else {
            const curMode = debugInfo.currentMode === 'day'
                ? _('Day')
                : (debugInfo.currentMode === 'night' ? _('Night') : (debugInfo.currentMode || 'N/A'));
            setLabelValue(currentModeLabel, curMode);

            nextEventTimestamp = debugInfo.nextEventTimestamp ||
                (debugInfo.secondsToNextEvent
                    ? Date.now() + debugInfo.secondsToNextEvent * MS_PER_SECOND
                    : null);

            const secs = debugInfo.secondsToNextEvent || 0;
            const h = Math.floor(secs / 3600);
            const m = Math.floor((secs % 3600) / 60);
            const s = secs % 60;
            const formatted = _('%dh %dm %ds')
                .replace('%d', h)
                .replace('%d', m)
                .replace('%d', s);
            setLabelValue(timeToNextLabel, formatted);
            heroCountdownLabel.set_label(formatted);
        }

        if (debugInfo.power) {
            const p = debugInfo.power;
            let profileText = _('Not set');
            if (p.activeProfile === POWER_PROFILE_PERFORMANCE)
                profileText = _('Performance');
            else if (p.activeProfile === POWER_PROFILE_BALANCED)
                profileText = _('Balanced');
            else if (p.activeProfile === POWER_PROFILE_POWER_SAVER)
                profileText = _('Power Saver');
            setLabelValue(activeProfileLabel, profileText);

            if (p.hasBattery) {
                const sourceText = p.onBattery ? _('On Battery') : _('Connected to AC Charger');
                setLabelValue(powerSourceLabel, `${sourceText} (${p.batteryPercentage}%)`);
            } else {
                setLabelValue(powerSourceLabel, _('Desktop / AC Power (No battery detected)'));
            }

            let scenarioText = _('Standard / Manual control');
            if (p.lastScenario === 'low-battery')
                scenarioText = _('Low Battery Threshold triggered');
            else if (p.lastScenario === 'battery')
                scenarioText = _('Battery Scenario active');
            else if (p.lastScenario === 'ac')
                scenarioText = _('AC Power Scenario active');
            setLabelValue(activeScenarioLabel, scenarioText);
        }

        const locText = (debugInfo.locationName && debugInfo.locationName !== 'Not set')
            ? debugInfo.locationName
            : _('Not set');
        setLabelValue(locationNameLabel, locText);

        if (debugInfo.latitude && debugInfo.longitude &&
            debugInfo.latitude !== 'Not set' && debugInfo.longitude !== 'Not set')
            setLabelValue(coordinatesLabel, `${debugInfo.latitude}, ${debugInfo.longitude}`);
        else
            setLabelValue(coordinatesLabel, _('Not set'));

        setLabelValue(timezoneLabel, debugInfo.timezone);

        updateSolarSection(debugInfo.solarTimesToday, todayLabels, todayExpander, _('Today'));
        updateSolarSection(debugInfo.solarTimesTomorrow, tomorrowLabels, tomorrowExpander, _('Tomorrow'));

        if (debugInfo.brightness) {
            setLabelValue(
                brightnessEnabledLabel,
                debugInfo.brightness.enabled ? _('Enabled') : _('Disabled')
            );

            let stateText = debugInfo.brightness.brightnessState;
            if (stateText === 'Static brightness')
                stateText = _('Static brightness');
            else if (stateText === 'Not in adjustment window')
                stateText = _('Not in adjustment window');
            setLabelValue(brightnessStateLabel, stateText);

            let transText = debugInfo.brightness.nextTransition;
            if (transText === 'In transition')
                transText = _('In transition');
            setLabelValue(nextTransitionLabel, transText);

            renderMonitorBrightnessList(debugInfo.brightness.monitors || []);
        }
    };

    lightBtn.connect('clicked', () => {
        triggerExtensionAction(
            settings,
            'ForceThemeSwitch',
            new GLib.Variant('(b)', [false]),
            cancellable
        ).then(() => refreshDebugInfo());
    });

    darkBtn.connect('clicked', () => {
        triggerExtensionAction(
            settings,
            'ForceThemeSwitch',
            new GLib.Variant('(b)', [true]),
            cancellable
        ).then(() => refreshDebugInfo());
    });

    autoBtn.connect('clicked', () => {
        triggerExtensionAction(settings, 'ResetToAutomatic', null, cancellable)
            .then(() => refreshDebugInfo());
    });

    refreshButton.connect('clicked', () => {
        refreshDebugInfo();
    });

    if (timeUpdateId) {
        GLib.Source.remove(timeUpdateId);
        timeUpdateId = null;
    }
    timeUpdateId = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        DEBUG_TIME_UPDATE_INTERVAL_SECONDS,
        () => {
            const now = new Date();
            currentTimeLabel.set_label(now.toLocaleString());

            if (nextEventTimestamp) {
                const rem = Math.max(
                    0,
                    Math.round((nextEventTimestamp - now.getTime()) / MS_PER_SECOND)
                );
                const h = Math.floor(rem / 3600);
                const m = Math.floor((rem % 3600) / 60);
                const s = rem % 60;
                const formatted = _('%dh %dm %ds')
                    .replace('%d', h)
                    .replace('%d', m)
                    .replace('%d', s);
                timeToNextLabel.set_label(formatted);
                heroCountdownLabel.set_label(formatted);
            }
            return GLib.SOURCE_CONTINUE;
        }
    );

    if (debugRefreshId) {
        GLib.Source.remove(debugRefreshId);
        debugRefreshId = null;
    }
    debugRefreshId = GLib.timeout_add_seconds(
        GLib.PRIORITY_DEFAULT,
        DEBUG_INFO_REFRESH_INTERVAL_SECONDS,
        () => {
            refreshDebugInfo();
            return GLib.SOURCE_CONTINUE;
        }
    );

    refreshDebugInfo();

    return {
        page,
        destroy() {
            cancellable.cancel();
            if (timeUpdateId) {
                GLib.Source.remove(timeUpdateId);
                timeUpdateId = null;
            }
            if (debugRefreshId) {
                GLib.Source.remove(debugRefreshId);
                debugRefreshId = null;
            }
            nextEventTimestamp = null;
        },
    };
}
