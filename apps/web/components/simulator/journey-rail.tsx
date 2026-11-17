import type { PlaybackStage } from "./playback";

export const PREVIEW_STAGES = [
  "Swallow", "Absorption", "Portal circulation", "Right heart", "Lungs",
  "Left heart", "Distribution", "Liver clearance", "Kidneys",
];

export default function JourneyRail({ stages, index, onSelect, previewBrain = false }: {
  stages?: PlaybackStage[];
  previewBrain?: boolean;
  index?: number;
  onSelect?: (step: number) => void;
}) {
  const entries = stages?.slice(1).map(({ label }) => label) ?? PREVIEW_STAGES.map((label) => label === "Distribution" && previewBrain ? "Brain" : label);
  return (
    <nav className="journey-rail" aria-label="Dose journey">
      <h2 className="theatre-eyebrow">The journey</h2>
      <ol>
        {entries.map((label, i) => {
          const step = i + 1;
          const state = index === step ? "current" : index !== undefined && index > step ? "past" : "ahead";
          const marker = stages && step === stages.length - 1 ? "✓" : String(step).padStart(2, "0");
          const item = <><span className="journey-marker" aria-hidden="true">{marker}</span><span>{label}</span></>;
          return (
            <li key={label} data-state={state}>
              {onSelect ? (
                <button type="button" aria-current={state === "current" ? "step" : undefined} onClick={() => onSelect(step)}>{item}</button>
              ) : <span className="journey-preview-item">{item}</span>}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
