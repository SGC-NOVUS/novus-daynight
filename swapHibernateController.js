import Gio from 'gi://Gio';
import {
    LOGIN1_BUS_NAME,
    LOGIN1_MANAGER_INTERFACE,
    LOGIN1_OBJECT_PATH,
} from './constants.js';
import {debugLog, debugWarn} from './logger.js';

const Login1ManagerInterfaceXml = `
<node>
    <interface name="${LOGIN1_MANAGER_INTERFACE}">
        <method name="CanHibernate">
            <arg type="s" direction="out" name="result"/>
        </method>
        <method name="CanHybridSleep">
            <arg type="s" direction="out" name="result"/>
        </method>
        <method name="CanSuspendThenHibernate">
            <arg type="s" direction="out" name="result"/>
        </method>
        <method name="CanSuspend">
            <arg type="s" direction="out" name="result"/>
        </method>
        <method name="Hibernate">
            <arg type="b" direction="in" name="interactive"/>
        </method>
        <method name="HybridSleep">
            <arg type="b" direction="in" name="interactive"/>
        </method>
        <method name="SuspendThenHibernate">
            <arg type="b" direction="in" name="interactive"/>
        </method>
        <method name="Suspend">
            <arg type="b" direction="in" name="interactive"/>
        </method>
    </interface>
</node>`;

const Login1ManagerProxyWrapper = Gio.DBusProxy.makeProxyWrapper(Login1ManagerInterfaceXml);

function readFileTextAsync(path, cancellable = null) {
    const file = Gio.File.new_for_path(path);
    return new Promise((resolve, reject) => {
        file.load_contents_async(cancellable, (src, res) => {
            try {
                const [ok, bytes] = src.load_contents_finish(res);
                if (!ok || !bytes) {
                    resolve('');
                    return;
                }
                resolve(new TextDecoder('utf-8').decode(bytes));
            } catch (e) {
                reject(e);
            }
        });
    });
}

export class SwapHibernateController {
    constructor(settings = null, {autoRefreshSwap = false} = {}) {
        this._settings = settings;
        this._cancellable = new Gio.Cancellable();
        this._login1Proxy = null;
        this._listeners = new Set();

        this._canHibernate = 'na';
        this._canHybridSleep = 'na';
        this._canSuspendThenHibernate = 'na';
        this._canSuspend = 'na';

        this._swapStats = {
            totalKb: 0,
            usedKb: 0,
            freeKb: 0,
            percent: 0,
            memTotalKb: 0,
            memAvailableKb: 0,
            swappiness: 60,
            devices: [],
        };

        this._initLogin1();
        if (autoRefreshSwap)
            this.refreshSwapStats();
    }

    _initLogin1() {
        new Login1ManagerProxyWrapper(
            Gio.DBus.system,
            LOGIN1_BUS_NAME,
            LOGIN1_OBJECT_PATH,
            (proxy, error) => {
                if (this._cancellable?.is_cancelled())
                    return;

                if (error) {
                    debugWarn(`Failed to connect to login1 D-Bus: ${error.message}`);
                    return;
                }

                this._login1Proxy = proxy;
                this.checkSleepCapabilities();
            },
            this._cancellable
        );
    }

    checkSleepCapabilities() {
        if (!this._login1Proxy)
            return Promise.resolve();

        const queryCapability = methodName => new Promise(resolve => {
            this._login1Proxy[methodName]((res, err) => {
                if (err || !res) {
                    resolve('na');
                    return;
                }
                resolve(res[0] || 'na');
            });
        });

        return Promise.all([
            queryCapability('CanHibernateRemote'),
            queryCapability('CanHybridSleepRemote'),
            queryCapability('CanSuspendThenHibernateRemote'),
            queryCapability('CanSuspendRemote'),
        ]).then(([canHib, canHybrid, canSuspHib, canSusp]) => {
            if (this._cancellable?.is_cancelled())
                return;

            this._canHibernate = canHib;
            this._canHybridSleep = canHybrid;
            this._canSuspendThenHibernate = canSuspHib;
            this._canSuspend = canSusp;
            this._notifyListeners();
        });
    }

