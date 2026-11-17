import type { SimResult } from "@dib/engine";
import { momentAt, type Condition } from "./condition";
import type { FocusOrgan } from "./scene";

export const ROUTE_COPY = {
  swallow: "The oral dose travels down the esophagus into the stomach.",
  absorption: "The dose reaches the small intestine, where dissolved drug can enter the blood.",
  portal: "The hepatic portal vein carries absorbed drug from the intestine to the liver for a first pass.",
  "right-heart": "Blood leaving the liver returns through the vena cava to the right side of the heart.",
  lungs: "The right heart pumps blood through the pulmonary arteries into both lungs.",
  "left-heart": "The pulmonary veins return blood from the lungs to the left side of the heart.",
  brain: "The left heart pumps blood out through the aorta. One branch supplies the brain.",
  body: "The left heart pumps blood through the aorta and its branches to tissues around the body.",
  liver: "Blood also supplies the liver through the hepatic artery. The liver metabolizes some medicines.",
  kidneys: "Renal arteries carry blood to the kidneys. Some drugs and metabolites leave the body in urine.",
} as const;

export type DoseRoute = keyof typeof ROUTE_COPY;
export type PlaybackStage = { label: string; organ: FocusOrgan | null; hours: number; route?: DoseRoute };

export const TRAVEL_MS = 3200;
export const HOLD_MS = 4000;
export const STAGE_MS = TRAVEL_MS + HOLD_MS;
export const TRAVEL_FRACTION = TRAVEL_MS / STAGE_MS;

export function stageMotion(progress: number) {
  const fraction = progress - Math.floor(progress);
  const holding = fraction + 1e-9 >= TRAVEL_FRACTION;
  const travel = holding ? 1 : fraction / TRAVEL_FRACTION;
  return {
    // Ease the marker into and out of each stop with zero endpoint velocity.
    fraction: travel * travel * (3 - 2 * travel),
    holding,
  };
}

export function buildStages(
  result: Pick<SimResult, "tH" | "concMgPerL" | "timeToClearH">,
  doseHours: number[],
  condition: Condition,
): PlaybackStage[] {
  const end = result.tH.at(-1) ?? 0;
  const [first = 0, ...later] = [...new Set(doseHours.filter((time) => time >= 0 && time <= end))]
    .sort((a, b) => a - b);
  const nextDose = later[0] ?? Infinity;
  // Anchor the first close-ups to the first dose. A later dose can create
  // the run's highest concentration, so the graph retains the global peak.
  let firstPeak = first;
  let peak = 0;
  for (let i = 0; i < result.tH.length; i += 1) {
    const time = result.tH[i];
    if (time < first || time >= nextDose) continue;
    if (result.concMgPerL[i] > peak) {
      peak = result.concMgPerL[i];
      firstPeak = time;
    }
  }
  const tail = Math.max(firstPeak, Math.min(end, result.timeToClearH ?? end));
  const rise = firstPeak - first;
  const brain = condition.organs.includes("brain");
  return [
    { label: "Overview", organ: null, hours: 0 },
    { label: "Swallow", organ: null, route: "swallow", hours: first },
    { label: "Absorption", organ: "gut", route: "absorption", hours: first },
    { label: "Portal circulation", organ: "liver", route: "portal", hours: first + rise * 0.22 },
    { label: "Right heart", organ: "heart", route: "right-heart", hours: first + rise * 0.38 },
    { label: "Lungs", organ: "lungs", route: "lungs", hours: first + rise * 0.52 },
    { label: "Left heart", organ: "heart", route: "left-heart", hours: first + rise * 0.68 },
    { label: brain ? "Brain" : "Distribution", organ: brain ? "brain" : null, route: brain ? "brain" : "body", hours: firstPeak },
    { label: "Liver clearance", organ: "liver", route: "liver", hours: firstPeak + (tail - firstPeak) * 0.16 },
    { label: "Kidneys", organ: "kidneys", route: "kidneys", hours: end },
    { label: "Complete", organ: null, hours: end },
  ];
}

export function playbackAt(stages: PlaybackStage[], progress: number): { index: number; hours: number } {
  const index = Math.min(Math.max(0, Math.floor(progress)), Math.max(0, stages.length - 1));
  // Advance to a late first dose during the overview, before the capsule appears.
  if (index === 0) return { index, hours: (stages[1]?.hours ?? 0) * progress };
  const end = stages[index]?.hours ?? 0;
  const start = index === 1 ? end : stages[index - 1].hours;
  const travel = stageMotion(progress).holding ? 1 : (progress - index) / TRAVEL_FRACTION;
  return { index, hours: start + (end - start) * travel };
}

export function progressAt(stages: PlaybackStage[], hours: number): number {
  if (hours <= 0) return 0;
  const next = stages.findIndex((stage) => stage.hours >= hours);
  if (next < 0) return stages.length - 1;
  if (hours >= (stages.at(-1)?.hours ?? 0)) return stages.length - 1;
  if (next === 1) return hours / stages[1].hours;
  const start = stages[next - 1].hours;
  return next + TRAVEL_FRACTION * (hours - start) / (stages[next].hours - start);
}

export function readMoment(result: SimResult, hours: number) {
  return momentAt(result.tH, result.gutMg, result.bodyMg, result.concMgPerL, result.eliminationMgPerH, hours);
}
