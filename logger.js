let _debugEnabled = false;

export function setDebugLogging(enabled) {
    _debugEnabled = Boolean(enabled);
}

export function debugLog(...args) {
    if (_debugEnabled)
        console.log(...args);
}

export function debugWarn(...args) {
    if (_debugEnabled)
        console.warn(...args);
}
