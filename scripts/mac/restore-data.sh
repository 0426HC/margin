#!/bin/bash
# Put a data backup back in place: .mac-app/bin/restore-data.sh .data-backup-2026-11-16-103000
# Nothing is deleted: your current .data is first renamed to .data-before-restore-<date>, then the backup is copied to .data.
# It stops the background service while it swaps the folders, and starts it again after.
. "$(dirname "$0")/lib.sh"

[ $# -eq 1 ] || { say "Usage: restore-data.sh <backup folder name>"; say "Backups:"; ls -1d "$MARGIN_HOME"/.data-backup-* 2>/dev/null | xargs -n1 basename; exit 1; }
src="$MARGIN_HOME/$(basename "$1")"
[ -f "$src/margin.db" ] || die "$(basename "$1") isn't a Margin data backup (no margin.db in it)."

printf 'Replace .data with %s? Your current .data is kept as .data-before-restore-<date>. Type yes: ' "$(basename "$src")"
read -r answer
[ "$answer" = "yes" ] || die "nothing changed."

was_loaded=0
if service_loaded; then was_loaded=1; launchctl bootout "gui/$(id -u)/$LABEL"; fi
aside="$MARGIN_HOME/.data-before-restore-$(date +%Y-%m-%d-%H%M%S)"
mv "$DATA" "$aside"
cp -cR "$src" "$DATA"
if [ $was_loaded -eq 1 ]; then launchctl bootstrap "gui/$(id -u)" "$INSTALLED_PLIST"; fi
say "Restored $(basename "$src"). Your previous data is in $(basename "$aside")."
