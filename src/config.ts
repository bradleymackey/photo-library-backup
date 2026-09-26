import { homedir } from "node:os";
import { join } from "node:path";

export const LIBRARY = "/Volumes/BANK-1/Media/Library.photoslibrary";

// Quit Photos while the backup runs (and reopen it afterwards) so the library
// database isn't being edited mid-snapshot.
export const QUIT_PHOTOS = true;

// Retention: with weekly runs this keeps ~2 months of weeklies plus a year of monthlies.
export const KEEP_WEEKLY = 8;
export const KEEP_MONTHLY = 12;

// Also the code-signing identifier, which is what macOS privacy permissions attach to.
export const LABEL = "local.photo-library-backup";
export const RCLONE_REMOTE = "gdrive-photos";
export const KEYCHAIN_SERVICE = "photo-library-backup";
export const KEYCHAIN_ACCOUNT = "restic";
export const STATE_DIR = join(homedir(), "Library/Application Support/photo-library-backup");
export const LOG_FILE = join(homedir(), "Library/Logs/photo-library-backup.log");
export const LAUNCH_AGENT = join(homedir(), "Library/LaunchAgents", `${LABEL}.plist`);

/** Sets up the environment restic (and the rclone it starts) runs with. */
export function configureEnvironment(): void {
  Object.assign(process.env, {
    // launchd jobs get a bare PATH; restic and rclone come from Homebrew.
    PATH: `/opt/homebrew/bin:${process.env.PATH ?? "/usr/bin:/bin:/usr/sbin:/sbin"}`,
    RESTIC_REPOSITORY: `rclone:${RCLONE_REMOTE}:photo-library-backup`,
    RESTIC_PASSWORD_COMMAND: `/usr/bin/security find-generic-password -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT} -w`,
    // Fixed so snapshots stay grouped (and incremental) even if the Mac is renamed.
    RESTIC_HOST: "photo-library",
    // Bigger packs mean fewer files on Drive; photos rarely change once written.
    RESTIC_PACK_SIZE: "64",
  });
}
