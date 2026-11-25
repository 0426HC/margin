# Shared settings for the Mac app scripts (see docs/mac-app.md). Sourced by the other scripts, never run on its own.
# Works from scripts/mac (the source) and from .mac-app/bin (the copy the background service and the Dock app use),
# because both sit two folders below the project.
# Written for macOS's own /bin/bash 3.2.

set -euo pipefail

MARGIN_HOME="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
APP="$MARGIN_HOME/.mac-app"          # everything the Mac app makes lives here (git-ignored)
DATA="$MARGIN_HOME/.data"            # your real data: read by the app, copied by backups, never changed by these scripts
LABEL="com.margin.server"            # the background service's name in launchd
PLIST_NAME="$LABEL.plist"
INSTALLED_PLIST="$HOME/Library/LaunchAgents/$PLIST_NAME"   # where you copy it (step 2 in docs/mac-app.md); only read here
BRANCH="public"                      # updates are built from this branch
KEEP_RELEASES=3                      # current, previous, and one more
LOG="$APP/logs"

# Absolute paths recorded by setup.sh: the background service starts with an almost empty PATH, so nothing is looked up.
if [ -f "$APP/env.sh" ]; then
  # shellcheck source=/dev/null
  . "$APP/env.sh"
  export PATH="$(dirname "$NODE_BIN"):$(dirname "$CLAUDE_BIN"):/usr/bin:/bin:/usr/sbin:/sbin"
fi

URL() { echo "http://localhost:${PORT}"; }

say() { printf '%s\n' "$*"; }
die() { printf 'Margin: %s\n' "$*" >&2; exit 1; }

# Is the background service loaded in launchd?
service_loaded() { launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; }

# Restart the background service so it serves .mac-app/current. Returns 1 when it isn't installed yet.
restart_service() {
  if service_loaded; then
    launchctl kickstart -k "gui/$(id -u)/$LABEL"
  else
    return 1
  fi
}

# Wait up to $1 seconds for Margin to answer on its port. Uses Node's fetch, so it works without curl.
wait_healthy() {
  local secs="${1:-60}"
  "$NODE_BIN" -e '
    const url = process.argv[1], until = Date.now() + Number(process.argv[2]) * 1000;
    (async () => {
      while (Date.now() < until) {
        try { const r = await fetch(url, { signal: AbortSignal.timeout(3000) }); if (r.ok) process.exit(0); } catch {}
        await new Promise((r) => setTimeout(r, 1000));
      }
      process.exit(1);
    })();' "$(URL)/" "$secs"
}

# Switch .mac-app/current to the release folder $1 in one step (a symlink swap), remembering the old one as .mac-app/previous.
switch_to() {
  local target="$1" old=""
  [ -L "$APP/current" ] && old="$(readlink "$APP/current")"
  ln -sfn "$target" "$APP/current.tmp" && mv -fh "$APP/current.tmp" "$APP/current"
  if [ -n "$old" ] && [ "$old" != "$target" ]; then
    ln -sfn "$old" "$APP/previous.tmp" && mv -fh "$APP/previous.tmp" "$APP/previous"
  fi
}

notify() { /usr/bin/osascript -e "display notification \"$1\" with title \"Margin\"" >/dev/null 2>&1 || true; }