    async refreshSwapStats() {
        if (!this._cancellable || this._cancellable.is_cancelled())
            return;

        try {
            const [swapsText, memText, swappinessText] = await Promise.all([
                readFileTextAsync('/proc/swaps', this._cancellable).catch(() => ''),
                readFileTextAsync('/proc/meminfo', this._cancellable).catch(() => ''),
                readFileTextAsync('/proc/sys/vm/swappiness', this._cancellable).catch(() => '60'),
            ]);

            if (!this._cancellable || this._cancellable.is_cancelled())
                return;

            const swappiness = Number.parseInt(swappinessText.trim(), 10) || 60;

            let memTotalKb = 0;
            let memAvailableKb = 0;
            let swapTotalKb = 0;
            let swapFreeKb = 0;

            if (memText) {
                for (const line of memText.split('\n')) {
                    if (line.startsWith('MemTotal:'))
                        memTotalKb = Number.parseInt(line.replace(/[^0-9]/g, ''), 10) || 0;
                    else if (line.startsWith('MemAvailable:'))
                        memAvailableKb = Number.parseInt(line.replace(/[^0-9]/g, ''), 10) || 0;
                    else if (line.startsWith('SwapTotal:'))
                        swapTotalKb = Number.parseInt(line.replace(/[^0-9]/g, ''), 10) || 0;
                    else if (line.startsWith('SwapFree:'))
                        swapFreeKb = Number.parseInt(line.replace(/[^0-9]/g, ''), 10) || 0;
                }
            }

            const devices = [];
            if (swapsText) {
                const lines = swapsText.trim().split('\n');
                for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i].trim().split(/\s+/);
                    if (parts.length >= 5) {
                        devices.push({
                            filename: parts[0],
                            type: parts[1],
                            sizeKb: Number.parseInt(parts[2], 10) || 0,
                            usedKb: Number.parseInt(parts[3], 10) || 0,
                            priority: Number.parseInt(parts[4], 10) || 0,
                        });
                    }
                }
            }

            const swapUsedKb = Math.max(0, swapTotalKb - swapFreeKb);
            const percent = swapTotalKb > 0 ? Math.round((swapUsedKb / swapTotalKb) * 100) : 0;

            this._swapStats = {
                totalKb: swapTotalKb,
                usedKb: swapUsedKb,
                freeKb: swapFreeKb,
                percent,
                memTotalKb,
                memAvailableKb,
                swappiness,
                devices,
            };

            this._notifyListeners();
        } catch (e) {
            if (!e.matches?.(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                debugWarn(`Error reading swap stats: ${e.message}`);
        }
    }

    getSwapStats() {
        return {...this._swapStats, devices: [...this._swapStats.devices]};
    }

    canHibernate() {
        return this._canHibernate === 'yes';
    }

    canSuspend() {
        return this._canSuspend === 'yes';
    }

    canHybridSleep() {
        return this._canHybridSleep === 'yes';
    }

    canSuspendThenHibernate() {
        return this._canSuspendThenHibernate === 'yes';
    }

    getHibernateCapabilityRaw() {
        return this._canHibernate;
    }

    hibernate(interactive = false) {
        this._invokeSleepAction('HibernateRemote', 'Hibernate', interactive);
    }

    suspend(interactive = false) {
        this._invokeSleepAction('SuspendRemote', 'Suspend', interactive);
    }

    suspendThenHibernate(interactive = false) {
        this._invokeSleepAction('SuspendThenHibernateRemote', 'SuspendThenHibernate', interactive);
    }

    hybridSleep(interactive = false) {
        this._invokeSleepAction('HybridSleepRemote', 'HybridSleep', interactive);
    }

    _invokeSleepAction(methodName, label, interactive) {
        if (!this._login1Proxy)
            return;

        debugLog(`Triggering system ${label} via login1 D-Bus`);
        this._login1Proxy[methodName](interactive, (_res, err) => {
            if (err)
                debugWarn(`${label} D-Bus error: ${err.message}`);
        });
    }

    addChangeListener(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _notifyListeners() {
        const snapshot = {
            canHibernate: this.canHibernate(),
            canSuspend: this.canSuspend(),
            canHybridSleep: this.canHybridSleep(),
            canSuspendThenHibernate: this.canSuspendThenHibernate(),
            rawHibernate: this._canHibernate,
            swapStats: this.getSwapStats(),
        };

        for (const listener of this._listeners) {
            try {
                listener(snapshot);
            } catch (e) {
                debugWarn(`SwapHibernateController listener error: ${e.message}`);
            }
        }
    }

    destroy() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }

        this._listeners.clear();
        this._login1Proxy = null;
        this._settings = null;
    }
}
