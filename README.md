# photo-library-backup

Weekly, encrypted, versioned backup of the Photos library
(`/Volumes/BANK-1/Media/Library.photoslibrary`) to Google Drive.

- **restic** does the backup: data is encrypted on this Mac before upload, and only
  new or changed chunks are sent, so after the first run a week's backup is small.
- **rclone** is restic's transport to Google Drive, limited to the `drive.file`
  scope, so it can only see the files it created.
- **launchd** runs `backup.sh` every Sunday at 03:00 (or on the next wake).

Each run:

1. Quits Photos, if it's open.
2. Backs up the whole library bundle, then reopens Photos.
3. Prunes old snapshots, keeping 8 weekly and 12 monthly ones.
4. Once a month, downloads a different 1/12 of the stored data and checks it,
   so the whole backup gets verified over a year.

If a run fails or is skipped, you get a macOS notification. Everything is logged
to `~/Library/Logs/photo-library-backup.log`.

## Files

| File | Purpose |
| --- | --- |
| `config.sh` | Paths, retention, names. Everything else sources it. |
| `backup.sh` | The weekly job. |
| `setup.sh` | One-time interactive setup (safe to re-run). |
| `restic.sh` | Runs any restic command against the repo, e.g. `./restic.sh snapshots`. |

## Setup

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

### 2. Run setup

In Terminal:

```sh
./setup.sh
```

This:

- Creates the `gdrive-photos` rclone remote (a browser opens for Google sign-in).
- Generates the repository password, stores it in your login Keychain, and has you
  save a copy in your password manager. **Without the password the backup can't be
  decrypted.**
- Initialises the restic repository (the `photo-library-backup` folder in My Drive).
- Installs the launchd job.

### 3. Grant Full Disk Access to bash

macOS won't let a background job read files on the external drive. launchd starts
the job as `/bin/bash`, and the only way to give bash access is Full Disk Access:

**System Settings → Privacy & Security → Full Disk Access → +**, press
<kbd>⌘⇧G</kbd>, enter `/bin/bash`, and turn it on.

This applies to bash when it's started directly by launchd or cron. Scripts you
run in Terminal already get Terminal's own permissions.

The first time a run finds Photos open, macOS will ask whether bash may control
Photos. Allow it. If it's refused, the backup still runs with Photos open.

### 4. Run the first backup

```sh
launchctl kickstart gui/$UID/local.photo-library-backup
tail -f ~/Library/Logs/photo-library-backup.log
```

The first run uploads the whole library (~210 GB), so it takes hours; progress is
logged every minute. Leave Photos closed until it finishes, and keep BANK-1
connected. The script keeps the Mac awake while it runs.

## Day to day

```sh
./restic.sh snapshots                  # list backups
./restic.sh stats latest               # size of the latest snapshot
launchctl kickstart gui/$UID/local.photo-library-backup   # back up now
```

## Restoring

```sh
./restic.sh snapshots
./restic.sh restore latest --target ~/Desktop/photos-restore
```

The library is restored under its original path inside the target
(`~/Desktop/photos-restore/Volumes/BANK-1/Media/Library.photoslibrary`).
Open it by holding <kbd>⌥</kbd> while launching Photos and choosing that library.
If Photos reports problems, hold <kbd>⌥⌘</kbd> while launching it to repair
the library.

To restore an older version, use a snapshot ID from `snapshots` instead of `latest`.

### On a new Mac

1. `brew install restic rclone` and clone or copy this repo.
2. Put the repository password from your password manager into Keychain, so
   `setup.sh` doesn't generate a new one:

   ```sh
   security add-generic-password -s photo-library-backup -a restic -w '<password>'
   ```

3. Run `./setup.sh` and give it the **same** OAuth client ID and secret. It will
   find the existing repository rather than creating a new one.

## Notes

- **Consistency:** quitting Photos stops edits while the backup runs. Background
  iCloud sync can still touch the library, though, so a snapshot isn't guaranteed
  to be perfectly consistent. The snapshot history and Photos' repair tool are the
  safety net.
- **Pruning:** pruned data is deleted outright rather than sent to the Drive bin
  (`use_trash=false`), so it doesn't sit there using quota.
- **Password:** to see the repository password again, run
  `security find-generic-password -s photo-library-backup -a restic -w`.
- **Uninstall:**

  ```sh
  launchctl bootout gui/$UID/local.photo-library-backup
  rm ~/Library/LaunchAgents/local.photo-library-backup.plist
  ```
