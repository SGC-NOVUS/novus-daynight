import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {
    DEFAULT_BRIGHTNESS_UPDATE_INTERVAL_SECONDS,
    MIN_BRIGHTNESS_UPDATE_INTERVAL_SECONDS,
    MS_PER_SECOND,
} from './constants.js';
import {probeDisplayController} from './displayController.js';
import {resolveScheduleState} from './timeCalculator.js';
import {debugLog, debugWarn} from './logger.js';

export class BrightnessController {
    constructor(settings) {
        this._settings = settings;
        this._cancellable = new Gio.Cancellable();
        this._brightnessTimeoutId = null;
        this._lightTime = null;
        this._darkTime = null;
        this._controllerCache = new Map();
        this._transitionAnchors = new Map();
        this._lastAppliedBrightness = new Map();

        this._monitorsChangedId = this._settings.connect('changed::monitors', () => {
            this._controllerCache.clear();
            this._lastAppliedBrightness.clear();
        });
    }

    setTimes(lightTime, darkTime) {
        this._lightTime = lightTime;
        this._darkTime = darkTime;
    }

    _clearBrightnessTimer() {
        if (this._brightnessTimeoutId) {
            GLib.Source.remove(this._brightnessTimeoutId);
            this._brightnessTimeoutId = null;
        }
    }

    _loadEnabledMonitors() {
        try {
            const monitors = JSON.parse(this._settings.get_string('monitors'));
            if (!Array.isArray(monitors))
                return [];
            return monitors.filter(m => m.enabled && m.initialized);
        } catch (e) {
            debugWarn('Failed to parse monitors JSON:', e);
            return [];
        }
    }

    _getOrCreateController(monitor) {
        if (!this._controllerCache.has(monitor.id)) {
            this._controllerCache.set(
                monitor.id,
                probeDisplayController(monitor, this._settings, this._cancellable)
            );
        }
        return this._controllerCache.get(monitor.id);
    }

    async applyManualBrightness(isDark) {
        this._clearBrightnessTimer();
        this._transitionAnchors.clear();

        if (!this._settings?.get_boolean('control-brightness'))
            return;

        const monitors = this._loadEnabledMonitors();
        if (monitors.length === 0)
            return;

        await Promise.allSettled(monitors.map(async monitor => {
            const target = isDark ? monitor.darkBrightness : monitor.lightBrightness;
            if (target === null || target === undefined)
                return;

            if (this._lastAppliedBrightness.get(monitor.id) === target)
                return;

            try {
                const controller = await this._getOrCreateController(monitor);
                const ok = await controller.setBrightness(target, this._cancellable);
                if (ok) {
                    this._lastAppliedBrightness.set(monitor.id, target);
                    debugLog(`Manual mode set ${monitor.name} to ${target}%`);
                }
            } catch (e) {
                debugWarn(`Manual brightness failed on ${monitor.name}: ${e.message}`);
            }
        }));
    }

    scheduleBrightnessUpdates() {
        this._clearBrightnessTimer();

        if (!this._settings?.get_boolean('control-brightness') ||
            !this._lightTime || !this._darkTime)
            return;

        const decreaseEnabled = this._settings.get_boolean('gradual-brightness-decrease-enabled');
        const increaseEnabled = this._settings.get_boolean('gradual-brightness-increase-enabled');
        if (!decreaseEnabled && !increaseEnabled)
            return;

        const now = new Date();
        const decreaseMs =
            this._settings.get_int('gradual-brightness-decrease-duration') * MS_PER_SECOND;
        const increaseMs =
            this._settings.get_int('gradual-brightness-increase-duration') * MS_PER_SECOND;

        const {inDayPeriod, nextLightTime, nextDarkTime} =
            resolveScheduleState(now, this._lightTime, this._darkTime);

        let nextWindowStart = null;
        let nextWindowEnd = null;
        let windowDurationMs = 0;

        if (inDayPeriod && decreaseEnabled && decreaseMs > 0) {
            const dimStart = new Date(nextDarkTime.getTime() - decreaseMs);
            if (now < dimStart) {
                nextWindowStart = dimStart;
                nextWindowEnd = nextDarkTime;
                windowDurationMs = decreaseMs;
            } else if (now < nextDarkTime) {
                nextWindowStart = now;
                nextWindowEnd = nextDarkTime;
                windowDurationMs = decreaseMs;
            }
        } else if (!inDayPeriod && increaseEnabled && increaseMs > 0) {
            const brightenStart = new Date(nextLightTime.getTime() - increaseMs);
            if (now < brightenStart) {
                nextWindowStart = brightenStart;
                nextWindowEnd = nextLightTime;
                windowDurationMs = increaseMs;
            } else if (now < nextLightTime) {
                nextWindowStart = now;
                nextWindowEnd = nextLightTime;
                windowDurationMs = increaseMs;
            }
        }

        if (!nextWindowStart) {
            if (inDayPeriod && increaseEnabled && increaseMs > 0) {
                nextWindowStart = new Date(nextLightTime.getTime() - increaseMs);
                nextWindowEnd = nextLightTime;
                windowDurationMs = increaseMs;
            } else if (!inDayPeriod && decreaseEnabled && decreaseMs > 0) {
                nextWindowStart = new Date(nextDarkTime.getTime() - decreaseMs);
                nextWindowEnd = nextDarkTime;
                windowDurationMs = decreaseMs;
            } else {
                return;
            }
        }

        const secondsUntilStart = Math.max(
            0,
            Math.round((nextWindowStart.getTime() - now.getTime()) / MS_PER_SECOND)
        );

        if (secondsUntilStart > 0) {
            this._clearBrightnessTimer();
            this._brightnessTimeoutId = GLib.timeout_add_seconds(
                GLib.PRIORITY_DEFAULT,
                secondsUntilStart,
                () => {
                    this._brightnessTimeoutId = null;
                    this._startBrightnessUpdateLoop(nextWindowEnd, windowDurationMs);
                    return GLib.SOURCE_REMOVE;
                }
            );
        } else {
            this._startBrightnessUpdateLoop(nextWindowEnd, windowDurationMs);
        }
    }

