#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

PKG_NAME="novus-daynight"
PKG_VERSION="${PKG_VERSION:-1.0.0}"
ARCH="all"
UUID="NDN@sgc-novus.fun"

DIST_DIR="${ROOT_DIR}/dist"
STAGE_BASE="$(mktemp -d)"
PKG_ROOT="${STAGE_BASE}/${PKG_NAME}_${PKG_VERSION}_${ARCH}"

cleanup() {
    rm -rf "${STAGE_BASE}"
}
trap cleanup EXIT

echo "==> Building schemas & translations..."
make -C "${ROOT_DIR}" build

echo "==> Staging Debian package tree (${PKG_NAME}_${PKG_VERSION}_${ARCH})..."
mkdir -p \
    "${PKG_ROOT}/DEBIAN" \
    "${PKG_ROOT}/usr/bin" \
    "${PKG_ROOT}/usr/share/gnome-shell/extensions/${UUID}" \
    "${PKG_ROOT}/usr/share/novus-daynight" \
    "${PKG_ROOT}/usr/share/glib-2.0/schemas" \
    "${PKG_ROOT}/usr/share/locale" \
    "${PKG_ROOT}/usr/share/applications" \
    "${PKG_ROOT}/usr/lib/udev/rules.d" \
    "${PKG_ROOT}/usr/lib/modules-load.d" \
    "${PKG_ROOT}/etc/xdg/autostart" \
    "${PKG_ROOT}/usr/share/doc/${PKG_NAME}"

CORE_MODULES=(
    metadata.json
    constants.js
    themeUtils.js
    displayController.js
    brightnessController.js
    themeController.js
    solarCalculator.js
    timeCalculator.js
    logger.js
    prefs.js
)

SHELL_ONLY_MODULES=(
    extension.js
    extensionController.js
    quickSettingsIndicator.js
)

for f in "${CORE_MODULES[@]}" "${SHELL_ONLY_MODULES[@]}"; do
    install -m 0644 "${ROOT_DIR}/${f}" "${PKG_ROOT}/usr/share/gnome-shell/extensions/${UUID}/${f}"
done

for f in "${CORE_MODULES[@]}"; do
    install -m 0644 "${ROOT_DIR}/${f}" "${PKG_ROOT}/usr/share/novus-daynight/${f}"
done

cp -r "${ROOT_DIR}/lib" "${PKG_ROOT}/usr/share/gnome-shell/extensions/${UUID}/"
cp -r "${ROOT_DIR}/prefs" "${PKG_ROOT}/usr/share/gnome-shell/extensions/${UUID}/"
cp -r "${ROOT_DIR}/lib" "${PKG_ROOT}/usr/share/novus-daynight/"
cp -r "${ROOT_DIR}/prefs" "${PKG_ROOT}/usr/share/novus-daynight/"
cp -r "${ROOT_DIR}/standalone" "${PKG_ROOT}/usr/share/novus-daynight/"

chmod 0755 \
    "${PKG_ROOT}/usr/share/novus-daynight/standalone/novus-daynight" \
    "${PKG_ROOT}/usr/share/novus-daynight/standalone/novus-daynight-daemon.js" \
    "${PKG_ROOT}/usr/share/novus-daynight/standalone/novus-daynight-prefs.js"

install -m 0644 \
    "${ROOT_DIR}/schemas/org.gnome.shell.extensions.novus-daynight.gschema.xml" \
    "${PKG_ROOT}/usr/share/glib-2.0/schemas/org.gnome.shell.extensions.novus-daynight.gschema.xml"

mkdir -p "${PKG_ROOT}/usr/share/gnome-shell/extensions/${UUID}/schemas"
install -m 0644 \
    "${ROOT_DIR}/schemas/org.gnome.shell.extensions.novus-daynight.gschema.xml" \
    "${PKG_ROOT}/usr/share/gnome-shell/extensions/${UUID}/schemas/"
install -m 0644 \
    "${ROOT_DIR}/schemas/gschemas.compiled" \
    "${PKG_ROOT}/usr/share/gnome-shell/extensions/${UUID}/schemas/"

cp -r "${ROOT_DIR}/locale/"* "${PKG_ROOT}/usr/share/locale/"
cp -r "${ROOT_DIR}/locale" "${PKG_ROOT}/usr/share/gnome-shell/extensions/${UUID}/"
cp -r "${ROOT_DIR}/locale" "${PKG_ROOT}/usr/share/novus-daynight/"

cat > "${PKG_ROOT}/usr/bin/novus-daynight" <<'EOF'
#!/bin/sh
exec gjs -m /usr/share/novus-daynight/standalone/novus-daynight "$@"
EOF
chmod 0755 "${PKG_ROOT}/usr/bin/novus-daynight"

