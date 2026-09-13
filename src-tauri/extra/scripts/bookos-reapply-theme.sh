#!/bin/sh
# Refresh an installed BookOS SDDM theme after a package update.
set -e
SDDM_STAGE="/usr/share/bookos-settings/sddm-theme"
SDDM_DEST="/usr/share/sddm/themes/bookos"
# ── Tema de SDDM ─────────────────────────────────────────────────────────
# El tema activo se elige en /etc/sddm.conf o en CUALQUIER fichero de
# /etc/sddm.conf.d/ (Arch usa kde_settings.conf, no el nuestro), así que se
# miran todos, igual que hace is_sddm_theme_installed().
if [ -d "$SDDM_STAGE" ] && [ -d "$SDDM_DEST" ] &&
   grep -qs "Current=bookos" /etc/sddm.conf /etc/sddm.conf.d/* 2>/dev/null; then
    # `cp` y no `rsync --delete`: theme.conf.user (los ajustes del usuario) y
    # los fondos que haya importado viven en esta misma carpeta y no los trae
    # el paquete. Borrar lo que no está en el stage se los llevaría por delante.
    cp -r "$SDDM_STAGE/." "$SDDM_DEST/"
    find "$SDDM_DEST" -type f -exec chmod 644 {} +
fi

exit 0
