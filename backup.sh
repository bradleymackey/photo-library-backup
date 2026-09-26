#!/bin/bash
# Back up the Photos library to Google Drive with restic (encrypted, deduplicated),
# apply the retention policy, and once a month read back part of the stored data.
# Scheduled weekly by launchd (see setup.sh); fine to run by hand as well.
set -euo pipefail

cd "$(dirname "$0")"
source ./config.sh

mkdir -p "$STATE_DIR" "$(dirname "$LOG_FILE")"
exec > >(tee -a "$LOG_FILE") 2>&1

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"; }
notify() { osascript -e "display notification \"$1\" with title \"Photo library backup\"" >/dev/null 2>&1 || true; }

notified=false
fail() {
  log "ERROR: $*"
  notify "$*"
  notified=true
  exit 1
}

photos_was_running=false
reopen_photos() {
  if [[ "$photos_was_running" == true ]]; then
    log "Reopening Photos"
    open -g -a Photos || true
    photos_was_running=false
  fi
}

on_exit() {
  local status=$?
  reopen_photos
  if (( status != 0 )) && [[ "$notified" == false ]]; then
    log "ERROR: exited with status $status"
    notify "Backup failed (exit $status). See $LOG_FILE"
  fi
}
trap on_exit EXIT

log "Starting backup of $LIBRARY"

[[ -d "$LIBRARY" ]] || fail "Photos library not found at $LIBRARY. Is BANK-1 mounted?"
ls "$LIBRARY/database" >/dev/null 2>&1 ||
  fail "Can't read the Photos library. Grant Full Disk Access to /bin/bash (see README)."

# Keep the Mac awake until this script exits.
caffeinate -is -w $$ &

if [[ "$QUIT_PHOTOS" == true ]] && pgrep -xq Photos; then
  log "Quitting Photos"
  if osascript -e 'tell application "Photos" to quit' >/dev/null 2>&1; then
    photos_was_running=true
    for _ in {1..60}; do pgrep -xq Photos || break; sleep 1; done
  else
    log "WARNING: couldn't quit Photos; backing up with it open"
  fi
fi

log "Backing up"
rc=0
# Print a progress line every minute (restic is silent when not attached to a terminal).
RESTIC_PROGRESS_FPS=0.0167 restic backup "$LIBRARY" || rc=$?
reopen_photos
case $rc in
  0) ;;
  3) log "WARNING: some files couldn't be read; this snapshot is incomplete"
     notify "Backup finished, but some files couldn't be read. See $LOG_FILE" ;;
  *) fail "restic backup failed (exit $rc). See $LOG_FILE" ;;
esac

log "Applying retention: keep $KEEP_WEEKLY weekly and $KEEP_MONTHLY monthly snapshots"
restic forget --keep-weekly "$KEEP_WEEKLY" --keep-monthly "$KEEP_MONTHLY" --prune

# Read back a different twelfth of the stored data each month, so all of it
# gets verified over the course of a year.
month=$(date +%Y-%m)
if [[ "$(cat "$STATE_DIR/last-check" 2>/dev/null)" != "$month" ]]; then
  subset="$((10#$(date +%m)))/12"
  log "Monthly integrity check (data subset $subset)"
  restic check --read-data-subset="$subset"
  echo "$month" > "$STATE_DIR/last-check"
fi

log "Done"
