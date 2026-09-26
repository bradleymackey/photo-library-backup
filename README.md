# photo-library-backup

Weekly, encrypted, versioned backup of the Photos library
(`/Volumes/BANK-1/Media/Library.photoslibrary`) to Google Drive.

- **restic** does the backup: data is encrypted on this Mac before upload, and only
  new or changed chunks are sent, so after the first run a week's backup is small.
- **rclone** is restic's transport to Google Drive, limited to the `drive.file`
  scope, so it can only see the files it created.
- **launchd** runs the backup every Sunday at 03:00 (or on the next wake).

Each run:

1. Checks the library is readable and the backup repository reachable.
2. Quits Photos, if it's open.
3. Backs up the whole library bundle, then reopens Photos.
4. Prunes old snapshots, keeping 8 weekly and 12 monthly ones.
5. Once a month, downloads a different 1/12 of the stored data and checks it,
   so the whole backup gets verified over a year.

If a run fails or is skipped, you get a macOS notification. Everything is logged
to `~/Library/Logs/photo-library-backup.log`.

## Why a compiled binary

When launchd starts a job, macOS applies privacy permissions to the program launchd
runs, and every process it starts inherits them. A shell script would run as
`/bin/bash`, and macOS never asks before denying its own built-in binaries such as
bash. The only fix would be Full Disk Access for bash, which then covers any script
launchd or cron starts.

Instead, the TypeScript source in `src/` is compiled with `bun build --compile` into
`dist/photo-library-backup`, and signed with your Apple Development certificate under
a fixed identifier (`local.photo-library-backup`). macOS asks about that one binary,
it only needs **Removable Volumes** access, and because the signature's identity
doesn't change, the permission survives rebuilds.

## Layout

| Path | Purpose |
| --- | --- |
| `src/config.ts` | Library path, retention, names, restic environment. |
| `src/backup.ts` | The weekly job. |
| `src/setup.ts` | One-time interactive setup (safe to re-run). |
| `src/main.ts` | Command-line entry point: `backup`, `setup`, `restic <args>`. |
| `build.ts` | Compiles and signs `dist/photo-library-backup`. |

```sh
bun install
bun run typecheck
bun run build        # after any change; the launchd job runs dist/photo-library-backup
```

## Setup

Install the tools first: `brew install restic rclone`.

### 1. Create a Google OAuth client

rclone's built-in client ID is shared by every rclone user and heavily
rate-limited, so create your own at <https://console.cloud.google.com>:

1. Create a project (e.g. `photo-library-backup`).
2. **APIs & Services → Library**: enable the **Google Drive API**.
3. **Google Auth Platform** (OAuth consent screen): set it up as an **External**
   app, with any name and your email.
4. **Audience**: click **Publish app** so the status is **In production**.
   **Don't skip this.** While the app is in *Testing*, Google expires its login after 7
   days and the backups start failing. The app only asks for `drive.file`, which
   doesn't need Google's verification.
5. **Clients → Create client → Desktop app**. Keep the client ID and secret.

Save the client ID and secret in your password manager. You need the *same* client
to get back into the backup later, because `drive.file` access is tied to the
client that created the files. Don't delete this Google Cloud project.

### 2. Build and run setup

In Terminal:

```sh
bun install && bun run build
dist/photo-library-backup setup
```

This:

- Creates the `gdrive-photos` rclone remote (a browser opens for Google sign-in).
- Generates the repository password, stores it in your login Keychain, and has you
  save a copy in your password manager. **Without the password the backup can't be
  decrypted.**
- Initialises the restic repository (the `photo-library-backup` folder in My Drive).
- Installs the launchd job.

### 3. Run the first backup, and allow access

Do this while you're at the Mac:

```sh
launchctl kickstart gui/$UID/local.photo-library-backup
tail -f ~/Library/Logs/photo-library-backup.log
```

macOS will ask:

- whether **photo-library-backup** may access files on a removable volume. Allow it.
  The backup waits until you answer.
- whether it may control **Photos**, the first time a run finds Photos open. Allow it.
  If it's refused, the backup still runs, with Photos left open.

If you denied one by mistake, you can turn it back on in **System Settings → Privacy &
Security → Files & Folders** (or **Automation**) under photo-library-backup.

The first run uploads the whole library (~210 GB), so it takes hours; progress is
logged every minute. Leave Photos closed until it finishes, and keep BANK-1
connected. The backup keeps the Mac awake while it runs.

## Day to day

```sh
dist/photo-library-backup restic snapshots        # list backups
dist/photo-library-backup restic stats latest     # size of the latest snapshot
launchctl kickstart gui/$UID/local.photo-library-backup   # back up now
```

Running `dist/photo-library-backup backup` directly in Terminal also works, and shows
restic's live progress bar. In that case it runs with Terminal's permissions and logs
to the terminal instead of the log file.

## Restoring

```sh
dist/photo-library-backup restic snapshots
dist/photo-library-backup restic restore latest --target ~/Desktop/photos-restore
```

The library is restored under its original path inside the target
(`~/Desktop/photos-restore/Volumes/BANK-1/Media/Library.photoslibrary`).
Open it by holding <kbd>⌥</kbd> while launching Photos and choosing that library.
If Photos reports problems, hold <kbd>⌥⌘</kbd> while launching it to repair
the library.

To restore an older version, use a snapshot ID from `snapshots` instead of `latest`.

### On a new Mac

1. `brew install restic rclone`, copy this repo, then `bun install && bun run build`.
2. Put the repository password from your password manager into Keychain, so setup
   doesn't generate a new one:

   ```sh
   security add-generic-password -s photo-library-backup -a restic -w '<password>'
   ```

3. Run `dist/photo-library-backup setup` and give it the **same** OAuth client ID
   and secret. It will find the existing repository rather than creating a new one.

## Notes

- **Consistency:** quitting Photos stops edits while the backup runs. Background
  iCloud sync can still touch the library, though, so a snapshot isn't guaranteed
  to be perfectly consistent. The snapshot history and Photos' repair tool are the
  safety net.
- **Pruning:** pruned data is deleted outright rather than sent to the Drive bin
  (`use_trash=false`), so it doesn't sit there using quota.
- **Password:** to see the repository password again, run
  `security find-generic-password -s photo-library-backup -a restic -w`.
- **Signing:** `bun run build` picks your Apple Development identity automatically.
  To use a different one, set `CODESIGN_IDENTITY`.
- **Uninstall:**

  ```sh
  launchctl bootout gui/$UID/local.photo-library-backup
  rm ~/Library/LaunchAgents/local.photo-library-backup.plist
  ```
