import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import {debugLog, debugWarn} from './logger.js';

const LOGIN1_BUS_NAME = 'org.freedesktop.login1';
const LOGIN1_OBJECT_PATH = '/org/freedesktop/login1';
const LOGIN1_MANAGER_INTERFACE = 'org.freedesktop.login1.Manager';

const Login1ManagerInterfaceXml = `
<node>
    <interface name="org.freedesktop.login1.Manager">
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

export class SwapHibernateController {
    constructor(settings = null) {
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
        this.refreshSwapStats();
    }

    _initLogin1() {
        try {
            new Login1ManagerProxyWrapper(
                Gio.DBus.system,
                LOGIN1_BUS_NAME,
                LOGIN1_OBJECT_PATH,
                (proxy, error) => {
                    if (this._cancellable?.is_cancelled())
                        return;

                    if (error) {
                        debugWarn(`SwapHibernateController: Failed to connect to login1: ${error.message}`);
                        return;
                    }

                    this._login1Proxy = proxy;
                    this.checkSleepCapabilities();
                },
                this._cancellable
            );
        } catch (e) {
            debugWarn(`SwapHibernateController: Exception initializing login1: ${e.message}`);
        }
    }

    checkSleepCapabilities() {
        if (!this._login1Proxy)
            return Promise.resolve();

        return Promise.all([
            new Promise(resolve => {
                this._login1Proxy.CanHibernateRemote((res, err) => {
                    this._canHibernate = err ? 'na' : (res ? res[0] : 'na');
                    resolve();
                });
            }),
            new Promise(resolve => {
                this._login1Proxy.CanHybridSleepRemote((res, err) => {
                    this._canHybridSleep = err ? 'na' : (res ? res[0] : 'na');
                    resolve();
                });
            }),
            new Promise(resolve => {
                this._login1Proxy.CanSuspendThenHibernateRemote((res, err) => {
                    this._canSuspendThenHibernate = err ? 'na' : (res ? res[0] : 'na');
                    resolve();
                });
            }),
            new Promise(resolve => {
                this._login1Proxy.CanSuspendRemote((res, err) => {
                    this._canSuspend = err ? 'na' : (res ? res[0] : 'na');
                    resolve();
                });
            }),
        ]).then(() => {
            this._notifyListeners();
        });
    }

    async refreshSwapStats() {
        try {
            const [swapsOk, swapsBytes] = GLib.file_get_contents('/proc/swaps');
            const [memOk, memBytes] = GLib.file_get_contents('/proc/meminfo');

            let swappiness = 60;
            try {
                const [swapnOk, swapnBytes] = GLib.file_get_contents('/proc/sys/vm/swappiness');
                if (swapnOk)
                    swappiness = parseInt(new TextDecoder().decode(swapnBytes).trim(), 10) || 60;
            } catch {
                // Ignore swappiness read error
            }

            let memTotalKb = 0;
            let memAvailableKb = 0;
            let swapTotalKb = 0;
            let swapFreeKb = 0;

            if (memOk) {
                const memText = new TextDecoder().decode(memBytes);
                const memLines = memText.split('\n');
                for (const line of memLines) {
                    if (line.startsWith('MemTotal:'))
                        memTotalKb = parseInt(line.replace(/[^0-9]/g, ''), 10) || 0;
                    else if (line.startsWith('MemAvailable:'))
                        memAvailableKb = parseInt(line.replace(/[^0-9]/g, ''), 10) || 0;
                    else if (line.startsWith('SwapTotal:'))
                        swapTotalKb = parseInt(line.replace(/[^0-9]/g, ''), 10) || 0;
                    else if (line.startsWith('SwapFree:'))
                        swapFreeKb = parseInt(line.replace(/[^0-9]/g, ''), 10) || 0;
                }
            }

            const devices = [];
            if (swapsOk) {
                const swapsText = new TextDecoder().decode(swapsBytes);
                const lines = swapsText.trim().split('\n');
                for (let i = 1; i < lines.length; i++) {
                    const parts = lines[i].trim().split(/\s+/);
                    if (parts.length >= 5) {
                        devices.push({
                            filename: parts[0],
                            type: parts[1],
                            sizeKb: parseInt(parts[2], 10) || 0,
                            usedKb: parseInt(parts[3], 10) || 0,
                            priority: parseInt(parts[4], 10) || 0,
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
            debugWarn(`SwapHibernateController: Error reading swap stats: ${e.message}`);
        }
    }

    getSwapStats() {
        return {...this._swapStats};
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
        if (!this._login1Proxy)
            return;

        debugLog('SwapHibernateController: Triggering system Hibernate via D-Bus');
        try {
            this._login1Proxy.HibernateRemote(interactive, (_res, err) => {
                if (err)
                    debugWarn(`SwapHibernateController: Hibernate error: ${err.message}`);
            });
        } catch (e) {
            debugWarn(`SwapHibernateController: Failed to trigger Hibernate: ${e.message}`);
        }
    }

    suspend(interactive = false) {
        if (!this._login1Proxy)
            return;

        debugLog('SwapHibernateController: Triggering system Suspend via D-Bus');
        try {
            this._login1Proxy.SuspendRemote(interactive, (_res, err) => {
                if (err)
                    debugWarn(`SwapHibernateController: Suspend error: ${err.message}`);
            });
        } catch (e) {
            debugWarn(`SwapHibernateController: Failed to trigger Suspend: ${e.message}`);
        }
    }

    addChangeListener(listener) {
        this._listeners.add(listener);
        return () => this._listeners.delete(listener);
    }

    _notifyListeners() {
        for (const listener of this._listeners) {
            try {
                listener({
                    canHibernate: this.canHibernate(),
                    canSuspend: this.canSuspend(),
                    canHybridSleep: this.canHybridSleep(),
                    canSuspendThenHibernate: this.canSuspendThenHibernate(),
                    rawHibernate: this._canHibernate,
                    swapStats: this.getSwapStats(),
                });
            } catch (e) {
                debugWarn(`SwapHibernateController: Listener error: ${e.message}`);
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
    }
}

