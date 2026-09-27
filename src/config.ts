import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { BackupError } from "./shared.ts";

// Settings that differ per Mac (see .env.example). The compiled binary runs from dist/,
// and `bun src/main.ts` from src/, so either way the repository root is one level up.
export const ENV_FILE = join(basename(process.execPath) === "bun" ? import.meta.dir : dirname(process.execPath), "..", ".env");

// Quit Photos while the backup runs (and reopen it afterwards) so the library
// database isn't being edited mid-snapshot.
export const QUIT_PHOTOS = true;

// Retention: the latest snapshot of each of the last 7 days that have one, of the last
// 8 weeks and of the last 12 months. On a weekly schedule the dailies add nothing.
export const KEEP_DAILY = 7;
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

/** Loads .env, and sets up the environment restic (and the rclone it starts) runs with. */
export function configureEnvironment(): void {
  // Variables already set in the environment take precedence over the file.
  try {
    process.loadEnvFile(ENV_FILE);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
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

/** When launchd runs the backup, from BACKUP_SCHEDULE (cron syntax, local time). */
export function backupSchedule(): string {
  return process.env.BACKUP_SCHEDULE?.trim() || "0 3 * * 0";
}

/** The Photos library to back up, from PHOTOS_LIBRARY. */
export function libraryPath(): string {
  const library = process.env.PHOTOS_LIBRARY;
  if (!library) throw new BackupError(`Set PHOTOS_LIBRARY in ${ENV_FILE} (copy .env.example to start).`);
  return library.replace(/^~(?=\/)/, homedir());
}
