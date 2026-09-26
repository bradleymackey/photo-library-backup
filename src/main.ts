import { backup } from "./backup.ts";
import { configureEnvironment } from "./config.ts";
import { setup } from "./setup.ts";
import { errorMessage, log, notify, restic } from "./shared.ts";

const USAGE = `Usage: photo-library-backup <command>

Commands:
  backup          Back up the Photos library now (what the weekly launchd job runs)
  setup           One-time setup: Google Drive remote, password, repository, schedule
  restic <args>   Run restic against the backup repository, e.g. "restic snapshots"`;

configureEnvironment();
const [command, ...args] = process.argv.slice(2);

switch (command) {
  case "backup":
    try {
      await backup();
    } catch (error) {
      log(`ERROR: ${errorMessage(error)}`);
      await notify(errorMessage(error));
      process.exit(1);
    }
    break;
  case "setup":
    try {
      await setup();
    } catch (error) {
      console.error(`\n${errorMessage(error)}`);
      process.exit(1);
    }
    break;
  case "restic":
    process.exit(await restic(args));
  case undefined:
  case "-h":
  case "--help":
    console.log(USAGE);
    break;
  default:
    console.error(USAGE);
    process.exit(1);
}
