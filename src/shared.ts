import { $ } from "bun";

/** An expected failure, reported by its message alone. */
export class BackupError extends Error {}

export function log(message: string): void {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const time = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  console.log(`[${date} ${time}] ${message}`);
}

export async function notify(message: string): Promise<void> {
  await $`osascript -e 'on run argv' -e 'display notification (item 1 of argv) with title "Photo library backup"' -e 'end run' ${message}`
    .quiet()
    .nothrow();
}

/**
 * Runs restic attached to our stdio, so it gets the terminal (with its progress
 * bar) when run by hand and launchd's log file when scheduled. Returns the exit code.
 */
export async function restic(args: string[], env: Record<string, string> = {}): Promise<number> {
  const proc = Bun.spawn(["restic", ...args], {
    stdio: ["inherit", "inherit", "inherit"],
    env: { ...process.env, ...env },
  });
  return proc.exited;
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
