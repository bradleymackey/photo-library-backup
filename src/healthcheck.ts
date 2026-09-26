import { $ } from "bun";
import { HEALTHCHECK_ACCOUNT, KEYCHAIN_SERVICE } from "./config.ts";
import { errorMessage, log } from "./shared.ts";

let pingUrl: Promise<string | undefined> | undefined;

/**
 * Reports to healthchecks.io, if a ping URL is stored in Keychain. Retries for a
 * while (the network can still be coming up after a wake) and never throws, so
 * monitoring can't break the backup.
 */
export async function ping(kind: "start" | "success" | "fail", body = ""): Promise<void> {
  pingUrl ??= readPingUrl();
  const url = await pingUrl;
  if (!url) return;

  const endpoint = kind === "success" ? url : `${url}/${kind}`;
  let lastError = "";
  for (let attempt = 1; attempt <= 5; attempt++) {
    if (attempt > 1) await Bun.sleep((attempt - 1) * 2000);
    try {
      const response = await fetch(endpoint, { method: "POST", body, signal: AbortSignal.timeout(10_000) });
      if (response.ok) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = errorMessage(error);
    }
  }
  log(`WARNING: healthchecks.io ${kind} ping failed: ${lastError}`);
}

async function readPingUrl(): Promise<string | undefined> {
  const result = await $`security find-generic-password -s ${KEYCHAIN_SERVICE} -a ${HEALTHCHECK_ACCOUNT} -w`.quiet().nothrow();
  return result.exitCode === 0 ? result.text().trim() : undefined;
}
