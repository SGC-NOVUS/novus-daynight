# SGC-NOVUS Tools (`NDN@sgc-novus.fun`)

[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-45--50-blue.svg)](https://extensions.gnome.org/)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-green.svg)](LICENSE)

English | [Русский](README.ru.md)

**SGC-NOVUS Tools** is an all-in-one system automation and environment management suite for GNOME Shell (45–50). It seamlessly coordinates day/night theme transitions, dynamic wallpapers, Night Light synchronization, smooth display brightness over D-Bus, and energy profiles (Performance, Balanced, Power Saver).

---

## Key Features

- **Power Profiles Management (`org.freedesktop.UPower.PowerProfiles`)**
  - Instant switching between **Performance** (🚀 Maximum power), **Balanced** (⚖️ Default), and **Power Saver** (🍃 Maximum battery life).
  - Integrated into the GNOME Quick Settings panel without spawning subprocesses (pure asynchronous D-Bus).
  - Optional **Schedule Automation**: automatically switches to Balanced or Performance during the day and Power Saver at night.

- **Local Solar Schedule (`SunCalc` + `GeoClue2`)**
  - Computes 14 solar phases locally (`sunrise`, `sunset`, `golden_hour`, `dusk`, etc.), or uses custom `HH:MM` schedules including schedules crossing midnight.
  - Supports on-demand location detection in Preferences via `GeoClue2` (`gi://Geoclue`), with optional fallback to `ipinfo.io` and reverse city lookup via OpenStreetMap (`nominatim.openstreetmap.org`).

- **Theme, Accent, and Wallpaper Switching**
  - Switches `org.gnome.desktop.interface` (`color-scheme` and `gtk-theme`) with automatic light/dark theme pairing (`Yaru*`, `Adwaita*`, and third-party GTK themes) and Ubuntu/GNOME `accent-color` synchronization.
  - Switches desktop wallpapers (`org.gnome.desktop.background` `picture-uri` / `picture-uri-dark`), supporting both system dual-mode XML wallpapers and separate light/dark image files, plus optional lock screen wallpaper updates (`org.gnome.desktop.screensaver`).

- **Pure Asynchronous D-Bus Brightness Control**
  - **Built-in & Mutter-managed displays**: Controlled via `org.gnome.Mutter.DisplayConfig` (`Backlight` property and `SetBacklight` method on GNOME 49/50) with fallback to `org.gnome.SettingsDaemon.Power` (`org.gnome.SettingsDaemon.Power.Screen` on GNOME 45–48).
  - **External DDC/CI monitors**: Controlled over D-Bus via [`ddcutil-service`](https://github.com/digitaltrails/ddcutil-service) (`com.ddcutil.DdcutilService`, `/com/ddcutil/DdcutilObject`, `com.ddcutil.DdcutilInterface` VCP `0x10`), without spawning subprocesses.
  - Smooth perceptual cosine ease-in-out brightness transitions around sunrise and sunset.

- **EGO Compliance & Architecture Standards**
  - Strictly follows GNOME Extensions review guidelines:
    - Zero `spawn` shell subprocesses — pure asynchronous D-Bus proxies and GSettings bindings.
    - Robust lifecycle management: all signals, timeouts, and cancellable D-Bus operations are cleanly destroyed upon `disable()`.
    - Native Libadwaita (GTK4 / Adw) preferences dialog.

- **Translations**
  - English (`en`), Russian (`ru`), and Ukrainian (`uk`).

---

## Installation

### From Source (GNOME Shell Extension)

```bash
git clone https://github.com/SGC-NOVUS/novus-daynight.git
cd novus-daynight
make install
gnome-extensions enable NDN@sgc-novus.fun
```

### Build EGO Package (`NDN@sgc-novus.fun.zip`)

```bash
make pack
```

---

## Project Structure

```text
├── metadata.json                 # GNOME Shell extension metadata
├── extension.js                  # Extension entry point (enable / disable & D-Bus export)
├── extensionController.js        # Schedule coordinator, sleep/monitor signals, Night Light & Power sync
├── powerController.js            # Pure D-Bus power-profiles-daemon interface client
├── quickSettingsIndicator.js     # GNOME Quick Settings menu toggle and system indicator
├── themeController.js            # GSettings theme, accent-color, and wallpaper controller
├── themeUtils.js                 # GTK theme discovery, theme pairing, and XML wallpaper parser
├── brightnessController.js       # Perceptual gradual brightness transition scheduler
├── displayController.js          # Async D-Bus backends (Mutter, GSD Power, DdcutilService)
├── solarCalculator.js            # Local solar event calculator
├── timeCalculator.js             # Trigger parser and schedule state resolver
├── constants.js                  # Shared timing and D-Bus constants
├── logger.js                     # Gated debug logger
├── lib/suncalc.js                # SunCalc astronomical library (BSD-2-Clause)
├── prefs.js                      # Preferences window entry point (Adw / GTK4)
├── prefs/
│   ├── appearancePage.js         # Themes, auto-pair, accent sync, and wallpapers
│   ├── schedulePage.js           # Solar triggers, custom times, and GeoClue2 / IP location
│   ├── powerPage.js              # Power profiles configuration and live D-Bus status
│   ├── brightnessPage.js         # Monitor brightness transitions and Night Light settings
│   ├── monitorDialog.js          # Per-monitor brightness configuration dialog
│   ├── brightnessSliderRow.js    # Serialized live-preview brightness slider row
│   ├── displayManager.js         # Monitor discovery and configuration persistence
│   ├── statusPage.js             # Live schedule countdown and solar timetable
│   ├── aboutPage.js              # Project links, license, and organization info
│   └── dbusClient.js             # Async session D-Bus client helper for Preferences
├── schemas/                      # GSettings schema XML
├── po/                           # Gettext translation catalogs (.pot, ru.po, uk.po)
└── standalone/                   # Optional standalone D-Bus daemon and CLI outside GNOME Shell
```

---

## License & Credits

- **Author & Maintainer**: [SGC-NOVUS](https://sgc-novus.fun) ([github.com/SGC-NOVUS/novus-daynight](https://github.com/SGC-NOVUS/novus-daynight))
- **License**: [GNU General Public License v3.0 or later (GPL-3.0-or-later)](LICENSE)
- **Third-Party Libraries**:
  - Astronomical solar computations powered by [*SunCalc*](https://github.com/mourner/suncalc) — Copyright (c) Vladimir Agafonkin (`BSD-2-Clause`).
