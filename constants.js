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

export const DBUS_OBJECT_PATH = '/org/gnome/Shell/Extensions/NovusDayNight';
export const DBUS_INTERFACE_NAME = 'org.gnome.Shell.Extensions.NovusDayNight';

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
