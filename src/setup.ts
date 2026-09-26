import { $ } from "bun";
import { basename } from "node:path";
import { userInfo } from "node:os";
import { HEALTHCHECK_ACCOUNT, KEYCHAIN_ACCOUNT, KEYCHAIN_SERVICE, LABEL, LAUNCH_AGENT, LOG_FILE, RCLONE_REMOTE } from "./config.ts";
import { BackupError, restic } from "./shared.ts";

/** One-time interactive setup. Safe to re-run; finished steps are skipped. */
export async function setup(): Promise<void> {
  if (basename(process.execPath) === "bun") {
    throw new BackupError("Run setup from the built binary (bun run build, then dist/photo-library-backup setup), so launchd runs that binary.");
  }

  step("Checking dependencies");
  for (const tool of ["restic", "rclone"]) {
    if (!Bun.which(tool)) throw new BackupError(`Missing ${tool}; run: brew install ${tool}`);
  }
  console.log("OK");

  step(`Google Drive remote (${RCLONE_REMOTE})`);
  const remotes = (await $`rclone listremotes`.text()).split("\n");
  if (remotes.includes(`${RCLONE_REMOTE}:`)) {
    console.log("Already configured.");
  } else {
    console.log("Press Enter to use rclone's built-in Google client, or paste your own client ID (see README).");
    const clientId = ask("Client ID:", { optional: true });
    const client = clientId ? [`client_id=${clientId}`, `client_secret=${ask("Client secret:", { hidden: true })}`] : [];
    console.log("A browser window will open. Sign in and allow access.");
    // drive.file: rclone can only see files it created, not the rest of your Drive.
    // use_trash=false: pruned data is deleted outright instead of filling the Drive bin.
    const rclone = Bun.spawn(
      ["rclone", "config", "create", RCLONE_REMOTE, "drive", ...client, "scope=drive.file", "use_trash=false"],
      // stdout is the finished config (including the token); stderr has the sign-in instructions.
      { stdio: ["inherit", "ignore", "inherit"] },
    );
    if ((await rclone.exited) !== 0) throw new BackupError("rclone couldn't create the Google Drive remote.");
    console.log("Configured.");
  }

  step(`Repository password (Keychain item "${KEYCHAIN_SERVICE}")`);
  if (await inKeychain(KEYCHAIN_ACCOUNT)) {
    console.log("Already in Keychain.");
  } else {
    const password = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString("base64");
    await $`security add-generic-password -s ${KEYCHAIN_SERVICE} -a ${KEYCHAIN_ACCOUNT} -l ${"Photo library backup (restic)"} -w ${password}`.quiet();
    await $`pbcopy < ${new Response(password)}`;
    console.log("Generated a random password, stored it in your login Keychain and copied it to the clipboard.");
    console.log("Without it the backup can't be decrypted, so save it in your password manager now.");
    prompt("Press Enter once it's saved (this clears the clipboard).");
    await $`pbcopy < /dev/null`;
  }

  step("Healthchecks.io ping URL (optional)");
  if (await inKeychain(HEALTHCHECK_ACCOUNT)) {
    console.log("Already in Keychain.");
  } else {
    const url = ask("Ping URL (Enter to skip):", { optional: true });
    if (url) {
      await $`security add-generic-password -s ${KEYCHAIN_SERVICE} -a ${HEALTHCHECK_ACCOUNT} -l ${"Photo library backup (healthchecks.io)"} -w ${url}`.quiet();
      console.log("Saved to Keychain.");
    } else {
      console.log("Skipped.");
    }
  }

  step(`Restic repository (${process.env.RESTIC_REPOSITORY})`);
  const config = await $`restic cat config`.quiet().nothrow();
  if (config.exitCode === 0) {
    console.log("Already initialised.");
  } else if (config.exitCode === 10) {
    if ((await restic(["init"])) !== 0) throw new BackupError("restic init failed.");
  } else {
    console.error(config.stderr.toString().trim());
    throw new BackupError(`Couldn't open the repository (restic exit ${config.exitCode}).`);
  }

  step(`Weekly schedule (launchd job ${LABEL})`);
  await Bun.write(LAUNCH_AGENT, launchAgentPlist());
  const domain = `gui/${userInfo().uid}`;
  await $`launchctl bootout ${domain}/${LABEL}`.quiet().nothrow();
  await $`launchctl bootstrap ${domain} ${LAUNCH_AGENT}`;
  console.log(`Installed ${LAUNCH_AGENT}`);

  console.log(`
All set. Backups run every Sunday at 03:00; logs go to ${LOG_FILE}.

Start the first (long) backup now, while you're at the Mac:
  launchctl kickstart ${domain}/${LABEL}
  tail -f "${LOG_FILE}"

macOS will ask whether photo-library-backup may access files on a removable
volume, and later whether it may control Photos. Allow both.`);
}

async function inKeychain(account: string): Promise<boolean> {
  return (await $`security find-generic-password -s ${KEYCHAIN_SERVICE} -a ${account}`.quiet().nothrow()).exitCode === 0;
}

function step(title: string): void {
  console.log(`\n==> ${title}`);
}

function ask(question: string, { hidden = false, optional = false } = {}): string {
  if (hidden) Bun.spawnSync(["stty", "-echo"], { stdin: "inherit" });
  const answer = prompt(question)?.trim() ?? "";
  if (hidden) {
    Bun.spawnSync(["stty", "echo"], { stdin: "inherit" });
    console.log();
  }
  if (!answer && !optional) throw new BackupError("No answer given.");
  return answer;
}

function launchAgentPlist(): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LABEL}</string>
  <!-- Run the binary directly (not via a shell) so macOS privacy permissions apply to it alone. -->
  <key>ProgramArguments</key>
  <array>
    <string>${process.execPath}</string>
    <string>backup</string>
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
  <key>StandardOutPath</key>
  <string>${LOG_FILE}</string>
  <key>StandardErrorPath</key>
  <string>${LOG_FILE}</string>
</dict>
</plist>
`;
}
