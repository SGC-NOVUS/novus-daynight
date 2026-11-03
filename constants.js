export const MS_PER_SECOND = 1000;
export const SECONDS_PER_MINUTE = 60;
export const MINUTES_PER_HOUR = 60;
export const HOURS_PER_DAY = 24;
export const MS_PER_DAY =
    HOURS_PER_DAY * MINUTES_PER_HOUR * SECONDS_PER_MINUTE * MS_PER_SECOND;

export const MIN_BRIGHTNESS_UPDATE_INTERVAL_SECONDS = 15;
export const DEFAULT_BRIGHTNESS_UPDATE_INTERVAL_SECONDS = 60;

export const DEBUG_TIME_UPDATE_INTERVAL_SECONDS = 1;
export const DEBUG_INFO_REFRESH_INTERVAL_SECONDS = 5;

export const RESUME_DELAY_SECONDS = 2;

export const EXTENSION_UUID = 'Novus_Tools@sgc-novus.fun';
export const SHELL_BUS_NAME = 'org.gnome.Shell';
export const STANDALONE_BUS_NAME = 'fun.sgc_novus.NovusDayNight';
export const DBUS_OBJECT_PATH = '/org/gnome/Shell/Extensions/NovusDayNight';
export const DBUS_INTERFACE_NAME = 'org.gnome.Shell.Extensions.NovusDayNight';

export const EXTENSION_DBUS_IFACE_XML = `
<node>
    <interface name="${DBUS_INTERFACE_NAME}">
        <method name="GetDebugInfo">
            <arg type="s" direction="out" name="info"/>
        </method>
        <method name="ForceThemeSwitch">
            <arg type="b" direction="in" name="isDark"/>
        </method>
        <method name="ResetToAutomatic"/>
        <method name="SetCaffeine">
            <arg type="b" direction="in" name="enabled"/>
            <arg type="i" direction="in" name="durationSeconds"/>
        </method>
    </interface>
</node>`;

export const LOGIN1_BUS_NAME = 'org.freedesktop.login1';
export const LOGIN1_OBJECT_PATH = '/org/freedesktop/login1';
export const LOGIN1_MANAGER_INTERFACE = 'org.freedesktop.login1.Manager';

export const LIGHT_TRIGGERS = [
    'first-light',
    'nautical-dawn',
    'dawn',
    'sunrise',
    'sunrise-end',
    'golden-hour-end',
    'solar-noon',
    'custom',
];

export const DARK_TRIGGERS = [
    'solar-noon',
    'golden-hour',
    'sunset-start',
    'sunset',
    'dusk',
    'nautical-dusk',
    'last-light',
    'nadir',
    'custom',
];

export const NIGHT_LIGHT_MODES = [
    'disabled',
    'sync-with-theme',
    'follow-night-light',
    'custom-schedule',
];

export const WALLPAPER_MODES = [
    'disabled',
    'dual',
    'separate',
];

export const BRIGHTNESS_TRANSITION_DURATIONS = [
    {label: 'Off', value: 0},
    {label: '15 minutes', value: 900},
    {label: '30 minutes', value: 1800},
    {label: '1 hour', value: 3600},
    {label: '1.5 hours', value: 5400},
    {label: '2 hours', value: 7200},
    {label: '2.5 hours', value: 9000},
    {label: '3 hours', value: 10800},
];

export const CAFFEINE_DURATIONS = [
    {seconds: 1800, labelKey: '30 minutes'},
    {seconds: 3600, labelKey: '1 hour'},
    {seconds: 7200, labelKey: '2 hours'},
    {seconds: 0, labelKey: 'Indefinitely'},
];
