# SGC-NOVUS Tools (`Novus_Tools@sgc-novus.fun`)

[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-45--50-blue.svg)](https://extensions.gnome.org/)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-green.svg)](LICENSE)

English | [Русский](README.ru.md)

**SGC-NOVUS Tools** is a comprehensive desktop automation and power management suite for GNOME Shell (45–50). It coordinates solar/custom day and night theme transitions, dynamic wallpapers, Night Light synchronization, smooth display brightness over D-Bus, smart AC/Battery power scenarios, and systemd hibernation telemetry.

---

## Key Features

- **Power Profiles & Smart Scenarios (`org.freedesktop.UPower.PowerProfiles` & `UPower`)**
  - Instant switching between **Performance**, **Balanced**, and **Power Saver** directly from the GNOME Quick Settings menu over asynchronous D-Bus.
  - **Smart Power Scenarios**: automatically switch profiles when connecting or disconnecting the AC charger, or when battery charge drops below a configurable threshold.
  - **Adaptive Screen Timeouts, 60 Hz Refresh Rate Saver & OLED Saver**: per-state screen blanking delays (AC, Battery, Power Saver), automatic display refresh rate reduction to 60 Hz on battery or in Power Saver (`org.gnome.Mutter.DisplayConfig`), keyboard backlight automation (`org.freedesktop.UPower.KbdBacklight`), and dark mode enforcement in Power Saver.
  - **Keep Awake (Caffeine)**: prevent screen blanking and idle sleep via `org.gnome.SessionManager.Inhibit` with configurable expiration timers.
  - **Extended Battery Telemetry**: live power draw (`W`), battery health (`%`), and charge cycles via `org.freedesktop.UPower.Device`.
  - **Day / Night Schedule Automation**: optionally synchronize energy profiles with solar or custom Day/Night transitions.

- **Systemd Sleep, Hibernation & Swap Telemetry (`org.freedesktop.login1.Manager`)**
  - One-click **Suspend**, **Suspend-then-Hibernate**, **Hybrid Sleep**, and **Hibernate** actions in Quick Settings and Preferences.
  - Emergency automatic hibernation when battery level reaches a critical threshold while discharging.
  - Asynchronous non-blocking swap memory diagnostics (`/proc/swaps`, `/proc/meminfo`, `vm.swappiness`) and hibernation capacity verification.

- **Local Solar Schedule (`SunCalc` + `GeoClue2`)**
  - Computes 14 solar phases locally (`sunrise`, `sunset`, `golden_hour`, `dusk`, etc.), or uses custom `HH:MM` schedules including schedules crossing midnight.
  - On-demand location detection in Preferences via `GeoClue2` (`gi://Geoclue`), with fallback to `ipinfo.io` and reverse city lookup via OpenStreetMap (`nominatim.openstreetmap.org`).

- **Theme, Icon Theme, Accent, and Wallpaper Switching**
  - Switches `org.gnome.desktop.interface` (`color-scheme`, `gtk-theme`, and optional `icon-theme`) with automatic light/dark pairing (`Yaru*`, `Adwaita*`, `Papirus*`, and third-party themes) and system `accent-color` synchronization.
  - Switches desktop wallpapers (`org.gnome.desktop.background` `picture-uri` / `picture-uri-dark`), supporting both system dual-mode XML wallpapers and separate light/dark image files, plus optional lock screen wallpaper updates (`org.gnome.desktop.screensaver`).

- **Pure Asynchronous D-Bus Brightness & Night Light Control**
  - **Built-in & Mutter-managed displays**: Controlled via `org.gnome.Mutter.DisplayConfig` (`Backlight` property and `SetBacklight` method on GNOME 49/50) with fallback to `org.gnome.SettingsDaemon.Power` (`org.gnome.SettingsDaemon.Power.Screen` on GNOME 45–48).
  - **External DDC/CI monitors**: Controlled over D-Bus via [`ddcutil-service`](https://github.com/digitaltrails/ddcutil-service) (`com.ddcutil.DdcutilService`, `/com/ddcutil/DdcutilObject`, `com.ddcutil.DdcutilInterface` VCP `0x10`).
  - Smooth perceptual cosine ease-in-out brightness transitions around sunrise and sunset, plus configurable Night Light color temperature (`1700K–4700K`).
  - Portable JSON configuration export, import, and factory reset.

- **EGO Compliance & Architecture Standards**
  - Zero `spawn` shell subprocesses and zero blocking `/proc` reads on the main loop — pure asynchronous D-Bus proxies, `Gio.File.load_contents_async()`, and GSettings bindings.
  - Clean lifecycle management: all signals, timeouts, and cancellable operations are torn down in `disable()`.
  - Modern Libadwaita (GTK4 / Adw) preferences window with global search enabled.

- **Translations**
  - English (`en`), Russian (`ru`), and Ukrainian (`uk`).

---

## Installation

### From Source (GNOME Shell Extension)

```bash
git clone https://github.com/SGC-NOVUS/novus-tools.git
cd novus-tools
make install
gnome-extensions enable Novus_Tools@sgc-novus.fun
```

### Build EGO Package (`Novus_Tools@sgc-novus.fun.zip`)

```bash
make pack
```

---

## Project Structure

```text
├── metadata.json                 # GNOME Shell extension metadata
├── extension.js                  # Extension entry point (enable / disable & D-Bus export)
├── extensionController.js        # Schedule coordinator, sleep/monitor signals, Night Light & Power sync
├── powerController.js            # D-Bus power-profiles-daemon & UPower scenario controller
├── swapHibernateController.js    # D-Bus systemd login1 sleep/hibernate & async swap telemetry
├── quickSettingsIndicator.js     # GNOME Quick Settings menu toggle and system indicator
├── themeController.js            # GSettings theme, accent-color, and wallpaper controller
├── themeUtils.js                 # GTK theme discovery, theme pairing, and XML wallpaper parser
├── brightnessController.js       # Perceptual gradual brightness transition scheduler
├── displayController.js          # Async D-Bus backends (Mutter, GSD Power, DdcutilService)
├── solarCalculator.js            # Local solar event calculator
├── timeCalculator.js             # Trigger parser and schedule state resolver
├── constants.js                  # Shared timing, trigger, and D-Bus constants
├── logger.js                     # Gated debug logger
├── lib/suncalc.js                # SunCalc astronomical library (BSD-2-Clause)
├── prefs.js                      # Preferences window entry point (Adw / GTK4)
├── prefs/
│   ├── appearancePage.js         # Themes, auto-pair, accent sync, and wallpapers
│   ├── schedulePage.js           # Solar triggers, custom times, and GeoClue2 / IP location
│   ├── powerPage.js              # Power profiles, smart scenarios, swap & hibernation telemetry
│   ├── brightnessPage.js         # Monitor brightness transitions and Night Light settings
│   ├── monitorDialog.js          # Per-monitor brightness configuration dialog
│   ├── brightnessSliderRow.js    # Serialized live-preview brightness slider row
│   ├── displayManager.js         # Monitor discovery and configuration persistence
│   ├── statusPage.js             # Live schedule countdown, power status, and solar timetable
│   ├── aboutPage.js              # Project links, license, and organization info
│   └── dbusClient.js             # Async session D-Bus client helper for Preferences
├── schemas/                      # GSettings schema XML
├── po/                           # Gettext translation catalogs (.pot, ru.po, uk.po)
└── standalone/                   # Optional standalone D-Bus daemon and CLI outside GNOME Shell
```

---

## License & Credits

- **Author & Maintainer**: [SGC-NOVUS](https://sgc-novus.fun) ([github.com/SGC-NOVUS/novus-tools](https://github.com/SGC-NOVUS/novus-tools))
- **License**: [GNU General Public License v3.0 or later (GPL-3.0-or-later)](LICENSE)
- **Third-Party Libraries**:
  - Astronomical solar computations powered by [*SunCalc*](https://github.com/mourner/suncalc) — Copyright (c) Vladimir Agafonkin (`BSD-2-Clause`).
