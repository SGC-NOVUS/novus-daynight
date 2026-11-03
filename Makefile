UUID = Novus_Tools@sgc-novus.fun
PKG_VERSION = 2.0.0
BASE_DIR = $(shell pwd)
INSTALL_DIR = $(HOME)/.local/share/gnome-shell/extensions/$(UUID)
STANDALONE_DIR = $(HOME)/.local/share/novus-daynight
LOCAL_BIN_DIR = $(HOME)/.local/bin
LOCAL_APPS_DIR = $(HOME)/.local/share/applications
SCHEMAS_DIR = schemas
PO_DIR = po
LOCALE_DIR = locale

EXTENSION_FILES = \
	metadata.json \
	LICENSE \
	extension.js \
	prefs.js \
	constants.js \
	logger.js \
	solarCalculator.js \
	timeCalculator.js \
	themeUtils.js \
	displayController.js \
	brightnessController.js \
	powerController.js \
	swapHibernateController.js \
	themeController.js \
	quickSettingsIndicator.js \
	extensionController.js \
	lib \
	prefs \
	schemas/org.gnome.shell.extensions.novus-daynight.gschema.xml \
	locale

.PHONY: all build schemas translations pack deb install install-standalone uninstall clean help

all: build

help:
	@echo "SGC-NOVUS Tools Build & Packaging Commands:"
	@echo "  make build              - Compile GSettings schemas and gettext .mo translations"
	@echo "  make schemas            - Compile GSettings schemas"
	@echo "  make translations       - Generate .mo files from po/"
	@echo "  make pack               - Create EGO-compliant GNOME Shell zip ($(UUID).zip)"
	@echo "  make deb                - Build Debian/Ubuntu .deb package (dist/)"
	@echo "  make install            - Install GNOME Shell extension to $(INSTALL_DIR)"
	@echo "  make install-standalone - Install standalone CLI, daemon & desktop launcher to ~/.local"
	@echo "  make uninstall          - Remove local user installations"
	@echo "  make clean              - Clean up build artifacts"

build: schemas translations

schemas:
	glib-compile-schemas --strict $(SCHEMAS_DIR)

translations:
	python3 generate_translations.py

pack: translations
	glib-compile-schemas --strict --dry-run $(SCHEMAS_DIR)
	@rm -f $(UUID).zip
	@zip -q -r $(UUID).zip $(EXTENSION_FILES)
	@echo "EGO package created: $(UUID).zip"

deb: build
	@PKG_VERSION=$(PKG_VERSION) bash packaging/build-deb.sh

install: build
	@mkdir -p $(INSTALL_DIR)/schemas
	@if [ "$(realpath $(BASE_DIR))" != "$(realpath $(INSTALL_DIR))" ]; then \
		cp -r $(EXTENSION_FILES) $(INSTALL_DIR)/; \
		cp $(SCHEMAS_DIR)/gschemas.compiled $(INSTALL_DIR)/schemas/; \
	fi
	@echo "Installed GNOME extension to $(INSTALL_DIR)"

install-standalone: build
	@mkdir -p $(STANDALONE_DIR) $(LOCAL_BIN_DIR) $(LOCAL_APPS_DIR)
	@cp -r metadata.json constants.js themeUtils.js displayController.js brightnessController.js \
		powerController.js swapHibernateController.js themeController.js solarCalculator.js \
		timeCalculator.js logger.js prefs.js lib prefs schemas locale standalone $(STANDALONE_DIR)/
	@chmod +x $(STANDALONE_DIR)/standalone/novus-daynight \
		$(STANDALONE_DIR)/standalone/novus-daynight-daemon.js \
		$(STANDALONE_DIR)/standalone/novus-daynight-prefs.js
	@printf '#!/bin/sh\nexec gjs -m "%s/standalone/novus-daynight" "$$@"\n' "$(STANDALONE_DIR)" > $(LOCAL_BIN_DIR)/novus-daynight
	@chmod +x $(LOCAL_BIN_DIR)/novus-daynight
	@printf '[Desktop Entry]\nType=Application\nName=SGC-NOVUS Tools\nComment=Automatic solar theme, wallpaper, brightness & power profiles switcher\nExec=%s/novus-daynight prefs\nIcon=preferences-desktop-theme\nTerminal=false\nCategories=Settings;DesktopSettings;GTK;\n' "$(LOCAL_BIN_DIR)" > $(LOCAL_APPS_DIR)/fun.sgc_novus.NovusDayNight.desktop
	@echo "Installed standalone CLI ($(LOCAL_BIN_DIR)/novus-daynight) and desktop entry."

uninstall:
	@if [ "$(realpath $(BASE_DIR))" != "$(realpath $(INSTALL_DIR))" ]; then \
		rm -rf $(INSTALL_DIR); \
	fi
	@rm -rf $(STANDALONE_DIR) $(LOCAL_BIN_DIR)/novus-daynight $(LOCAL_APPS_DIR)/fun.sgc_novus.NovusDayNight.desktop
	@echo "Uninstalled $(UUID) and standalone files"

clean:
	@rm -f $(SCHEMAS_DIR)/gschemas.compiled
	@rm -f $(UUID).zip
	@rm -rf dist __pycache__
	@echo "Cleaned build artifacts"
