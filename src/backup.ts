import { $ } from "bun";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { KEEP_MONTHLY, KEEP_WEEKLY, LIBRARY, LOG_FILE, QUIT_PHOTOS, STATE_DIR } from "./config.ts";
import { BackupError, log, notify, restic } from "./shared.ts";

/**
 * Backs up the library, applies the retention policy, and once a month reads
 * back part of the stored data. Throws BackupError for anything worth a notification,
 * and returns warnings for a run that finished but needs attention.
 */
export async function backup(): Promise<string[]> {
  const warnings: string[] = [];
  log(`Starting backup of ${LIBRARY}`);
  checkLibraryReadable();
  await checkRepository();

  // Keep the Mac awake until we exit (unref'd so it doesn't hold us open).
  Bun.spawn(["caffeinate", "-is", "-w", String(process.pid)]).unref();

  const photosWasOpen = QUIT_PHOTOS && (await quitPhotos());
  let status: number;
  try {
    log("Backing up");
    // restic is silent without a terminal, so have it log progress every minute.
    status = await restic(["backup", LIBRARY], { RESTIC_PROGRESS_FPS: String(1 / 60) });
  } finally {
    if (photosWasOpen) {
      log("Reopening Photos");
      await $`open -g -a Photos`.quiet().nothrow();
    }
  }
  if (status === 3) {
    const warning = "Backup finished, but some files couldn't be read, so this snapshot is incomplete.";
    log(`WARNING: ${warning}`);
    await notify(`${warning} See ${LOG_FILE}`);
    warnings.push(warning);
  } else if (status !== 0) {
    throw new BackupError(`restic backup failed (exit ${status}). See ${LOG_FILE}`);
  }

  log(`Applying retention: keep ${KEEP_WEEKLY} weekly and ${KEEP_MONTHLY} monthly snapshots`);
  await resticOrThrow(["forget", "--keep-weekly", String(KEEP_WEEKLY), "--keep-monthly", String(KEEP_MONTHLY), "--prune"]);

  await monthlyCheck();
  log("Done");
  return warnings;
}

function checkLibraryReadable(): void {
  try {
    readdirSync(join(LIBRARY, "database"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new BackupError(`Photos library not found at ${LIBRARY}. Is BANK-1 mounted?`);
    }
    if (code === "EPERM") {
      throw new BackupError(
        "macOS blocked access to the Photos library. Turn on Removable Volumes for photo-library-backup in System Settings → Privacy & Security → Files & Folders.",
      );
    }
    throw error;
  }
}

/** Fails before touching Photos if Drive, the password or the repository can't be reached. */
async function checkRepository(): Promise<void> {
  const result = await $`restic cat config`.quiet().nothrow();
  if (result.exitCode !== 0) {
    log(result.stderr.toString().trim());
    throw new BackupError(`Can't open the backup repository (restic exit ${result.exitCode}). See ${LOG_FILE}`);
  }
}

async function isPhotosRunning(): Promise<boolean> {
  return (await $`pgrep -xq Photos`.nothrow()).exitCode === 0;
}

/** Quits Photos if it's open, returning whether it was. */
async function quitPhotos(): Promise<boolean> {
  if (!(await isPhotosRunning())) return false;
  log("Quitting Photos");
  const result = await $`osascript -e 'tell application "Photos" to quit'`.quiet().nothrow();
  if (result.exitCode !== 0) {
    log(`WARNING: couldn't quit Photos, so backing up with it open: ${result.stderr.toString().trim()}`);
    return false;
  }
  for (let second = 0; second < 60 && (await isPhotosRunning()); second++) {
    await Bun.sleep(1000);
  }
  return true;
}

/** Reads back a different twelfth of the stored data each month, so all of it gets verified over a year. */
async function monthlyCheck(): Promise<void> {
  const stateFile = Bun.file(join(STATE_DIR, "last-check"));
  const now = new Date();
  const month = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if ((await stateFile.exists()) && (await stateFile.text()).trim() === month) return;

  const subset = `${now.getMonth() + 1}/12`;
  log(`Monthly integrity check (data subset ${subset})`);
  await resticOrThrow(["check", `--read-data-subset=${subset}`]);
  await Bun.write(stateFile, month);
}

async function resticOrThrow(args: string[]): Promise<void> {
  const status = await restic(args);
  if (status !== 0) {
    throw new BackupError(`restic ${args[0]} failed (exit ${status}). See ${LOG_FILE}`);
  }
}
