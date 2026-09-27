# photo-library-backup

Weekly, encrypted, versioned backup of a macOS Photos library to Google Drive.

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

If a run fails or is skipped, you get a macOS notification, and if a
[healthchecks.io](#monitoring) ping URL is set up, the check goes down. Everything is
logged to `~/Library/Logs/photo-library-backup.log`.

## Why a compiled binary

When launchd starts a job, macOS applies privacy permissions to the program launchd
runs, and every process it starts inherits them. A shell script would run as
`/bin/bash`, and macOS never asks before denying its own built-in binaries such as
bash. The only fix would be Full Disk Access for bash, which then covers any script
launchd or cron starts.

Instead, the TypeScript source in `src/` is compiled with `bun build --compile` into
`dist/photo-library-backup`, and signed with your Apple Development certificate under
a fixed identifier (`local.photo-library-backup`). macOS asks about that one binary
(for a library on an external drive, it only needs **Removable Volumes** access), and
because the signature's identity doesn't change, the permission survives rebuilds.

## Layout

| Path | Purpose |
| --- | --- |
| `.env.example` | Per-Mac settings (library path, healthchecks.io URL); copy to `.env`. |
| `src/config.ts` | Retention, names, restic environment, loading `.env`. |
| `src/backup.ts` | The weekly job. |
| `src/healthcheck.ts` | healthchecks.io pings (start, success, fail). |
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

### 1. Settings

```sh
cp .env.example .env
```

Set `PHOTOS_LIBRARY` in `.env` to your library's path (Photos → Settings → General
shows it), and optionally `HEALTHCHECK_URL` (see [Monitoring](#monitoring)). `.env` is
gitignored. Every run reads it, so later changes apply from the next backup without
rebuilding.

### 2. Build and run setup

In Terminal:

```sh
bun install && bun run build
dist/photo-library-backup setup
```

This:

- Checks the settings in `.env`.
- Creates the `gdrive-photos` rclone remote. When it asks for a client ID, press
  Enter to use rclone's built-in Google client (or see
  [your own OAuth client](#using-your-own-google-oauth-client-optional)). A browser
  then opens for Google sign-in.
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

- whether **photo-library-backup** may access files on a removable volume, if the
  library is on an external drive. Allow it. The backup waits until you answer.
- whether it may control **Photos**, the first time a run finds Photos open. Allow it.
  If it's refused, the backup still runs, with Photos left open.

If you denied one by mistake, you can turn it back on in **System Settings → Privacy &
Security → Files & Folders** (or **Automation**) under photo-library-backup.

The first run uploads the whole library, so it can take hours; progress is logged
every minute. Leave Photos closed until it finishes, and keep the library's drive
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

## Monitoring

macOS notifications only help if the Mac is on and you're looking at it. A
[healthchecks.io](https://healthchecks.io) check also catches the silent failures,
such as the Mac being off or asleep for a week, or the job no longer running.

Each backup run pings the check's URL:

- `/start` when it begins. Healthchecks then records how long the run takes, and
  flags a run that never finishes.
- the plain URL on success.
- `/fail` if the run fails, with the error in the ping body. A run where some files
  couldn't be read also counts as a failure.

A ping that can't get through is retried for about 20 seconds, then logged as a
warning. It never fails the backup.

Recommended check settings: a **Cron** check with schedule `0 3 * * 0`, your Mac's
time zone and **grace 6 hours**. A cron check always expects a ping around Sunday
03:00, however late the last run was or whether you ran one by hand. A normal weekly
run finishes within minutes, and the monthly check adds roughly 10.

If the Mac is *shut down* at 03:00, launchd skips that week's run. It catches up
after sleep, but not after a shutdown. The check going down is your cue to run
`launchctl kickstart gui/$UID/local.photo-library-backup`. If the Mac sleeps at
night, raise the grace to a day, or wake it for the backup with
`sudo pmset repeat wakeorpoweron U 02:55:00`.

Put the check's ping URL in `.env` as `HEALTHCHECK_URL`. That keeps it out of git,
which matters because anyone with the URL can send pings. Leave it empty to turn
pinging off.

## Restoring

```sh
dist/photo-library-backup restic snapshots
dist/photo-library-backup restic restore latest --target ~/Desktop/photos-restore
```

The library is restored under its original path inside the target (for example
`~/Desktop/photos-restore/Volumes/External/Photos Library.photoslibrary`).
Open it by holding <kbd>⌥</kbd> while launching Photos and choosing that library.
If Photos reports problems, hold <kbd>⌥⌘</kbd> while launching it to repair
the library.

To restore an older version, use a snapshot ID from `snapshots` instead of `latest`.

### On a new Mac

1. `brew install restic rclone`, copy this repo, set up `.env` (see
   [Settings](#1-settings)), then `bun install && bun run build`.
2. Put the repository password from your password manager into Keychain, so setup
   doesn't generate a new one:

   ```sh
   security add-generic-password -s photo-library-backup -a restic -w '<password>'
   ```

3. Run `dist/photo-library-backup setup` and sign in with the same Google client as
   before: press Enter for rclone's built-in one, or give it your own client ID and
   secret if you set one up. It will find the existing repository rather than
   creating a new one.

## Notes

- **Consistency:** quitting Photos stops edits while the backup runs. Background
  iCloud sync can still touch the library, though, so a snapshot isn't guaranteed
  to be perfectly consistent. The snapshot history and Photos' repair tool are the
  safety net.
- **Pruning:** pruned data is deleted outright rather than sent to the Drive bin
  (`use_trash=false`), so it doesn't sit there using quota.
- **Password:** to see the repository password again, run
  `security find-generic-password -s photo-library-backup -a restic -w`.
- **Drive access:** with the `drive.file` scope, rclone can only see files created
  through the same Google client. The backup is tied to whichever client you used
  at setup. If rclone's built-in client ever stopped working, set up your own
  client (below) with `scope=drive` (full Drive access). That can see every file,
  including the existing backup.
- **Signing:** `bun run build` picks your Apple Development identity automatically.
  To use a different one, set `CODESIGN_IDENTITY`.
- **Uninstall:**

  ```sh
  launchctl bootout gui/$UID/local.photo-library-backup
  rm ~/Library/LaunchAgents/local.photo-library-backup.plist
  ```

## Using your own Google OAuth client (optional)

rclone's built-in client is shared by every rclone user, so heavy use can hit
Google's rate limits. This backup uploads a few large files a week, so it's
unlikely to matter. If you do want your own client, decide before running setup:
switching later means the new client can't see the existing backup (see Notes).

Check the project picker at the top of each page shows your project.

1. [Create a project](https://console.cloud.google.com/projectcreate) (e.g.
   `photo-library-backup`).
2. [Enable the Google Drive API](https://console.cloud.google.com/apis/library/drive.googleapis.com).
3. [Google Auth Platform](https://console.cloud.google.com/auth/overview) → **Get
   started**. Give it any app name and your email, choose **External** as the
   audience, add your email as the contact, agree to the terms and **Create**.
4. [Audience](https://console.cloud.google.com/auth/audience) → **Publish app**, so
   the status reads **In production**. While it's in *Testing*, Google expires the
   login after 7 days and backups start failing. `drive.file` doesn't need Google's
   verification, so publishing is instant.
5. [Clients](https://console.cloud.google.com/auth/clients) → **Create client** →
   application type **Desktop app** → **Create**. Copy the client ID and secret
   (or download the JSON) straight away; Google may not show the secret again.

Paste them when setup asks for a client ID, and save both in your password manager.
Restoring later needs the same client, so don't delete the project.
