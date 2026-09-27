// Compiles src/main.ts into a standalone binary and code-signs it.
import { $ } from "bun";
import { LABEL } from "./src/config.ts";

const outfile = "dist/photo-library-backup";
const staging = `${outfile}.new`;

// No .env autoloading: that reads the current directory's .env (/ under launchd), whereas
// configureEnvironment() loads the repository's.
await $`bun build ./src/main.ts --compile --no-compile-autoload-dotenv --outfile ${staging}`;

// macOS privacy permissions (such as Removable Volumes) attach to the code signature. Signing
// with a real certificate and a fixed identifier keeps them across rebuilds; an ad-hoc
// signature changes every build and the permission would need granting again.
const identity = process.env.CODESIGN_IDENTITY ?? (await developmentIdentity());
await $`codesign --force --timestamp=none --sign ${identity} --identifier ${LABEL} ${staging}`;

// Swap in atomically, so a backup that's running keeps its (still validly signed) binary.
await $`mv -f ${staging} ${outfile}`;
console.log(`Built and signed ${outfile}`);

async function developmentIdentity(): Promise<string> {
  const identities = await $`security find-identity -v -p codesigning`.text();
  const hash = identities.match(/\b([0-9A-F]{40}) "Apple Development: /)?.[1];
  if (hash) return hash;
  console.warn("No Apple Development identity found, so signing ad hoc; permissions will need re-granting after each build.");
  return "-";
}
