# SGC-NOVUS Tools (`NDN@sgc-novus.fun`)

[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-45--50-blue.svg)](https://extensions.gnome.org/)
[![Лицензия: GPL-3.0](https://img.shields.io/badge/License-GPLv3-green.svg)](LICENSE)

[English](README.md) | Русский

**SGC-NOVUS Tools** — это расширение для GNOME Shell (45–50) для автоматизации системного окружения: переключения тем день/ночь, динамических обоев, синхронизации с «Ночным светом», плавной регулировки яркости мониторов и управления профилями энергопотребления по D-Bus.

---

## Основные возможности

- **Управление профилями энергопотребления (`org.freedesktop.UPower.PowerProfiles`)**
  - Мгновенное переключение между:
    - 🚀 **Максимальная производительность** (`performance`)
    - ⚖️ **Сбалансированно** (`balanced`)
    - 🍃 **Максимальное энергосбережение** (`power-saver`)
  - Интеграция в меню быстрых настроек GNOME (Quick Settings).
  - Работа через чистый асинхронный D-Bus без запуска внешних утилит через shell (`no spawn`).
  - **Автоматизация по расписанию**: автоматический переход в режим максимального энергосбережения ночью и в сбалансированный/производительный режим днём.

- **Астрономическое расписание (`SunCalc` + `GeoClue2`)**
  - Локальный расчет 14 солнечных фаз (`sunrise`, `sunset`, `golden_hour`, `dusk` и др.) или настройка точного времени `ЧЧ:ММ`.
  - Автоматическое определение местоположения по запросу в настройках через `GeoClue2` с резервным определением по IP (`ipinfo.io`) и города через OpenStreetMap (`nominatim.openstreetmap.org`).

- **Управление темами, акцентными цветами и обоями**
  - Переключение `org.gnome.desktop.interface` (`color-scheme` и `gtk-theme`) с автоподбором светлых и тёмных пар (`Yaru*`, `Adwaita*` и сторонние GTK-темы) и синхронизацией акцентных цветов Ubuntu/GNOME.
  - Смена обоев рабочего стола (`picture-uri` / `picture-uri-dark`), поддержка системных XML-обоев и раздельных файлов изображений, опциональное обновление экрана блокировки.

- **Асинхронное управление яркостью по D-Bus**
  - **Встроенные экраны**: управление через `org.gnome.Mutter.DisplayConfig` (свойство `Backlight` и метод `SetBacklight` в GNOME 49/50) с фолбэком на `org.gnome.SettingsDaemon.Power`.
  - **Внешние DDC/CI мониторы**: управление по D-Bus через службу [`ddcutil-service`](https://github.com/digitaltrails/ddcutil-service) (`com.ddcutil.DdcutilService` VCP `0x10`) без порождения подпроцессов.
  - Плавные косинусные переходы яркости вокруг времени восхода и заката.

- **Соответствие эталонам EGO Review Guidelines**
  - Никаких вызовов команд оболочки через `spawn` — только нативные асинхронные D-Bus интерфейсы.
  - Идеальное управление жизненным циклом: корректное отключение всех таймеров, сигналов и отмена асинхронных операций при выключении расширения (`disable()`).
  - Современный интерфейс настроек на Libadwaita (GTK4 / Adw).

---

## Установка

### Из исходного кода

```bash
git clone https://github.com/SGC-NOVUS/novus-daynight.git
cd novus-daynight
make install
gnome-extensions enable NDN@sgc-novus.fun
```

### Сборка EGO-пакета (`NDN@sgc-novus.fun.zip`)

```bash
make pack
```

---

## Лицензия и благодарности

- **Автор и мейнтейнер**: [SGC-NOVUS](https://sgc-novus.fun) ([github.com/SGC-NOVUS/novus-daynight](https://github.com/SGC-NOVUS/novus-daynight))
- **Лицензия**: [GNU General Public License v3.0 или новее (GPL-3.0-or-later)](LICENSE)
- **Сторонние библиотеки**:
  - Астрономические расчеты движения солнца: [*SunCalc*](https://github.com/mourner/suncalc) — Copyright (c) Vladimir Agafonkin (`BSD-2-Clause`).
