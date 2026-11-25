#!/bin/bash
# Update Margin to the latest commit on the public branch, safely:
#   1. snapshot the branch into a new release folder and build it (the running app is untouched; a failed build changes nothing)
#   2. back up .data to .data-backup-<date> (a consistent copy of the database, taken while the app runs)
#   3. switch to the new build and restart the background service
#   4. check that it answers; if it doesn't, switch back to the previous build on its own
# Roll back by hand at any time with .mac-app/bin/rollback.sh. Details in docs/mac-app.md.
. "$(dirname "$0")/lib.sh"

[ -f "$APP/env.sh" ] || die "run scripts/mac/setup.sh first."
mkdir -p "$APP/releases" "$LOG"

# one update at a time
mkdir "$APP/update.lock" 2>/dev/null || die "an update is already running (or one was interrupted: remove .mac-app/update.lock)."
trap 'rmdir "$APP/update.lock" 2>/dev/null || true' EXIT

git -C "$MARGIN_HOME" rev-parse --verify --quiet "$BRANCH" >/dev/null || die "there is no '$BRANCH' branch."
sha="$(git -C "$MARGIN_HOME" rev-parse --short "$BRANCH")"
if [ -f "$APP/current/.margin-commit" ] && [ "$(cat "$APP/current/.margin-commit")" = "$sha" ] && [ "${1:-}" != "--force" ]; then
  say "Margin is already up to date ($BRANCH at $sha). Run with --force to rebuild anyway."
  exit 0
fi

name="$(date +%Y%m%d-%H%M%S)-$sha"
rel="$APP/releases/$name"
say "1/4 Building $BRANCH at $sha in .mac-app/releases/$name"
notify "Updating to $sha. Margin keeps running while it builds."
mkdir "$rel"
git -C "$MARGIN_HOME" archive "$BRANCH" | tar -x -C "$rel"
echo "$sha" > "$rel/.margin-commit"

# Dependencies: clone node_modules (APFS copy-on-write, instant, no extra disk) from a folder with the same lockfile, else install.
deps=""
for cand in "$APP/current" "$MARGIN_HOME"; do
  if [ -d "$cand/node_modules" ] && cmp -s "$cand/package-lock.json" "$rel/package-lock.json"; then deps="$cand"; break; fi
done
if [ -n "$deps" ]; then
  cp -cR "$deps/node_modules" "$rel/node_modules"
else
  say "    package-lock.json changed: installing dependencies"
  (cd "$rel" && npm ci --no-audit --no-fund) >> "$LOG/update.log" 2>&1 || { rm -rf "$rel"; die "installing dependencies failed; nothing changed. See .mac-app/logs/update.log."; }
fi

# The build never sees your data: it gets an empty folder of its own.
rm -rf "$APP/build-data" && mkdir -p "$APP/build-data"
if ! (cd "$rel" && NODE_ENV=production MARGIN_DATA_DIR="$APP/build-data" "$NODE_BIN" node_modules/next/dist/bin/next build) >> "$LOG/update.log" 2>&1; then
  rm -rf "$rel"
  notify "The update didn't build. Margin is unchanged."
  die "the build failed; Margin is unchanged. See .mac-app/logs/update.log."
fi

backup="$MARGIN_HOME/.data-backup-$(date +%Y-%m-%d-%H%M%S)"
say "2/4 Backing up .data to $(basename "$backup")"
# A copy-on-write clone of the whole folder (symlinks stay symlinks), then the database is replaced by SQLite's own
# online backup, so the copy is consistent even while the app is writing.
cp -cR "$DATA" "$backup"
rm -f "$backup/margin.db" "$backup/margin.db-wal" "$backup/margin.db-shm"
(cd "$rel" && "$NODE_BIN" -e '
  const Database = require("better-sqlite3");
  const db = new Database(process.argv[1], { readonly: true, fileMustExist: true });
  db.backup(process.argv[2]).then(() => db.close()).catch((e) => { console.error(e); process.exit(1); });' "$DATA/margin.db" "$backup/margin.db") \
  || die "backing up the database failed; Margin is unchanged (the new build is in .mac-app/releases/$name)."

say "3/4 Switching to the new build and restarting"
switch_to "$rel"
if ! restart_service; then
  say "    The background service isn't installed yet, so nothing was restarted (see docs/mac-app.md, step 2)."
  cp -f "$rel"/scripts/mac/*.sh "$APP/bin/"
  exit 0
fi

say "4/4 Checking that Margin answers on $(URL)"
if wait_healthy 60; then
  cp -f "$rel"/scripts/mac/*.sh "$APP/bin/"   # use this release's versions of these scripts from now on
  # keep the newest releases (current and previous among them), remove older build folders
  ls -1 "$APP/releases" | sort -r | tail -n +$((KEEP_RELEASES + 1)) | while read -r old; do
    case "$APP/releases/$old" in "$(readlink "$APP/current")"|"$(readlink "$APP/previous" 2>/dev/null)") ;; *) rm -rf "${APP:?}/releases/$old" ;; esac
  done
  say "Done: Margin is running $sha. Your data was backed up to $(basename "$backup")."
  notify "Updated to $sha."
else
  say "    The new build didn't answer within a minute: switching back."
  prev="$(readlink "$APP/previous" 2>/dev/null || true)"
  if [ -n "$prev" ]; then
    switch_to "$prev"
    restart_service || true
    notify "The update didn't start, so Margin went back to the previous build."
    die "the new build failed to start; Margin is back on $(basename "$prev"). See .mac-app/logs/server.log."
  fi
  die "the new build failed to start and there is no previous build. See .mac-app/logs/server.log."
fi
