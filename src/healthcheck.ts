import { errorMessage, log } from "./shared.ts";

/**
 * Reports to healthchecks.io, if HEALTHCHECK_URL is set. Retries for a while (the
 * network can still be coming up after a wake) and never throws, so monitoring
 * can't break the backup.
 */
export async function ping(kind: "start" | "success" | "fail", body = ""): Promise<void> {
  const url = process.env.HEALTHCHECK_URL?.replace(/\/+$/, "");
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
