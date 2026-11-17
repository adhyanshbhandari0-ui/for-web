import type { SimResult } from "@dib/engine";
import type { MedicationRun } from "@/lib/treatment";
import type { StudyCase } from "@/lib/study-cases";
import type { SimulatorInput } from "./console";
import type { PlaybackStage } from "./playback";

export type ReportData = {
  runs: MedicationRun[];
  primaryRun: MedicationRun;
  active: SimulatorInput;
  stages: PlaybackStage[];
  study?: StudyCase;
  isExample: boolean;
  treatmentLabel: string;
};

export function reportMetrics(result: SimResult) {
  return [
    { label: "Peak concentration", value: `${result.cmaxMgPerL.toFixed(3)} mg/L` },
    { label: "Time of peak", value: `${result.tmaxH.toFixed(2)} h` },
    { label: "Stays below 5% of peak", value: result.timeToClearH == null ? "Beyond run window" : `${result.timeToClearH.toFixed(2)} h` },
  ];
}

export function chartData(runs: MedicationRun[]) {
  const duration = runs[0]?.result.tH.at(-1) || 1;
  const max = Math.max(0, ...runs.map(({ result }) => result.cmaxMgPerL)) || 1;
  return {
    duration,
    max,
    series: runs.map(({ id, name, color, result }) => ({
      id, name, color,
      points: result.tH.map((time, i) => [time / duration, 1 - result.concMgPerL[i] / max] as const),
    })),
  };
}

export function parameterRows({ active, study }: Pick<ReportData, "active" | "study">) {
  const format = (value: number | null, unit = "") => value == null ? "Unavailable" : `${Number(value.toPrecision(6))}${unit}`;
  return active.drugs.map(({ drug, doses, citations }) => ({
    id: drug.id,
    citations,
    name: drug.name,
    doses: [...doses].sort((a, b) => a.timeH - b.timeH).map(({ doseMg, timeH }) => `${doseMg} mg at ${timeH} h`),
    parameters: [
      { label: "Absorption rate (ka)", value: format(drug.ka_per_h, " /h") },
      { label: "Oral bioavailability (F)", value: format(drug.F == null ? null : 100 * drug.F, "%") },
      { label: "Volume (V)", value: format(drug.V_L_per_kg == null ? null : drug.V_L_per_kg * active.weightKg, " L") },
      { label: "Clearance (CL)", value: format(drug.CL_L_per_h_per_kg == null ? null : drug.CL_L_per_h_per_kg * active.weightKg, " L/h") },
      ...(drug.tlag_h ? [{ label: "Absorption lag", value: format(drug.tlag_h, " h") }] : []),
    ],
    notes: drug.notes,
    references: study?.references ?? drug.sources
      .filter((url) => /^https?:\/\//i.test(url))
      .map((url, index) => ({ label: `Source ${index + 1}`, url })),
  }));
}