    _startBrightnessUpdateLoop(windowEnd, windowDurationMs) {
        const intervalSeconds = this._calculateUpdateInterval(windowDurationMs);

        this._captureTransitionAnchors()
            .then(() => this.updateBrightness())
            .catch(e => debugWarn('Initial transition brightness error:', e));

        this._clearBrightnessTimer();
        this._brightnessTimeoutId = GLib.timeout_add_seconds(
            GLib.PRIORITY_DEFAULT,
            intervalSeconds,
            () => {
                if (new Date() >= windowEnd) {
                    this._brightnessTimeoutId = null;
                    this._transitionAnchors.clear();
                    this.scheduleBrightnessUpdates();
                    return GLib.SOURCE_REMOVE;
                }

                this.updateBrightness().catch(e => {
                    debugWarn('Scheduled brightness update error:', e);
                });
                return GLib.SOURCE_CONTINUE;
            }
        );
    }

    _calculateUpdateInterval(windowDurationMs) {
        const monitors = this._loadEnabledMonitors();
        if (monitors.length === 0)
            return DEFAULT_BRIGHTNESS_UPDATE_INTERVAL_SECONDS;

        let maxDelta = 0;
        for (const monitor of monitors) {
            if (monitor.lightBrightness !== null && monitor.darkBrightness !== null) {
                const delta = Math.abs(monitor.lightBrightness - monitor.darkBrightness);
                maxDelta = Math.max(maxDelta, delta);
            }
        }

        if (maxDelta === 0)
            return DEFAULT_BRIGHTNESS_UPDATE_INTERVAL_SECONDS;

        const windowSeconds = windowDurationMs / MS_PER_SECOND;
        return Math.max(
            MIN_BRIGHTNESS_UPDATE_INTERVAL_SECONDS,
            Math.round(windowSeconds / maxDelta)
        );
    }

    async updateBrightness(allowStaticBrightness = false) {
        if (!this._settings || this._cancellable.is_cancelled())
            return;

        if (!this._settings.get_boolean('control-brightness') ||
            !this._lightTime || !this._darkTime)
            return;

        const monitors = this._loadEnabledMonitors();
        if (monitors.length === 0)
            return;

        const now = new Date();
        const increaseDuration = this._settings.get_int('gradual-brightness-increase-duration');
        const decreaseDuration = this._settings.get_int('gradual-brightness-decrease-duration');

        const results = await Promise.allSettled(monitors.map(monitor =>
            this._updateSingleMonitor(
                monitor,
                now,
                allowStaticBrightness,
                increaseDuration,
                decreaseDuration
            )
        ));

        if (!this._settings || this._cancellable.is_cancelled())
            return;

        if (results.some(r => r.status === 'fulfilled' && r.value === true))
            this._settings.set_string('last-brightness-update', String(now.getTime()));
    }

    async _updateSingleMonitor(
        monitor,
        now,
        allowStaticBrightness,
        increaseDuration,
        decreaseDuration
    ) {
        const {lightBrightness, darkBrightness} = monitor;
        if (lightBrightness === null || darkBrightness === null)
            return false;

        const transitional = this.calculateBrightness(
            now,
            lightBrightness,
            darkBrightness,
            increaseDuration,
            decreaseDuration,
            this.getTransitionAnchor(monitor.id)
        );

        let targetBrightness;
        if (transitional !== null) {
            targetBrightness = transitional;
        } else if (allowStaticBrightness) {
            if (this.isInTransitionWindow())
                return false;
            const {inDayPeriod} = resolveScheduleState(now, this._lightTime, this._darkTime);
            targetBrightness = inDayPeriod ? lightBrightness : darkBrightness;
        } else {
            return false;
        }

        if (this._lastAppliedBrightness.get(monitor.id) === targetBrightness)
            return false;

        const controller = await this._getOrCreateController(monitor);
        const ok = await controller.setBrightness(targetBrightness, this._cancellable);
        if (!ok)
            throw new Error(`Display ${monitor.name} unavailable`);

        this._lastAppliedBrightness.set(monitor.id, targetBrightness);
        debugLog(`Updated ${monitor.name} brightness to ${targetBrightness}%`);
        return true;
    }

