#!/bin/bash
# Run any restic command against the backup repository, e.g.
#   ./restic.sh snapshots
#   ./restic.sh restore latest --target ~/Desktop/photos-restore
set -euo pipefail

source "$(dirname "$0")/config.sh"
exec restic "$@"
