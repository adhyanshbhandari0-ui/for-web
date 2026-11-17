import type { DoseRow } from "./console";
import { MAX_DOSES_PER_DRUG } from "@dib/data-client";

export type ParsedPrescription =
  | { ok: true; doses: DoseRow[]; tEndH: number }
  | { ok: false; error: string };

const WINDOWS = [12, 24, 48, 72];

/** Parse the entire script before changing any dose rows. */
export function parsePrescription(text: string): ParsedPrescription {
  const match = text.trim().match(/^(\d+(?:\.\d+)?|\.\d+)\s*(?:mg|milligrams?)\b\s*(.*)$/i);
  const amount = Number(match?.[1]);
  if (!match || !(amount > 0 && amount <= 10_000)) {
    return { ok: false, error: "Start with an amount greater than 0 and at most 10,000 mg." };
  }

  const schedule = match[2];
  let times = [0];
  if (/^at\b/i.test(schedule)) {
    const entries = schedule.replace(/^at\s+/i, "").split(/\s*,\s*(?:and\s+)?|\s+and\s+|\s+/i);
    if (!entries.every((entry) => /^(?:\d+(?:\.\d+)?|\.\d+)$/.test(entry))) {
      return { ok: false, error: "List the hours after “at”, for example “at 0, 6, 12”." };
    }
    times = entries.map(Number);
  } else if (schedule && !/^once$/i.test(schedule)) {
    const repeat = schedule.match(
      /^(?:every\s+|q\s*)(\d+(?:\.\d+)?|\.\d+)\s*(?:hours?|h)\s*(?:(?:[x×]\s*|for\s+)(\d+)(?:\s*doses?)?|(\d+)\s*doses?)$/i,
    );
    if (!repeat) {
      return { ok: false, error: "Use “once”, list the hours, or give the interval and number of doses." };
    }
    const interval = Number(repeat[1]);
    const count = Number(repeat[2] ?? repeat[3]);
    if (!Number.isFinite(interval) || interval <= 0 || count < 1 || count > MAX_DOSES_PER_DRUG) {
      return { ok: false, error: `Use a positive interval and 1 to ${MAX_DOSES_PER_DRUG} doses.` };
    }
    times = Array.from({ length: count }, (_, index) => Number((index * interval).toPrecision(15)));
  }

  if (times.length > MAX_DOSES_PER_DRUG) {
    return { ok: false, error: `Use at most ${MAX_DOSES_PER_DRUG} doses per schedule.` };
  }

  const tEndH = WINDOWS.find((window) => times.every((time) => time <= window));
  if (tEndH === undefined) {
    return { ok: false, error: "Every dose must fit within the 72-hour simulation window." };
  }
  return { ok: true, doses: times.map((timeH) => ({ timeH, doseMg: amount })), tEndH };
}
