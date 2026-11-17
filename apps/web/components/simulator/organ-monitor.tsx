"use client";

import { useMemo } from "react";
import type { MedicationRun } from "@/lib/treatment";
import { readMoment } from "./playback";
import type { FocusOrgan } from "./scene";

const SIGNALS = {
  concentration: { key: "concMgPerL", unit: "mg/L" },
  gut: { key: "gutMg", unit: "mg" },
  elimination: { key: "eliminationMgPerH", unit: "mg/h" },
} as const;

type Signal = keyof typeof SIGNALS;

const ORGANS: { id: FocusOrgan; label: string; signal: Signal }[] = [
  { id: "gut", label: "Gut", signal: "gut" },
  { id: "heart", label: "Heart", signal: "concentration" },
  { id: "lungs", label: "Lungs", signal: "concentration" },
  { id: "brain", label: "Brain", signal: "concentration" },
  { id: "liver", label: "Liver", signal: "elimination" },
  { id: "kidneys", label: "Kidneys", signal: "elimination" },
];

const LABELS = {
  concentration: "Central concentration",
  gut: "Amount in the gut",
  elimination: "Total model elimination",
};

const WIDTH = 240;
const HEIGHT = 42;

function tracesFor(runs: MedicationRun[], signal: Signal, duration: number) {
  const { key } = SIGNALS[signal];
  const max = runs.reduce(
    (peak, { result }) => result[key].reduce((value, next) => Math.max(value, next), peak), 1e-9,
  );
  return runs.map(({ id, color, result }) => ({
    id,
    color,
    points: result.tH.map((time, i) =>
      `${(time / duration * WIDTH).toFixed(2)},${(HEIGHT - result[key][i] / max * HEIGHT).toFixed(2)}`
    ).join(" "),
  }));
}

export default function OrganMonitor({ runs, hours, focus, onSelect }: {
  runs: MedicationRun[];
  hours: number;
  focus: FocusOrgan | null;
  onSelect: (organ: FocusOrgan) => void;
}) {
  const duration = runs[0].result.tH.at(-1) || 1;
  const traces = useMemo(() => ({
    concentration: tracesFor(runs, "concentration", duration),
    gut: tracesFor(runs, "gut", duration),
    elimination: tracesFor(runs, "elimination", duration),
  }), [runs, duration]);
  const current = runs.map(({ id, name, color, result }) => ({
    id, name, color, moment: readMoment(result, hours),
  }));
  const x = Math.min(1, Math.max(0, hours / duration)) * WIDTH;

  return (
    <div className="mt-4">
      <p className="text-sm text-ink-2">
        Readings at {hours.toFixed(2)} h. The heart, lungs and brain share the central concentration.
        The liver and kidneys display the same total elimination rate.
      </p>
      <div className="theatre-monitor-grid mt-4">
        {ORGANS.map(({ id, label, signal }) => {
          const { key, unit } = SIGNALS[signal];
          return (
            <article key={id} className="rounded-xl border border-line p-3">
              <button type="button" className="theatre-button" aria-pressed={focus === id} onClick={() => onSelect(id)}>
                Inspect {label.toLowerCase()}
              </button>
              <p className="mb-2 mt-3 text-xs text-ink-2">{LABELS[signal]}</p>
              <svg className="h-12 w-full border-b border-line" viewBox={`0 -1 ${WIDTH} ${HEIGHT + 2}`}
                preserveAspectRatio="none" role="img" aria-label={`${LABELS[signal]} over time`}>
                {traces[signal].map(({ id: medicineId, color, points }) => (
                  <polyline key={medicineId} points={points} stroke={color} strokeWidth="1.5" fill="none" vectorEffect="non-scaling-stroke" />
                ))}
                <line x1={x} x2={x} y1={0} y2={HEIGHT} stroke="var(--theatre-amber)" vectorEffect="non-scaling-stroke" />
              </svg>
              <ul className="mt-2 space-y-1 text-xs">
                {current.map(({ id: medicineId, name, color, moment }) => (
                  <li key={medicineId} className="flex flex-wrap items-baseline justify-between gap-x-2">
                    <span><span style={{ backgroundColor: color }} className="mr-1 inline-block size-2 rounded-full" aria-hidden="true" />{name}</span>
                    <span className="font-mono">{moment[key].toFixed(signal === "concentration" ? 3 : 2)} {unit}</span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </div>
  );
}
