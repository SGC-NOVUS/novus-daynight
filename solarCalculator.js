import * as SunCalc from './lib/suncalc.js';

export class SolarCalculator {
    getSolarTimes(date, latitude, longitude) {
        const lat = Number.parseFloat(latitude);
        const lng = Number.parseFloat(longitude);

        if (Number.isNaN(lat) || Number.isNaN(lng))
            return null;

        const times = SunCalc.getTimes(date, lat, lng);

        return {
            first_light: times.nightEnd,
            nautical_dawn: times.nauticalDawn,
            dawn: times.dawn,
            sunrise: times.sunrise,
            sunrise_end: times.sunriseEnd,
            golden_hour_end: times.goldenHourEnd,
            solar_noon: times.solarNoon,
            golden_hour: times.goldenHour,
            sunset_start: times.sunsetStart,
            sunset: times.sunset,
            dusk: times.dusk,
            nautical_dusk: times.nauticalDusk,
            last_light: times.night,
            nadir: times.nadir,
        };
    }

    getTimezone() {
        return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    }

    validateCoordinates(latitude, longitude) {
        const lat = Number.parseFloat(latitude);
        const lng = Number.parseFloat(longitude);

        if (Number.isNaN(lat) || Number.isNaN(lng))
            return false;

        return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
    }
}
