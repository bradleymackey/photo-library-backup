# Shared settings, sourced by backup.sh, setup.sh and restic.sh.

LIBRARY="/Volumes/BANK-1/Media/Library.photoslibrary"

# Quit Photos while the backup runs (and reopen it afterwards) so the library
# database isn't being edited mid-snapshot.
QUIT_PHOTOS=true

# Retention: with weekly runs this keeps ~2 months of weeklies plus a year of monthlies.
KEEP_WEEKLY=8
KEEP_MONTHLY=12

RCLONE_REMOTE="gdrive-photos"
KEYCHAIN_SERVICE="photo-library-backup"
LAUNCHD_LABEL="local.photo-library-backup"
STATE_DIR="$HOME/Library/Application Support/photo-library-backup"
LOG_FILE="$HOME/Library/Logs/photo-library-backup.log"

# launchd jobs get a bare PATH; restic needs to find rclone.
export PATH="/opt/homebrew/bin:$PATH"

export RESTIC_REPOSITORY="rclone:${RCLONE_REMOTE}:photo-library-backup"
export RESTIC_PASSWORD_COMMAND="/usr/bin/security find-generic-password -s ${KEYCHAIN_SERVICE} -a restic -w"
# Fixed so snapshots stay grouped (and incremental) even if the Mac is renamed.
export RESTIC_HOST="photo-library"
# Bigger packs mean fewer files on Drive; photos rarely change once written.
export RESTIC_PACK_SIZE=64
