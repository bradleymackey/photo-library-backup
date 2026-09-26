#!/bin/bash
# One-time interactive setup: Google Drive remote, repository password, restic
# repository and the weekly launchd job. Safe to re-run; finished steps are skipped.
set -euo pipefail

cd "$(dirname "$0")"
source ./config.sh

step() { printf '\n==> %s\n' "$*"; }

step "Checking dependencies"
for tool in restic rclone; do
  command -v "$tool" >/dev/null || { echo "Missing $tool; run: brew install $tool"; exit 1; }
done
echo "OK"

step "Google Drive remote ($RCLONE_REMOTE)"
if rclone listremotes | grep -qx "${RCLONE_REMOTE}:"; then
  echo "Already configured."
else
  echo "Paste the Desktop OAuth client from Google Cloud (see README)."
  read -rp "Client ID: " client_id
  read -rsp "Client secret: " client_secret
  echo
  echo "A browser window will open. Sign in and allow access."
  # drive.file: rclone can only see files it created, not the rest of your Drive.
  # use_trash=false: pruned data is deleted outright instead of filling the Drive bin.
  rclone config create "$RCLONE_REMOTE" drive \
    client_id="$client_id" client_secret="$client_secret" \
    scope=drive.file use_trash=false >/dev/null
  echo "Configured."
fi

step "Repository password (Keychain item \"$KEYCHAIN_SERVICE\")"
if security find-generic-password -s "$KEYCHAIN_SERVICE" -a restic >/dev/null 2>&1; then
  echo "Already in Keychain."
else
  security add-generic-password -s "$KEYCHAIN_SERVICE" -a restic \
    -l "Photo library backup (restic)" -w "$(openssl rand -base64 32)"
  security find-generic-password -s "$KEYCHAIN_SERVICE" -a restic -w | tr -d '\n' | pbcopy
  echo "Generated a random password, stored it in your login Keychain and copied it to the clipboard."
  echo "Without it the backup can't be decrypted, so save it in your password manager now."
  read -rp "Press Enter once it's saved (this clears the clipboard). " _
  pbcopy </dev/null
fi

step "Restic repository ($RESTIC_REPOSITORY)"
rc=0
err=$(restic cat config 2>&1 >/dev/null) || rc=$?
case $rc in
  0) echo "Already initialised." ;;
  10) restic init ;;
  *) echo "$err"; echo "Couldn't open the repository (restic exit $rc)."; exit 1 ;;
esac

step "Weekly schedule (launchd job $LAUNCHD_LABEL)"
plist="$HOME/Library/LaunchAgents/$LAUNCHD_LABEL.plist"
mkdir -p "$(dirname "$plist")"
cat > "$plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LAUNCHD_LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/bash</string>
    <string>$PWD/backup.sh</string>
  </array>
  <!-- Sundays at 03:00. If the Mac is asleep then, it runs on the next wake. -->
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>0</integer>
    <key>Hour</key>
    <integer>3</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
</dict>
</plist>
EOF
launchctl bootout "gui/$UID/$LAUNCHD_LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$UID" "$plist"
echo "Installed $plist"

cat <<EOF

All set. Backups run every Sunday at 03:00; logs go to $LOG_FILE.
To start the first (long) backup right away:
  launchctl kickstart gui/$UID/$LAUNCHD_LABEL
  tail -f "$LOG_FILE"
EOF
