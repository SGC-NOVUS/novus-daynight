# Novus DayNight (`NDN@sgc-novus.fun`)

[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-45--50-blue.svg)](https://extensions.gnome.org/)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-green.svg)](LICENSE)

English | [Русский](README.ru.md)

**Novus DayNight** is a GNOME Shell extension (45–50) for automatic day/night theme switching, dynamic wallpapers, Night Light synchronization, and smooth display brightness transitions over D-Bus.

---

## Features

- **Local Solar Schedule (`SunCalc` + `GeoClue2`)**
  - Computes 14 solar phases locally (`first_light`, `nautical_dawn`, `dawn`, `sunrise`, `sunrise_end`, `golden_hour_end`, `solar_noon`, `golden_hour`, `sunset_start`, `sunset`, `dusk`, `nautical_dusk`, `last_light`, `nadir`), or uses custom `HH:MM` schedules including schedules crossing midnight.
  - Supports on-demand location detection in Preferences via `GeoClue2` (`gi://Geoclue`), with optional fallback to `ipinfo.io` and reverse city lookup via OpenStreetMap (`nominatim.openstreetmap.org`).

- **Theme, Accent, and Wallpaper Switching**
  - Switches `org.gnome.desktop.interface` (`color-scheme` and `gtk-theme`) with automatic light/dark theme pairing (`Yaru*`, `Adwaita*`, and third-party GTK themes) and Ubuntu/GNOME `accent-color` synchronization.
  - Switches desktop wallpapers (`org.gnome.desktop.background` `picture-uri` / `picture-uri-dark`), supporting both system dual-mode XML wallpapers and separate light/dark image files, plus optional lock screen wallpaper updates (`org.gnome.desktop.screensaver`).
  - Integrates into the GNOME Quick Settings panel (`QuickMenuToggle` & `SystemIndicator`) for one-click switching between Automatic Schedule, Day Mode, and Night Mode.

- **Pure Asynchronous D-Bus Brightness Control**
  - **Built-in & Mutter-managed displays**: Controlled via `org.gnome.Mutter.DisplayConfig` (`Backlight` property and `SetBacklight` method on GNOME 49/50) with fallback to `org.gnome.SettingsDaemon.Power` (`org.gnome.SettingsDaemon.Power.Screen` on GNOME 45–48).
  - **External DDC/CI monitors**: Controlled over D-Bus via [`ddcutil-service`](https://github.com/digitaltrails/ddcutil-service) (`com.ddcutil.DdcutilService`, `/com/ddcutil/DdcutilObject`, `com.ddcutil.DdcutilInterface` VCP `0x10`), without spawning subprocesses.
  - Smooth perceptual cosine ease-in-out brightness transitions around sunrise and sunset.

- **Translations**
  - English (`en`), Russian (`ru`), and Ukrainian (`uk`).

---

## External Monitor Support (`ddcutil-service`)

To control external HDMI / DisplayPort / USB-C monitors via DDC/CI over D-Bus, install and enable `ddcutil-service` so `com.ddcutil.DdcutilService` is available on the session bus, and ensure your user has access to `/dev/i2c-*` (`i2c-dev` kernel module loaded and `uaccess` udev rule or `i2c` group membership).

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

### Build Debian / Ubuntu Package (`.deb`)

```bash
make deb
sudo apt install ./dist/novus-daynight_1.0.0_all.deb
```

---

## Build Targets

```bash
make build              # Compile GSettings schema locally and generate .mo files
make pack               # Validate schema and create EGO-compliant NDN@sgc-novus.fun.zip
make deb                # Build Debian/Ubuntu package in dist/
make install            # Install extension to ~/.local/share/gnome-shell/extensions/
make install-standalone # Install optional standalone CLI and daemon to ~/.local/
make clean              # Remove build artifacts
```

---

## Project Structure

```text
├── metadata.json                 # GNOME Shell extension metadata
├── extension.js                  # Extension entry point (enable / disable & D-Bus export)
├── extensionController.js        # Schedule coordinator, sleep/monitor signals, Night Light sync
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
│   ├── brightnessPage.js         # Monitor brightness transitions and Night Light settings
│   ├── monitorDialog.js          # Per-monitor brightness configuration dialog
│   ├── brightnessSliderRow.js    # Serialized live-preview brightness slider row
│   ├── displayManager.js         # Monitor discovery and configuration persistence
│   ├── statusPage.js             # Live schedule countdown and solar timetable
│   ├── aboutPage.js              # Project links, license, and credits
│   └── dbusClient.js             # Async session D-Bus client helper for Preferences
├── schemas/                      # GSettings schema XML
├── po/                           # Gettext translation catalogs (.pot, ru.po, uk.po)
└── standalone/                   # Optional standalone D-Bus daemon and CLI outside GNOME Shell
```

---

## License & Credits

- **Author**: [SGC-NOVUS](https://sgc-novus.fun) ([github.com/SGC-NOVUS/novus-daynight](https://github.com/SGC-NOVUS/novus-daynight))
- **License**: [GNU General Public License v3.0 or later (GPL-3.0-or-later)](LICENSE)
- **Credits**:
  - Based on [*Automatic Theme Switcher*](https://github.com/amritashan/auto-theme-switcher) by Amritashan S. Lal (`GPL-3.0`).
  - Astronomical calculations powered by [*SunCalc*](https://github.com/mourner/suncalc) — Copyright (c) Vladimir Agafonkin (`BSD-2-Clause`).
