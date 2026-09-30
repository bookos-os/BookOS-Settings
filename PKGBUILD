# Maintainer: Jose <josrebe333@gmail.com>
pkgname=bookos-settings
pkgver=0.6.0
pkgrel=2
pkgdesc="BookOS Settings — native settings for the BookOS desktop"
arch=('x86_64')
url="https://github.com/Evelynx08/BookOS-Settings"
license=('GPL3')
install=bookos-settings.install
# upower: lo consulta refresh_devices_cache() para la tarjeta de bateria
# (portatil, auriculares). El movil y la tablet entran por BookOS Link.
depends=('webkit2gtk-4.1' 'gtk3' 'libsoup3' 'python' 'upower' 'imagemagick')
optdepends=(
    'colord: ICC profile support'
)
makedepends=('rust' 'cargo' 'protobuf' 'git')

source=()
sha256sums=()

build() {
    cd "${startdir}/src-tauri"
    # --release, no "--no-bundle": eso ultimo es una opcion de `cargo tauri`,
    # no de cargo, y hacia fallar el build con "unexpected argument". Ademas
    # package() busca el binario en target/release, asi que sin --release no
    # habria nada que empaquetar.
    cargo build --release
}

package() {
    # Definimos las rutas relativas al directorio de compilación
    local _builddir="${startdir}"
    local _bin="${_builddir}/src-tauri/target/release"
    local _extra="${_builddir}/src-tauri/extra"
    local _src="${_builddir}/src"

    # Binary
    install -Dm755 "$_bin/bookos-settings" \
        "$pkgdir/usr/bin/bookos-settings"

    # Desktop entry
    install -dm755 "$pkgdir/usr/share/applications"
    cat > "$pkgdir/usr/share/applications/bookos-settings.desktop" << EOF
[Desktop Entry]
Name=Settings
Name[es]=Ajustes
Comment=Settings for the BookOS desktop
Exec=bookos-settings
Icon=bookos-settings
Terminal=false
Type=Application
Categories=Settings;
StartupWMClass=bookos-settings
EOF

    # Icons
    install -Dm644 "$_src/assets/settings.png" \
        "$pkgdir/usr/share/icons/hicolor/256x256/apps/bookos-settings.png"
    install -Dm644 "$_src/assets/settings.svg" \
        "$pkgdir/usr/share/icons/hicolor/scalable/apps/bookos-settings.svg"
    # Notification icons used by Rust commands (notify-send -i bookos-buds, etc.)
    install -Dm644 "${_builddir}/src-tauri/icons/bookos-buds.svg" \
        "$pkgdir/usr/share/icons/hicolor/scalable/apps/bookos-buds.svg"

    # Systemd system units
    install -Dm644 "$_extra/bookos-battery-adaptive.service" \
        "$pkgdir/usr/lib/systemd/system/bookos-battery-adaptive.service"
    install -Dm644 "$_extra/bookos-battery-adaptive.timer" \
        "$pkgdir/usr/lib/systemd/system/bookos-battery-adaptive.timer"
    install -Dm644 "$_extra/bookos-battery-logger.service" \
        "$pkgdir/usr/lib/systemd/system/bookos-battery-logger.service"
    install -Dm644 "$_extra/bookos-battery-logger.timer" \
        "$pkgdir/usr/lib/systemd/system/bookos-battery-logger.timer"
    install -Dm644 "$_extra/bookos-hw-perms.service" \
        "$pkgdir/usr/lib/systemd/system/bookos-hw-perms.service"
    install -Dm644 "$_extra/bookos-thermal-logger.service" \
        "$pkgdir/usr/lib/systemd/system/bookos-thermal-logger.service"

    # udev rules
    install -Dm644 "$_extra/99-bookos-power.rules" \
        "$pkgdir/usr/lib/udev/rules.d/99-bookos-power.rules"
    install -Dm644 "$_extra/61-samsung-galaxybook.hwdb" \
        "$pkgdir/usr/lib/udev/hwdb.d/61-samsung-galaxybook.hwdb"

    # ACPI event — Fn+F1 triggers bookos-settings --toggle
    install -Dm644 "$_extra/samsung-settings.acpi" \
        "$pkgdir/etc/acpi/events/samsung-settings"

    # Shell scripts
    install -Dm755 "$_extra/bookos-battery-adaptive.sh" \
        "$pkgdir/usr/lib/bookos/bookos-battery-adaptive.sh"
    install -Dm755 "$_extra/bookos-battery-logger.sh" \
        "$pkgdir/usr/lib/bookos/bookos-battery-logger.sh"
    install -Dm755 "$_extra/bookos-thermal-logger.sh" \
        "$pkgdir/usr/lib/bookos/bookos-thermal-logger.sh"
    install -Dm755 "$_extra/bookos-toggle-as-user.sh" \
        "$pkgdir/usr/lib/bookos/bookos-toggle-as-user.sh"
    install -Dm755 "$_extra/scripts/bookos-reapply-theme.sh" \
        "$pkgdir/usr/lib/bookos/bookos-reapply-theme.sh"

    # Actualizar únicamente el tema de inicio de sesión SDDM.
    install -Dm644 "$_extra/bookos-theme-reapply.hook" \
        "$pkgdir/usr/share/libalpm/hooks/95-bookos-theme-reapply.hook"

    # Cliente del color dinamico: el fichero CANONICO que copian las demas apps
    # de BookOS (Reloj, Notas, Store, Player, Viewer, Shell). Cada una lleva su
    # propia copia en su repo; esta es la referencia con la que compararlas.
    install -Dm644 "$_extra/dynamic-color/bookos-palette.js" \
        "$pkgdir/usr/share/bookos-settings/dynamic-color/bookos-palette.js"

    # El tema SDDM se instala desde el bloque siguiente. Este paquete no
    # contiene una segunda copia del greeter.

    # BookOS SDDM theme — staged under /usr/share/bookos-settings/sddm-theme.
    # install_sddm_theme() (Settings app) copies it to /usr/share/sddm/themes/bookos
    # the first time the user enables the SDDM theme toggle.
    # Mismo motivo: el tema SDDM crecio a varios QML (UserAvatar, Fingerprint,
    # GreeterWidgets, WxIcon) mas backgrounds/, y la lista fija de tres
    # ficheros dejaba fuera todo lo nuevo.
    install -dm755 "$pkgdir/usr/share/bookos-settings/sddm-theme"
    cp -r "$_extra/sddm-theme/." "$pkgdir/usr/share/bookos-settings/sddm-theme/"
    find "$pkgdir/usr/share/bookos-settings/sddm-theme" -type f -exec chmod 644 {} +
    # Icons subdir
    if [ -d "$_extra/sddm-theme/icons" ]; then
        find "$_extra/sddm-theme/icons" -type f | while read -r f; do
            rel="${f#$_extra/sddm-theme/}"
            install -Dm644 "$f" "$pkgdir/usr/share/bookos-settings/sddm-theme/$rel"
        done
    fi

    # AI battery prediction (Python venv installed by .install hook)
    local _ai="${_extra}/ai"
    install -Dm755 "$_ai/train.py"   "$pkgdir/opt/bookos-ai/train.py"
    install -Dm755 "$_ai/predict.py" "$pkgdir/opt/bookos-ai/predict.py"
    install -Dm755 "$_ai/setup.sh"   "$pkgdir/opt/bookos-ai/setup.sh"
    install -Dm644 "$_ai/bookos-battery-train.service" \
        "$pkgdir/usr/lib/systemd/system/bookos-battery-train.service"
    install -Dm644 "$_ai/bookos-battery-train.timer" \
        "$pkgdir/usr/lib/systemd/system/bookos-battery-train.timer"

}
