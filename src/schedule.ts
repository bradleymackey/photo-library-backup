import { BackupError } from "./shared.ts";

// cron's five fields, in order, as launchd calendar keys with their allowed values.
const FIELDS = [
  { key: "Minute", min: 0, max: 59 },
  { key: "Hour", min: 0, max: 23 },
  { key: "Day", min: 1, max: 31 },
  { key: "Month", min: 1, max: 12 },
  { key: "Weekday", min: 0, max: 7 }, // 0 and 7 are both Sunday
];
type Field = (typeof FIELDS)[number];

/**
 * Converts a cron expression ("minute hour day month weekday", numbers only) into the
 * value of launchd's StartCalendarInterval key: an array with one entry per combination
 * of the listed values. A * field is left out, which launchd treats as "any".
 */
export function calendarIntervals(cron: string): string {
  const parts = cron.trim().split(/\s+/);
  if (parts.length !== 5) throw invalid(cron, "it needs five fields: minute hour day month weekday");
  // With both set, cron runs when either matches (or both, depending on how they're
  // written). launchd and healthchecks.io have to agree on the schedule, so allow one.
  if (parts[2] !== "*" && parts[4] !== "*") throw invalid(cron, "set the day of the month or the weekday, not both");

  let entries: [string, number][][] = [[]];
  parts.forEach((part, i) => {
    const field = FIELDS[i]!;
    if (part === "*") return;
    const values = parseField(part, field, cron);
    entries = entries.flatMap((entry) => values.map((value): [string, number][] => [...entry, [field.key, value]]));
  });
  const dicts = entries.map((entry) =>
    ["    <dict>", ...entry.flatMap(([key, value]) => [`      <key>${key}</key>`, `      <integer>${value}</integer>`]), "    </dict>"].join("\n"),
  );
  return ["<array>", ...dicts, "  </array>"].join("\n");
}

/** Expands a field's numbers, ranges (1-5), lists (1,3) and steps (0-30/10) into its values. */
function parseField(part: string, field: Field, cron: string): number[] {
  const values = new Set<number>();
  for (const item of part.split(",")) {
    const match = /^(?:\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item);
    if (!match) throw invalid(cron, `"${item}" isn't a number, range or step (names like SUN aren't supported)`);
    const [, from, to, step] = match;
    const start = from === undefined ? field.min : Number(from);
    const end = to !== undefined ? Number(to) : from === undefined || step !== undefined ? field.max : start;
    const by = step === undefined ? 1 : Number(step);
    if (start < field.min || end > field.max || start > end || by < 1) {
      throw invalid(cron, `"${item}" is out of range for ${field.key.toLowerCase()} (${field.min}-${field.max})`);
    }
    for (let value = start; value <= end; value += by) values.add(field.key === "Weekday" ? value % 7 : value);
  }
  return [...values].sort((a, b) => a - b);
}

function invalid(cron: string, reason: string): BackupError {
  return new BackupError(`BACKUP_SCHEDULE "${cron}" isn't valid: ${reason}.`);
}