cat > "${PKG_ROOT}/usr/share/applications/fun.sgc_novus.NovusDayNight.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Novus DayNight
Name[ru]=Novus DayNight (День/Ночь)
Name[uk]=Novus DayNight (День/Ніч)
Comment=Automatic day/night theme, wallpaper, and screen brightness switcher
Comment[ru]=Автоматическое переключение светлой/тёмной темы, обоев и яркости экранов
Comment[uk]=Автоматичне перемикання світлої/темної теми, шпалер та яскравості екранів
Exec=/usr/bin/novus-daynight prefs
Icon=preferences-desktop-theme
Terminal=false
Categories=Settings;DesktopSettings;GTK;
Keywords=theme;dark;light;night;brightness;solar;wallpaper;gnome;
StartupNotify=true
EOF

cat > "${PKG_ROOT}/etc/xdg/autostart/fun.sgc_novus.NovusDayNight.Daemon.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Novus DayNight Background Daemon
Name[ru]=Фоновая служба Novus DayNight
Name[uk]=Фонова служба Novus DayNight
Comment=Automatic solar theme, wallpaper, and brightness daemon
Exec=/usr/bin/novus-daynight daemon
Icon=preferences-desktop-theme
Terminal=false
NoDisplay=true
NotShowIn=GNOME;Ubuntu;
X-GNOME-Autostart-enabled=false
EOF

cat > "${PKG_ROOT}/usr/lib/udev/rules.d/60-novus-daynight-i2c.rules" <<'EOF'
SUBSYSTEM=="i2c-dev", KERNEL=="i2c-[0-9]*", TAG+="uaccess"
EOF

cat > "${PKG_ROOT}/usr/lib/modules-load.d/novus-daynight-i2c.conf" <<'EOF'
i2c-dev
EOF

install -m 0644 "${ROOT_DIR}/README.md" "${PKG_ROOT}/usr/share/doc/${PKG_NAME}/README.md"
if [ -f "${ROOT_DIR}/LICENSE" ]; then
    install -m 0644 "${ROOT_DIR}/LICENSE" "${PKG_ROOT}/usr/share/doc/${PKG_NAME}/copyright"
fi

find "${PKG_ROOT}" -type d -exec chmod 0755 {} +
find "${PKG_ROOT}/usr" "${PKG_ROOT}/etc" -type f ! -perm -0100 -exec chmod 0644 {} +
find "${PKG_ROOT}/usr" -type f -perm -0100 -exec chmod 0755 {} +

INSTALLED_KB="$(du -sk "${PKG_ROOT}/usr" "${PKG_ROOT}/etc" | awk '{s+=$1} END {print s}')"

cat > "${PKG_ROOT}/DEBIAN/control" <<EOF
Package: ${PKG_NAME}
Version: ${PKG_VERSION}
Section: gnome
Priority: optional
Architecture: ${ARCH}
Installed-Size: ${INSTALLED_KB}
Depends: gjs (>= 1.72), gir1.2-gtk-4.0, gir1.2-adw-1, gir1.2-glib-2.0, libglib2.0-bin
Recommends: gir1.2-soup-3.0, gir1.2-geoclue-2.0
Suggests: gnome-shell (>= 45), ddcutil-service
Maintainer: SGC-NOVUS (System Generations Core Novus) <support@sgc-novus.fun>
Homepage: https://github.com/SGC-NOVUS/novus-daynight
Description: Automatic solar day/night theme, wallpaper & brightness switcher
 Novus DayNight automatically switches GTK/GNOME themes, dynamic wallpapers,
 Night Light, and display brightness over D-Bus based on local sunrise/sunset
 calculations or a custom schedule.
EOF

cat > "${PKG_ROOT}/DEBIAN/conffiles" <<'EOF'
/etc/xdg/autostart/fun.sgc_novus.NovusDayNight.Daemon.desktop
EOF

cat > "${PKG_ROOT}/DEBIAN/postinst" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = "configure" ]; then
    if command -v glib-compile-schemas >/dev/null 2>&1; then
        glib-compile-schemas /usr/share/glib-2.0/schemas || true
    fi
    if command -v modprobe >/dev/null 2>&1; then
        modprobe i2c-dev 2>/dev/null || true
    fi
    if command -v udevadm >/dev/null 2>&1; then
        udevadm control --reload-rules 2>/dev/null || true
        udevadm trigger --subsystem-match=i2c-dev 2>/dev/null || true
    fi
fi
exit 0
EOF
chmod 0755 "${PKG_ROOT}/DEBIAN/postinst"

cat > "${PKG_ROOT}/DEBIAN/postrm" <<'EOF'
#!/bin/sh
set -e
if [ "$1" = "remove" ] || [ "$1" = "purge" ]; then
    if command -v glib-compile-schemas >/dev/null 2>&1; then
        glib-compile-schemas /usr/share/glib-2.0/schemas || true
    fi
    if command -v udevadm >/dev/null 2>&1; then
        udevadm control --reload-rules 2>/dev/null || true
    fi
fi
exit 0
EOF
chmod 0755 "${PKG_ROOT}/DEBIAN/postrm"

mkdir -p "${DIST_DIR}"
OUT_DEB="${DIST_DIR}/${PKG_NAME}_${PKG_VERSION}_${ARCH}.deb"
dpkg-deb --root-owner-group --build "${PKG_ROOT}" "${OUT_DEB}"
echo "==> Created package: ${OUT_DEB}"
