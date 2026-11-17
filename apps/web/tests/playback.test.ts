import { describe, expect, it } from "vitest";
import { simulate } from "@dib/engine";
import { exampleDrug } from "../lib/example-drug";
import { buildStages, playbackAt, progressAt, readMoment, stageMotion, TRAVEL_FRACTION } from "../components/simulator/playback";
import { conditionById } from "../components/simulator/condition";

describe("guided playback", () => {
  const scenario = conditionById("neuro");
  const result = {
    tH: [0, 2, 3, 5, 8, 24, 26, 48],
    concMgPerL: [0, 0, 4, 8, 6, 1, 10, 0.5],
    timeToClearH: 48,
  };

  it("visits the oral dose and first peak even if a repeat dose creates the global peak", () => {
    const stages = buildStages(result, [2, 24], scenario);
    expect(stages.find(({ organ }) => organ === "gut")?.hours).toBe(2);
    expect(stages.find(({ organ }) => organ === "brain")?.hours).toBe(5);
    expect(stages.at(-1)?.hours).toBe(48);
    expect(stages.map(({ hours }) => hours)).toEqual(stages.map(({ hours }) => hours).sort((a, b) => a - b));
    expect(playbackAt(stages, progressAt(stages, 25)).hours).toBeCloseTo(25);
  });

  it("takes oral doses through the portal and pulmonary circuits before distribution", () => {
    const stages = buildStages(result, [2, 24], scenario);
    expect(stages.flatMap((stage) => stage.route ? [stage.route] : [])).toEqual([
      "swallow", "absorption", "portal", "right-heart", "lungs", "left-heart", "brain", "liver", "kidneys",
    ]);
    expect(stages.find(({ route }) => route === "swallow")?.hours).toBe(2);
    expect(buildStages(result, [2], conditionById("general")).some(({ route }) => route === "lungs")).toBe(true);
  });

  it("holds the arrival time and marker through each reading pause", () => {
    const stages = buildStages(result, [2, 24], scenario);
    for (let index = 1; index < stages.length - 1; index++) {
      for (const fraction of [TRAVEL_FRACTION, 0.7, 0.99]) {
        expect(stageMotion(index + fraction)).toEqual({ fraction: 1, holding: true });
        expect(playbackAt(stages, index + fraction).hours).toBe(stages[index].hours);
      }
    }
    expect(stageMotion(3.1).fraction).toBeGreaterThan(0);
    expect(stageMotion(3.1).holding).toBe(false);
  });

  it("keeps seeking reversible and modeled time continuous across stops", () => {
    const stages = buildStages(result, [2, 24], scenario);
    for (const hours of [0, 0.1, 1.9, 2, 2.5, 4, 5, 10, 24, 47.9, 48]) {
      expect(playbackAt(stages, progressAt(stages, hours)).hours).toBeCloseTo(hours);
    }
    for (let index = 1; index < stages.length; index++) {
      expect(playbackAt(stages, index - 0.00001).hours).toBeCloseTo(playbackAt(stages, index).hours, 3);
    }
  });

  it("handles a dose on the final sample and still lets the viewer visit each stage", () => {
    const stages = buildStages({ ...result, concMgPerL: result.tH.map(() => 0) }, [48], scenario);
    expect(playbackAt(stages, 0)).toEqual({ index: 0, hours: 0 });
    expect(playbackAt(stages, 1)).toEqual({ index: 1, hours: 48 });
    expect(progressAt(stages, 48)).toBe(stages.length - 1);
    expect(playbackAt(stages, stages.length - 1).hours).toBe(48);
  });

  it("shows the full gut dose at its exact off-grid time", () => {
    const timeH = 0.17;
    const curve = simulate({
      profile: { ageYears: 30, weightKg: 70, sex: "other" },
      drug: exampleDrug,
      doses: [{ drugId: exampleDrug.id, doseMg: 100, timeH }],
      tEndH: 1,
      sampleAtH: [timeH],
    });
    expect(readMoment(curve, timeH - 0.001).gutMg).toBe(0);
    expect(readMoment(curve, timeH).gutMg).toBe(100);
  });
});