    async _captureTransitionAnchors() {
        if (!this._settings || this._cancellable.is_cancelled())
            return;

        this._transitionAnchors.clear();
        const monitors = this._loadEnabledMonitors();

        await Promise.allSettled(monitors.map(async monitor => {
            try {
                const controller = await this._getOrCreateController(monitor);
                const current = await controller.getBrightness(this._cancellable);
                if (typeof current === 'number' && current >= 1 && current <= 100)
                    this._transitionAnchors.set(monitor.id, current);
            } catch (e) {
                debugWarn(`Could not read anchor for ${monitor.name}: ${e.message}`);
            }
        }));
    }

    getTransitionAnchor(monitorId) {
        return this._transitionAnchors.get(monitorId) ?? null;
    }

    calculateBrightness(
        now,
        lightBrightness,
        darkBrightness,
        increaseDuration,
        decreaseDuration,
        anchorBrightness = null
    ) {
        if (!this._lightTime || !this._darkTime || !this._settings)
            return null;

        const decreaseEnabled = this._settings.get_boolean('gradual-brightness-decrease-enabled');
        const increaseEnabled = this._settings.get_boolean('gradual-brightness-increase-enabled');
        const decreaseMs = decreaseDuration * MS_PER_SECOND;
        const increaseMs = increaseDuration * MS_PER_SECOND;

        const {inDayPeriod, nextLightTime, nextDarkTime} =
            resolveScheduleState(now, this._lightTime, this._darkTime);

        if (inDayPeriod) {
            if (decreaseEnabled && decreaseMs > 0) {
                const dimStart = new Date(nextDarkTime.getTime() - decreaseMs);
                if (now >= dimStart && now < nextDarkTime) {
                    const raw = Math.max(0, Math.min(1, (now.getTime() - dimStart.getTime()) / decreaseMs));
                    const eased = 0.5 * (1 - Math.cos(Math.PI * raw));
                    const start = anchorBrightness ?? lightBrightness;
                    const value = start + (darkBrightness - start) * eased;
                    return Math.round(Math.max(1, Math.min(100, value)));
                }
            }
            return null;
        }

        if (increaseEnabled && increaseMs > 0) {
            const brightenStart = new Date(nextLightTime.getTime() - increaseMs);
            if (now >= brightenStart && now < nextLightTime) {
                const raw = Math.max(0, Math.min(1, (now.getTime() - brightenStart.getTime()) / increaseMs));
                const eased = 0.5 * (1 - Math.cos(Math.PI * raw));
                const start = anchorBrightness ?? darkBrightness;
                const value = start + (lightBrightness - start) * eased;
                return Math.round(Math.max(1, Math.min(100, value)));
            }
        }

        return null;
    }

    isInTransitionWindow() {
        if (!this._lightTime || !this._darkTime || !this._settings)
            return false;

        const now = new Date();
        const decreaseEnabled = this._settings.get_boolean('gradual-brightness-decrease-enabled');
        const increaseEnabled = this._settings.get_boolean('gradual-brightness-increase-enabled');
        const decreaseMs =
            this._settings.get_int('gradual-brightness-decrease-duration') * MS_PER_SECOND;
        const increaseMs =
            this._settings.get_int('gradual-brightness-increase-duration') * MS_PER_SECOND;

        const {inDayPeriod, nextLightTime, nextDarkTime} =
            resolveScheduleState(now, this._lightTime, this._darkTime);

        if (inDayPeriod && decreaseEnabled && decreaseMs > 0) {
            const dimStart = new Date(nextDarkTime.getTime() - decreaseMs);
            return now >= dimStart && now < nextDarkTime;
        }

        if (!inDayPeriod && increaseEnabled && increaseMs > 0) {
            const brightenStart = new Date(nextLightTime.getTime() - increaseMs);
            return now >= brightenStart && now < nextLightTime;
        }

        return false;
    }

    destroy() {
        this._cancellable.cancel();
        this._clearBrightnessTimer();

        if (this._monitorsChangedId && this._settings) {
            this._settings.disconnect(this._monitorsChangedId);
            this._monitorsChangedId = null;
        }

        this._controllerCache.clear();
        this._lastAppliedBrightness.clear();
        this._transitionAnchors.clear();
        this._settings = null;
        this._lightTime = null;
        this._darkTime = null;
    }
}
