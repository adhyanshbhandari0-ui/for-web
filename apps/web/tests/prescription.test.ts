import { describe, expect, it } from "vitest";

import { parsePrescription } from "../components/simulator/prescription";

describe("parsePrescription", () => {
  it("parses amount, interval and count", () => {
    const parsed = parsePrescription("200 mg every 8 h for 3 doses");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doses).toEqual([
      { timeH: 0, doseMg: 200 },
      { timeH: 8, doseMg: 200 },
      { timeH: 16, doseMg: 200 },
    ]);
    // The smallest window that covers the last dose.
    expect(parsed.tEndH).toBe(24);
  });

  it("parses the q8h shorthand with an x count", () => {
    const parsed = parsePrescription("250 mg q8h x3");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doses).toHaveLength(3);
    expect(parsed.doses[2]).toEqual({ timeH: 16, doseMg: 250 });
  });

  it("parses explicit times", () => {
    const parsed = parsePrescription("100 mg at 0, 6, 12");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doses).toEqual([
      { timeH: 0, doseMg: 100 },
      { timeH: 6, doseMg: 100 },
      { timeH: 12, doseMg: 100 },
    ]);
    expect(parsed.tEndH).toBe(12);
  });

  it("parses a single once dose", () => {
    const parsed = parsePrescription("500 mg once");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doses).toEqual([{ timeH: 0, doseMg: 500 }]);
    expect(parsed.tEndH).toBe(12);
  });

  it("treats a bare amount as one dose at time zero", () => {
    const parsed = parsePrescription("500 mg");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doses).toEqual([{ timeH: 0, doseMg: 500 }]);
  });

  it("widens the window to cover the schedule", () => {
    const parsed = parsePrescription("100 mg every 24 h for 3 doses");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doses[parsed.doses.length - 1].timeH).toBe(48);
    expect(parsed.tEndH).toBe(48);
  });

  it("rejects text without an amount, saying what is missing", () => {
    const parsed = parsePrescription("every 8 hours");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/mg/);
  });

  it("rejects an interval with no count", () => {
    const parsed = parsePrescription("200 mg every 8 h");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error).toMatch(/doses/i);
  });

  it("rejects empty text", () => {
    const parsed = parsePrescription("   ");
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.error.length).toBeGreaterThan(0);
  });

  it.each([
    "-100 mg once", "100 mg q0h x3", "100 mg q8h x2.5",
    "100 mg at 0, 6,", "100 mg at 0, -6", "100 mg at 0, 80",
    "100 mg every 48 h for 3 doses", "100 mg every 8 h until Friday",
    "100 mg once with food", "10001 mg once",
  ])("rejects the unsupported schedule %s without loading a partial one", (script) => {
    expect(parsePrescription(script).ok).toBe(false);
  });

  it("preserves fractional times and coincident doses", () => {
    expect(parsePrescription("12.5 mg q0.15h x3")).toMatchObject({
      doses: [{ timeH: 0 }, { timeH: 0.15 }, { timeH: 0.3 }],
    });
    expect(parsePrescription("12.5 mg at 0.25, 0.25 and 1")).toMatchObject({
      doses: [{ timeH: 0.25 }, { timeH: 0.25 }, { timeH: 1 }],
    });
  });

  it("keeps the honesty rule: it only places amounts at times", () => {
    // Whatever is written, the parser must not invent drug properties.
    const parsed = parsePrescription("50 mg every 4 h for 6 doses");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.doses.every((row) => row.doseMg === 50)).toBe(true);
    expect(parsed.doses.map((row) => row.timeH)).toEqual([0, 4, 8, 12, 16, 20]);
  });
});
