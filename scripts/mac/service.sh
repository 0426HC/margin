#!/bin/bash
# Start, stop, restart or check the background service:
#   .mac-app/bin/service.sh start | stop | restart | status
# "stop" lasts until you start it again or log in next time (it starts at login while the service file is installed).
. "$(dirname "$0")/lib.sh"

uid="$(id -u)"
case "${1:-status}" in
  start)
    [ -f "$INSTALLED_PLIST" ] || die "the service file isn't installed (docs/mac-app.md, step 2)."
    if service_loaded; then launchctl kickstart "gui/$uid/$LABEL"; else launchctl bootstrap "gui/$uid" "$INSTALLED_PLIST"; fi
    wait_healthy 60 && say "Margin is running on $(URL)." || die "it didn't answer within a minute. See .mac-app/logs/server.log."
    ;;
  stop)
    if service_loaded; then launchctl bootout "gui/$uid/$LABEL" && say "Stopped. It starts again at your next login, or with: service.sh start"; else say "It isn't running."; fi
    ;;
  restart)
    restart_service || die "the service isn't loaded; use: service.sh start"
    wait_healthy 60 && say "Restarted on $(URL)." || die "it didn't answer within a minute. See .mac-app/logs/server.log."
    ;;
  status)
    if service_loaded; then say "Service: loaded"; else say "Service: not loaded"; fi
    if wait_healthy 2; then say "Answering: yes, on $(URL)"; else say "Answering: no"; fi
    [ -L "$APP/current" ] && say "Current build: $(basename "$(readlink "$APP/current")")"
    [ -L "$APP/previous" ] && say "Previous build (rollback.sh goes here): $(basename "$(readlink "$APP/previous")")"
    last="$(ls -1d "$MARGIN_HOME"/.data-backup-* 2>/dev/null | tail -n 1 || true)"
    [ -n "$last" ] && say "Newest data backup: $(basename "$last")"
    say "Logs: $LOG/server.log"
    ;;
  *) die "use start, stop, restart or status." ;;
esac
