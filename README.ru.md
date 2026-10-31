# Novus DayNight (`NDN@sgc-novus.fun`)

[![GNOME Shell](https://img.shields.io/badge/GNOME%20Shell-45--50-blue.svg)](https://extensions.gnome.org/)
[![License: GPL-3.0](https://img.shields.io/badge/License-GPLv3-green.svg)](LICENSE)

[English](README.md) | Русский

**Novus DayNight** — расширение GNOME Shell (45–50) для автоматического переключения светлой и тёмной тем, динамических обоев, синхронизации «Ночной подсветки» и плавного управления яркостью экранов через D-Bus.

---

## Возможности

- **Локальный расчёт расписания по солнцу (`SunCalc` + `GeoClue2`)**
  - Локальный расчёт 14 солнечных фаз (`first_light`, `nautical_dawn`, `dawn`, `sunrise`, `sunrise_end`, `golden_hour_end`, `solar_noon`, `golden_hour`, `sunset_start`, `sunset`, `dusk`, `nautical_dusk`, `last_light`, `nadir`) либо использование пользовательского времени `ЧЧ:ММ` (включая расписания с переходом через полночь).
  - Определение координат в окне настроек через системную службу `GeoClue2` (`gi://Geoclue`) с опциональным резервным источником `ipinfo.io` и обратным геокодированием через OpenStreetMap (`nominatim.openstreetmap.org`).

- **Управление темами, акцентами и обоями**
  - Переключение параметров `org.gnome.desktop.interface` (`color-scheme` и `gtk-theme`) с автоподбором пар тем (`Yaru*`, `Adwaita*` и сторонние темы GTK) и синхронизацией с системным акцентным цветом Ubuntu/GNOME.
  - Смена обоев рабочего стола (`org.gnome.desktop.background` `picture-uri` / `picture-uri-dark`), поддержка системных парных XML-обоев и раздельных файлов изображений, а также опциональное обновление фона экрана блокировки (`org.gnome.desktop.screensaver`).
  - Интеграция в системное меню быстрых настроек GNOME Quick Settings (`QuickMenuToggle` и `SystemIndicator`) для быстрого выбора режима (Авторасписание, День, Ночь).

- **Асинхронное управление яркостью через D-Bus**
  - **Встроенные экраны и дисплеи под управлением Mutter**: управление через `org.gnome.Mutter.DisplayConfig` (свойство `Backlight` и метод `SetBacklight` в GNOME 49/50) с мягким переходом на `org.gnome.SettingsDaemon.Power` (`org.gnome.SettingsDaemon.Power.Screen` в GNOME 45–48).
  - **Внешние мониторы (DDC/CI)**: управление через сессионный сервис [`ddcutil-service`](https://github.com/digitaltrails/ddcutil-service) (`com.ddcutil.DdcutilService`, объект `/com/ddcutil/DdcutilObject`, интерфейс `com.ddcutil.DdcutilInterface`, регистр VCP `0x10`) без запуска дочерних процессов.
  - Плавные S-образные переходы яркости (косинусное сглаживание) во время рассвета и заката.

- **Локализация**
  - Английский (`en`), русский (`ru`) и украинский (`uk`).

---

## Поддержка внешних мониторов (`ddcutil-service`)

Для регулировки яркости внешних мониторов HDMI / DisplayPort / USB-C по протоколу DDC/CI установите и включите сервис `ddcutil-service`, чтобы на сессионной шине D-Bus был доступен сервис `com.ddcutil.DdcutilService`, а пользователь имел доступ к `/dev/i2c-*` (загруженный модуль ядра `i2c-dev` и правило udev с тегом `uaccess` либо членство в группе `i2c`).

---

## Установка

### Из исходных кодов (расширение GNOME Shell)

```bash
git clone https://github.com/SGC-NOVUS/novus-daynight.git
cd novus-daynight
make install
gnome-extensions enable NDN@sgc-novus.fun
```

### Сборка архива для EGO (`NDN@sgc-novus.fun.zip`)

```bash
make pack
```

### Сборка пакета Debian / Ubuntu (`.deb`)

```bash
make deb
sudo apt install ./dist/novus-daynight_1.0.0_all.deb
```

---

## Команды Makefile

```bash
make build              # Компиляция схемы GSettings и сборка файлов .mo
make pack               # Проверка схемы и сборка архива NDN@sgc-novus.fun.zip для EGO
make deb                # Сборка установочного пакета Debian/Ubuntu в каталоге dist/
make install            # Установка расширения в ~/.local/share/gnome-shell/extensions/
make install-standalone # Установка автономного CLI и фонового сервиса в ~/.local/
make clean              # Удаление артефактов сборки
```

---

## Структура проекта

```text
├── metadata.json                 # Метаданные расширения GNOME Shell
├── extension.js                  # Точка входа расширения (enable / disable и экспорт D-Bus)
├── extensionController.js        # Координатор расписания, сигналов сна и ночной подсветки
├── quickSettingsIndicator.js     # Кнопка-переключатель и индикатор в меню Quick Settings
├── themeController.js            # Управление темами, акцентами и обоями через GSettings
├── themeUtils.js                 # Поиск тем GTK, подбор пар и парсер XML-обоев
├── brightnessController.js       # Планировщик плавных переходов яркости
├── displayController.js          # Асинхронные D-Bus бэкенды (Mutter, GSD Power, DdcutilService)
├── solarCalculator.js            # Локальный расчёт фаз солнца (SunCalc)
├── timeCalculator.js             # Парсер триггеров и определение текущего периода
├── constants.js                  # Общие константы времени и D-Bus
├── logger.js                     # Диагностический логгер
├── lib/suncalc.js                # Астрономическая библиотека SunCalc (BSD-2-Clause)
├── prefs.js                      # Точка входа окна настроек (Adw / GTK4)
├── prefs/
│   ├── appearancePage.js         # Темы оформления, автоподбор пар, акценты и обои
│   ├── schedulePage.js           # Триггеры солнца, ручное время и координаты
│   ├── brightnessPage.js         # Параметры яркости мониторов и ночной подсветки
│   ├── monitorDialog.js          # Диалог индивидуальной настройки мониторов
│   ├── brightnessSliderRow.js    # Ряд настройки яркости с предпросмотром
│   ├── displayManager.js         # Обнаружение мониторов и сохранение конфигурации
│   ├── statusPage.js             # Панель текущего состояния и расписание солнца
│   ├── aboutPage.js              # Ссылки на проект, лицензия и авторы
│   └── dbusClient.js             # Асинхронный вспомогательный клиент D-Bus
├── schemas/                      # Описание схемы GSettings
├── po/                           # Каталоги переводов gettext (.pot, ru.po, uk.po)
└── standalone/                   # Автономный CLI и фоновый сервис вне GNOME Shell
```

---

## Лицензия и авторы

- **Автор**: [SGC-NOVUS](https://sgc-novus.fun) ([github.com/SGC-NOVUS/novus-daynight](https://github.com/SGC-NOVUS/novus-daynight))
- **Лицензия**: [GNU General Public License v3.0 or later (GPL-3.0-or-later)](LICENSE)
- **Использованные материалы**:
  - Основано на проекте [*Automatic Theme Switcher*](https://github.com/amritashan/auto-theme-switcher), автор Amritashan S. Lal (`GPL-3.0`).
  - Расчёт солнечных фаз: библиотека [*SunCalc*](https://github.com/mourner/suncalc), автор Vladimir Agafonkin (`BSD-2-Clause`).
