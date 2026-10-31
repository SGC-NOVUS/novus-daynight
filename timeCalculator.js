import {MS_PER_DAY} from './constants.js';
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

export function secondsUntilEvent(eventTimestampMs, nowMs) {
    if (!eventTimestampMs || !Number.isFinite(eventTimestampMs))
        return 0;

    return Math.max(0, Math.round((eventTimestampMs - nowMs) / 1000));
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

export class TimeCalculator {
    parseTriggerTime(trigger, solarTimes, now, mode, settings) {
        if (trigger === 'custom') {
            const key = mode === 'light' ? 'custom-light-time' : 'custom-dark-time';
            return this.parseCustomTime(settings.get_string(key), now);
        }

        const solarKey = TRIGGER_MAP[trigger] ?? (mode === 'light' ? 'sunrise' : 'sunset');
        const time = solarTimes?.[solarKey];

        if (!(time instanceof Date) || Number.isNaN(time.getTime())) {
            debugWarn(`NovusDayNight: Solar event '${trigger}' unavailable at current latitude/date`);
            return null;
        }

        return time;
    }

    parseCustomTime(timeString, now) {
        if (!timeString)
            return null;

        const parts = timeString.trim().split(':');
        if (parts.length < 2)
            return null;

        const hours = Number.parseInt(parts[0], 10);
        const minutes = Number.parseInt(parts[1], 10);

        if (Number.isNaN(hours) || Number.isNaN(minutes) ||
            hours < 0 || hours > 23 || minutes < 0 || minutes > 59)
            return null;

        return new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes, 0);
    }
}
