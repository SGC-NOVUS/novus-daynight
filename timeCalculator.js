import {MS_PER_DAY, MS_PER_SECOND} from './constants.js';
import {debugWarn} from './logger.js';

const TRIGGER_MAP = {
    'first-light': 'first_light',
    'nautical-dawn': 'nautical_dawn',
    'dawn': 'dawn',
    'sunrise': 'sunrise',
    'sunrise-end': 'sunrise_end',
    'golden-hour-end': 'golden_hour_end',
    'solar-noon': 'solar_noon',
    'golden-hour': 'golden_hour',
    'sunset-start': 'sunset_start',
    'sunset': 'sunset',
    'dusk': 'dusk',
    'nautical-dusk': 'nautical_dusk',
    'last-light': 'last_light',
    'nadir': 'nadir',
};

export function isValidTimeString(timeString) {
    if (!timeString || typeof timeString !== 'string')
        return false;

    const match = /^(\d{1,2}):(\d{2})$/.exec(timeString.trim());
    if (!match)
        return false;

    const hours = Number.parseInt(match[1], 10);
    const minutes = Number.parseInt(match[2], 10);
    return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

export function secondsUntilEvent(eventTimestampMs, nowMs) {
    if (!eventTimestampMs || !Number.isFinite(eventTimestampMs))
        return 0;

    return Math.max(0, Math.round((eventTimestampMs - nowMs) / MS_PER_SECOND));
}

export function resolveScheduleState(now, lightTime, darkTime) {
    let inDayPeriod;
    if (lightTime.getTime() <= darkTime.getTime()) {
        inDayPeriod = now >= lightTime && now < darkTime;
    } else {
        const inNightPeriod = now >= darkTime && now < lightTime;
        inDayPeriod = !inNightPeriod;
    }

    const nextLightTime = now < lightTime
        ? lightTime
        : new Date(lightTime.getTime() + MS_PER_DAY);

    const nextDarkTime = now < darkTime
        ? darkTime
        : new Date(darkTime.getTime() + MS_PER_DAY);

    return {
        inDayPeriod,
        nextLightTime,
        nextDarkTime,
        nextEventTime: inDayPeriod ? nextDarkTime : nextLightTime,
        switchToDark: inDayPeriod,
    };
}

export function resolveScheduledTimes(settings, solarCalculator, timeCalculator, now) {
    const latitude = settings.get_string('manual-latitude');
    const longitude = settings.get_string('manual-longitude');

    let lightTime = null;
    let darkTime = null;
    let solarTimes = null;
    let lightModeTrigger = 'custom';
    let darkModeTrigger = 'custom';

    const hasCoordinates = Boolean(
        latitude && longitude && solarCalculator.validateCoordinates(latitude, longitude)
    );

    if (hasCoordinates) {
        solarTimes = solarCalculator.getSolarTimes(now, latitude, longitude);
        if (solarTimes) {
            lightModeTrigger = settings.get_string('light-mode-trigger');
            lightTime = timeCalculator.parseTriggerTime(
                lightModeTrigger,
                solarTimes,
                now,
                'light',
                settings
            );

            darkModeTrigger = settings.get_string('dark-mode-trigger');
            darkTime = timeCalculator.parseTriggerTime(
                darkModeTrigger,
                solarTimes,
                now,
                'dark',
                settings
            );
        }
    }

    if (!lightTime || !darkTime) {
        lightTime = timeCalculator.parseCustomTime(
            settings.get_string('custom-light-time'),
            now
        );
        darkTime = timeCalculator.parseCustomTime(
            settings.get_string('custom-dark-time'),
            now
        );
        lightModeTrigger = 'custom';
        darkModeTrigger = 'custom';
    }

    return {lightTime, darkTime, lightModeTrigger, darkModeTrigger, solarTimes};
}

export function formatSolarTimesForDebug(times, date) {
    if (!times)
        return null;

    const dateLabel = date.toLocaleDateString(undefined, {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
    });

    return {
        date: dateLabel,
        firstLight: times.first_light?.toLocaleTimeString() || 'N/A',
        nauticalDawn: times.nautical_dawn?.toLocaleTimeString() || 'N/A',
        dawn: times.dawn?.toLocaleTimeString() || 'N/A',
        sunrise: times.sunrise?.toLocaleTimeString() || 'N/A',
        sunriseEnd: times.sunrise_end?.toLocaleTimeString() || 'N/A',
        goldenHourEnd: times.golden_hour_end?.toLocaleTimeString() || 'N/A',
        solarNoon: times.solar_noon?.toLocaleTimeString() || 'N/A',
        goldenHour: times.golden_hour?.toLocaleTimeString() || 'N/A',
        sunsetStart: times.sunset_start?.toLocaleTimeString() || 'N/A',
        sunset: times.sunset?.toLocaleTimeString() || 'N/A',
        dusk: times.dusk?.toLocaleTimeString() || 'N/A',
        nauticalDusk: times.nautical_dusk?.toLocaleTimeString() || 'N/A',
        lastLight: times.last_light?.toLocaleTimeString() || 'N/A',
    };
}

export class TimeCalculator {
    parseTriggerTime(trigger, solarTimes, now, mode, settings) {
        if (trigger === 'custom') {
            const key = mode === 'light' ? 'custom-light-time' : 'custom-dark-time';
            return this.parseCustomTime(settings.get_string(key), now);
        }

        const solarKey = TRIGGER_MAP[trigger] ?? (mode === 'light' ? 'sunrise' : 'sunset');
        const time = solarTimes?.[solarKey];

        if (!(time instanceof Date) || Number.isNaN(time.getTime())) {
            debugWarn(`Solar event '${trigger}' unavailable at current latitude/date`);
            return null;
        }

        return time;
    }

    parseCustomTime(timeString, now) {
        if (!isValidTimeString(timeString))
            return null;

        const [hoursStr, minutesStr] = timeString.trim().split(':');
        const hours = Number.parseInt(hoursStr, 10);
        const minutes = Number.parseInt(minutesStr, 10);

        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
    }
}
