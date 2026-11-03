const LOG_PREFIX = '[SGC-NOVUS Tools]';

let _debugEnabled = false;

export function setDebugLogging(enabled) {
    _debugEnabled = Boolean(enabled);
}

export function debugLog(...args) {
    if (_debugEnabled)
        console.debug(LOG_PREFIX, ...args);
}

export function debugWarn(...args) {
    if (_debugEnabled)
        console.warn(LOG_PREFIX, ...args);
}
