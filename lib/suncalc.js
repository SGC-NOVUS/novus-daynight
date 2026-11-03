/*
 * SunCalc - A tiny JavaScript library for calculating sun positions and phases.
 *
 * Copyright (c) 2025, Vladimir Agafonkin
 * All rights reserved.
 *
 * Redistribution and use in source and binary forms, with or without modification, are
 * permitted provided that the following conditions are met:
 *
 *    1. Redistributions of source code must retain the above copyright notice, this list of
 *       conditions and the following disclaimer.
 *
 *    2. Redistributions in binary form must reproduce the above copyright notice, this list
 *       of conditions and the following disclaimer in the documentation and/or other materials
 *       provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY
 * EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED WARRANTIES OF
 * MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE
 * COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL,
 * EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
 * SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION)
 * HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR
 * TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
 * SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 *
 * Source: https://github.com/mourner/suncalc
 *
 * Bundled with SGC-NOVUS Tools for local solar event calculations.
 */

const PI = Math.PI;
const sin = Math.sin;
const cos = Math.cos;
const tan = Math.tan;
const asin = Math.asin;
const atan = Math.atan2;
const acos = Math.acos;
const rad = PI / 180;

const dayMs = 1000 * 60 * 60 * 24;
const J1970 = 2440588;
const J2000 = 2451545;

function toJulian(date) {
    return date.valueOf() / dayMs - 0.5 + J1970;
}

function fromJulian(j) {
    return new Date((j + 0.5 - J1970) * dayMs);
}

function toDays(date) {
    return toJulian(date) - J2000;
}

const e = rad * 23.4397; // obliquity of the Earth

function rightAscension(l, b) {
    return atan(sin(l) * cos(e) - tan(b) * sin(e), cos(l));
}

function declination(l, b) {
    return asin(sin(b) * cos(e) + cos(b) * sin(e) * sin(l));
}

function azimuth(H, phi, dec) {
    return atan(sin(H), cos(H) * sin(phi) - tan(dec) * cos(phi));
}

function altitude(H, phi, dec) {
    return asin(sin(phi) * sin(dec) + cos(phi) * cos(dec) * cos(H));
}

function siderealTime(d, lw) {
    return rad * (280.16 + 360.9856235 * d) - lw;
}

function solarMeanAnomaly(d) {
    return rad * (357.5291 + 0.98560028 * d);
}

function eclipticLongitude(M) {
    const C = rad * (1.9148 * sin(M) + 0.02 * sin(2 * M) + 0.0003 * sin(3 * M));
    const P = rad * 102.9372;
    return M + C + P + PI;
}

function sunCoords(d) {
    const M = solarMeanAnomaly(d);
    const L = eclipticLongitude(M);

    return {
        dec: declination(L, 0),
        ra: rightAscension(L, 0),
    };
}

export function getPosition(date, lat, lng) {
    const lw = rad * -lng;
    const phi = rad * lat;
    const d = toDays(date);
    const c = sunCoords(d);
    const H = siderealTime(d, lw) - c.ra;

    return {
        azimuth: azimuth(H, phi, c.dec),
        altitude: altitude(H, phi, c.dec),
    };
}

export const times = [
    [-0.833, 'sunrise', 'sunset'],
    [-0.3, 'sunriseEnd', 'sunsetStart'],
    [-6, 'dawn', 'dusk'],
    [-12, 'nauticalDawn', 'nauticalDusk'],
    [-18, 'nightEnd', 'night'],
    [6, 'goldenHourEnd', 'goldenHour'],
];

export function addTime(angle, riseName, setName) {
    times.push([angle, riseName, setName]);
}

const J0 = 0.0009;

function julianCycle(d, lw) {
    return Math.round(d - J0 - lw / (2 * PI));
}

function approxTransit(Ht, lw, n) {
    return J0 + (Ht + lw) / (2 * PI) + n;
}

function solarTransitJ(ds, M, L) {
    return J2000 + ds + 0.0053 * sin(M) - 0.0069 * sin(2 * L);
}

function hourAngle(h, phi, d) {
    return acos((sin(h) - sin(phi) * sin(d)) / (cos(phi) * cos(d)));
}

function observerAngle(height) {
    return -2.076 * Math.sqrt(height) / 60;
}

function getSetJ(h, lw, phi, dec, n, M, L) {
    const w = hourAngle(h, phi, dec);
    const a = approxTransit(w, lw, n);
    return solarTransitJ(a, M, L);
}

export function getTimes(date, lat, lng, height = 0) {
    const lw = rad * -lng;
    const phi = rad * lat;
    const dh = observerAngle(height);
    const d = toDays(date);
    const n = julianCycle(d, lw);
    const ds = approxTransit(0, lw, n);
    const M = solarMeanAnomaly(ds);
    const L = eclipticLongitude(M);
    const dec = declination(L, 0);
    const Jnoon = solarTransitJ(ds, M, L);

    const result = {
        solarNoon: fromJulian(Jnoon),
        nadir: fromJulian(Jnoon - 0.5),
    };

    for (const time of times) {
        const h0 = (time[0] + dh) * rad;
        const Jset = getSetJ(h0, lw, phi, dec, n, M, L);
        const Jrise = Jnoon - (Jset - Jnoon);

        result[time[1]] = fromJulian(Jrise);
        result[time[2]] = fromJulian(Jset);
    }

    return result;
}
