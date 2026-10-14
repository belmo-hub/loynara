#!/usr/bin/env bash
# Installs, removes or shows the scheduled ticket loop on macOS (a user launch agent; no admin rights needed).
#   scripts/ticket-loop-install.sh install [interval-minutes]   default 30
#   scripts/ticket-loop-install.sh uninstall
#   scripts/ticket-loop-install.sh status
# The loop itself decides whether it may run (night window, daily limit, pause file), so a short interval is safe.
# The Mac must be awake. The cycle holds the machine awake while it works.
set -euo pipefail

label="com.loynara.ticket-loop"
plist="$HOME/Library/LaunchAgents/$label.plist"
repo="$(git -C "$(dirname "$0")" rev-parse --show-toplevel)"
runs="${RUNS_DIR:-$HOME/Developer/Loynara-runs}"
domain="gui/$(id -u)"

case "${1:-}" in
  install)
    minutes="${2:-30}"
    [[ "$minutes" =~ ^[0-9]+$ ]] && [ "$minutes" -ge 5 ] || { echo "interval must be a number of minutes, 5 or more" >&2; exit 2; }
    mkdir -p "$runs/logs" "$HOME/Library/LaunchAgents"
    cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$label</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/caffeinate</string><string>-i</string>
    <string>/usr/bin/env</string><string>python3</string>
    <string>$repo/scripts/ticket-cycle.py</string><string>run</string>
  </array>
  <key>WorkingDirectory</key><string>$repo</string>
  <key>StartInterval</key><integer>$((minutes * 60))</integer>
  <key>RunAtLoad</key><false/>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>$HOME/.local/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key><string>$runs/logs/loop.out</string>
  <key>StandardErrorPath</key><string>$runs/logs/loop.out</string>
</dict>
</plist>
EOF
    launchctl bootout "$domain/$label" 2>/dev/null || true
    launchctl bootstrap "$domain" "$plist"
    echo "installed: runs every $minutes minutes (inside the configured night window). Log: $runs/logs/loop.out"
    ;;
  uninstall)
    launchctl bootout "$domain/$label" 2>/dev/null || true
    rm -f "$plist"
    echo "removed"
    ;;
  status)
    if launchctl print "$domain/$label" >/dev/null 2>&1; then echo "installed and loaded"; else echo "not loaded"; fi
    [ -e "$runs/PAUSE" ] && echo "PAUSED (remove with: scripts/ticket-cycle.py resume)" || echo "not paused"
    ;;
  *)
    echo "usage: $0 install [minutes] | uninstall | status" >&2
    exit 2
    ;;
esac
