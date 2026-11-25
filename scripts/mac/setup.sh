#!/bin/bash
# One-time setup of Margin as a Mac app. Writes only inside the project, in .mac-app/ (git-ignored):
#   env.sh                  absolute paths to node and claude, and the port
#   bin/                    copies of these scripts (so switching git branches never breaks the running app)
#   com.margin.server.plist the background service, for you to copy into ~/Library/LaunchAgents
#   Margin.app              the Dock icon: opens Margin in its own window
#   Update Margin.app       one click: back up, rebuild from public, restart (rollback.sh undoes it)
#   releases/, current      the first production build
# Run it from Terminal (so it finds node and claude on your PATH):  bash scripts/mac/setup.sh
# Then follow the numbered steps it prints (also in docs/mac-app.md).
set -euo pipefail
SRC="$(cd "$(dirname "$0")" && pwd)"
MARGIN_HOME="$(cd "$SRC/../.." && pwd)"
APP="$MARGIN_HOME/.mac-app"

node_bin="$(command -v node || true)"; [ -n "$node_bin" ] || { echo "Margin: node isn't on your PATH." >&2; exit 1; }
claude_bin="$(command -v claude || true)"; [ -n "$claude_bin" ] || { echo "Margin: the claude CLI isn't on your PATH." >&2; exit 1; }
[ -d "/Applications/Google Chrome.app" ] || echo "Note: Google Chrome isn't in /Applications; the Dock icon opens Margin in Chrome's app mode."

# The port: 3000 unless something else already listens there (a running `npm run dev`, say). Kept on re-runs.
port=""
[ -f "$APP/env.sh" ] && port="$(sed -n 's/^PORT=//p' "$APP/env.sh")"
if [ -z "$port" ]; then
  port=3000
  while /usr/sbin/lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; do port=$((port + 1)); done
fi

mkdir -p "$APP/bin" "$APP/logs" "$APP/releases"
cat > "$APP/env.sh" <<EOF
# Written by scripts/mac/setup.sh. Re-run setup after changing your Node version.
NODE_BIN="$node_bin"
CLAUDE_BIN="$claude_bin"
PORT=$port
EOF
cp -f "$SRC"/*.sh "$APP/bin/"
chmod +x "$APP/bin/"*.sh

# The background service: starts at login, restarts if it stops, logs to .mac-app/logs/server.log.
cat > "$APP/com.margin.server.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.margin.server</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$APP/bin/run-server.sh</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$MARGIN_HOME</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>ThrottleInterval</key>
  <integer>10</integer>
  <key>ProcessType</key>
  <string>Interactive</string>
  <key>StandardOutPath</key>
  <string>$APP/logs/server.log</string>
  <key>StandardErrorPath</key>
  <string>$APP/logs/server.log</string>
</dict>
</plist>
EOF
plutil -lint "$APP/com.margin.server.plist" >/dev/null

# A small app bundle whose executable is a shell script, with Margin's icon.
make_app() { # name, bundle id, script body
  local bundle="$APP/$1.app"
  rm -rf "$bundle"
  mkdir -p "$bundle/Contents/MacOS" "$bundle/Contents/Resources"
  cp "$SRC/Margin.icns" "$bundle/Contents/Resources/Margin.icns"
  cat > "$bundle/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleName</key><string>$1</string>
  <key>CFBundleDisplayName</key><string>$1</string>
  <key>CFBundleIdentifier</key><string>$2</string>
  <key>CFBundleExecutable</key><string>launch</string>
  <key>CFBundleIconFile</key><string>Margin</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
EOF
  printf '#!/bin/bash\n%s\n' "$3" > "$bundle/Contents/MacOS/launch"
  chmod +x "$bundle/Contents/MacOS/launch"
  plutil -lint "$bundle/Contents/Info.plist" >/dev/null
  codesign --force --sign - "$bundle" >/dev/null 2>&1 || true   # ad-hoc signature, so macOS treats it as one app
}

make_app "Margin" "com.margin.launcher" "exec /bin/bash \"$APP/bin/open.sh\""
make_app "Update Margin" "com.margin.updater" "if /bin/bash \"$APP/bin/update.sh\" >> \"$APP/logs/update.log\" 2>&1; then
  msg=\$(tail -n 1 \"$APP/logs/update.log\")
  /usr/bin/osascript -e \"display alert \\\"Margin is up to date\\\" message \\\"\$msg\\\"\" >/dev/null
else
  msg=\$(tail -n 3 \"$APP/logs/update.log\" | tr '\"' \"'\")
  /usr/bin/osascript -e \"display alert \\\"The update didn’t finish\\\" message \\\"\$msg\\n\\nFull log: $APP/logs/update.log\\\" as warning\" >/dev/null
fi"

# The first build, if there isn't one yet.
if [ ! -e "$APP/current" ]; then
  echo "Making the first production build (about a minute)..."
  /bin/bash "$APP/bin/update.sh"
fi

cat <<EOF

Margin is set up in $APP (port $port). Now, in Terminal:

  2. Install the background service (starts Margin now and at every login):
       cp "$APP/com.margin.server.plist" ~/Library/LaunchAgents/
       launchctl bootstrap gui/\$(id -u) ~/Library/LaunchAgents/com.margin.server.plist

  3. Check it:  "$APP/bin/service.sh" status

  4. Put the apps in Applications:
       cp -R "$APP/Margin.app" "$APP/Update Margin.app" /Applications/

  5. Open Applications in Finder and drag Margin onto your Dock.

All steps, and how to undo them: docs/mac-app.md
EOF
