#!/usr/bin/env bash
# Instala el servicio de Book Share para todos los usuarios de BookOS.
# Compila antes: cargo build --release (en src-tauri/bookshare).
set -eu
if [ "$(id -u)" -ne 0 ]; then
    echo "Hace falta root: sudo $0" >&2
    exit 1
fi
aqui="$(cd "$(dirname "$0")" && pwd)"
binario="$aqui/../target/release/bookos-bookshare"
# Solo release: el de depuración, sin optimizar, cifra cada trozo a una
# fracción de la velocidad.
if [ ! -x "$binario" ]; then
    echo "Compila primero: (cd $aqui/.. && cargo build --release)" >&2
    exit 1
fi
install -Dm755 "$binario" /usr/local/libexec/bookos-bookshare
temporal="$(mktemp)"
sed 's|/usr/libexec/bookos-bookshare|/usr/local/libexec/bookos-bookshare|' "$aqui/bookos-bookshare.service" > "$temporal"
install -Dm644 "$temporal" /usr/local/lib/systemd/user/bookos-bookshare.service
sed 's|/usr/libexec/bookos-bookshare|/usr/local/libexec/bookos-bookshare|' "$aqui/org.bookos.BookShare.service" > "$temporal"
install -Dm644 "$temporal" /usr/local/share/dbus-1/services/org.bookos.BookShare.service
rm -f -- "$temporal"
systemctl --global enable bookos-bookshare.service
echo "Instalado. En tu sesión: systemctl --user daemon-reload && systemctl --user start bookos-bookshare"
