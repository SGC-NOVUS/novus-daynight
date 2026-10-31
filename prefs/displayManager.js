import {
    DdcServiceBackend,
    MutterBacklightBackend,
    PowerScreenBackend,
    isBuiltinMonitor,
} from '../displayController.js';
import {debugLog, debugWarn} from '../logger.js';

export class DisplayManager {
    constructor(settings) {
        this.settings = settings;
    }

    async ensureBuiltinMonitor(cancellable = null) {
        const cached = this.loadCachedMonitors();
        if (cached.some(m => isBuiltinMonitor(m)))
            return cached;

        const mutterProbe = new MutterBacklightBackend(
            {id: 'builtin', name: 'Built-in Display', type: 'mutter-dbus'},
            this.settings
        );
        const powerProbe = new PowerScreenBackend(this.settings);

        const mutterReady = await mutterProbe.isAvailable(cancellable);
        const powerReady = !mutterReady && await powerProbe.isAvailable(cancellable);

        if (!mutterReady && !powerReady)
            return cached;

        const builtinEntry = {
            id: 'builtin',
            name: 'Built-in Display',
            type: mutterReady ? 'mutter-dbus' : 'gsd-power',
            enabled: false,
            initialized: false,
            lightBrightness: null,
            darkBrightness: null,
            lastSeen: Date.now(),
        };

        const updated = [builtinEntry, ...cached];
        this.saveMonitors(updated, false);
        return updated;
    }

    async detectExternalMonitors(cancellable = null) {
        const [mutterDisplays, ddcDisplays] = await Promise.all([
            MutterBacklightBackend.detectExternalDisplays(cancellable),
            DdcServiceBackend.detectDisplays(cancellable),
        ]);

        const combined = [];
        const seenKeys = new Set();

        for (const display of [...mutterDisplays, ...ddcDisplays]) {
            const dedupKey = display.serialNumber
                ? `SN:${display.serialNumber}`
                : display.id;
            if (seenKeys.has(dedupKey))
                continue;
            seenKeys.add(dedupKey);
            combined.push(display);
        }

        debugLog(`NovusDayNight: Detected ${combined.length} external monitor(s) via D-Bus`);
        return combined;
    }

    loadCachedMonitors() {
        try {
            const parsed = JSON.parse(this.settings.get_string('monitors'));
            return Array.isArray(parsed) ? parsed : [];
        } catch (e) {
            debugWarn(`NovusDayNight: Failed to parse cached monitors: ${e.message}`);
            return [];
        }
    }

    saveMonitors(monitors, updateTimestamp = true) {
        const now = Date.now();
        const stamped = monitors.map(monitor => ({
            ...monitor,
            lastSeen: now,
        }));

        this.settings.set_string('monitors', JSON.stringify(stamped));
        if (updateTimestamp)
            this.settings.set_int64('monitors-last-detection', now);
    }

    mergeMonitors(detectedExternals, cachedMonitors) {
        const cachedById = new Map(cachedMonitors.map(m => [m.id, m]));
        const merged = [];

        const builtin = cachedMonitors.find(m => isBuiltinMonitor(m));
        if (builtin)
            merged.push(builtin);

        for (const detected of detectedExternals) {
            const cached = cachedById.get(detected.id);
            if (cached) {
                merged.push({
                    ...detected,
                    enabled: Boolean(cached.enabled),
                    initialized: Boolean(cached.initialized),
                    lightBrightness: cached.lightBrightness ?? null,
                    darkBrightness: cached.darkBrightness ?? null,
                });
            } else {
                merged.push({
                    ...detected,
                    enabled: false,
                    initialized: false,
                    lightBrightness: null,
                    darkBrightness: null,
                });
            }
        }

        return merged;
    }

    findMissingMonitors(detectedExternals, cachedMonitors) {
        const detectedIds = new Set(detectedExternals.map(m => m.id));
        return cachedMonitors.filter(m => !isBuiltinMonitor(m) && !detectedIds.has(m.id));
    }
}
