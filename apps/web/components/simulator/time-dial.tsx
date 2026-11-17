"use client";

import { Pause, Play, RotateCcw } from "lucide-react";

export type TimeDialProps = {
  maxH: number;
  hours: number;
  onHours: (hours: number) => void;
  onTogglePlay: () => void;
  playLabel: "Play" | "Pause" | "Resume" | "Replay";
  tmaxH?: number | null;
};

const GUTTER = 14;

export default function TimeDial({ maxH, hours, onHours, onTogglePlay, playLabel, tmaxH }: TimeDialProps) {
  const clamp = (value: number) => Math.min(maxH, Math.max(0, value));
  const current = clamp(hours);
  const fraction = maxH > 0 ? current / maxH : 0;
  const PlayIcon = playLabel === "Pause" ? Pause : playLabel === "Replay" ? RotateCcw : Play;

  function seekPointer(event: React.PointerEvent<HTMLDivElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const usable = Math.max(1, rect.width - 2 - GUTTER * 2);
    onHours(clamp((event.clientX - rect.left - 1 - GUTTER) / usable * maxH));
  }

  function endDrag(event: React.PointerEvent<HTMLDivElement>) {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    const step = maxH > 48 ? 1 : maxH > 12 ? 0.5 : 0.25;
    const values: Record<string, number> = {
      ArrowLeft: current - step, ArrowDown: current - step,
      ArrowRight: current + step, ArrowUp: current + step,
      PageDown: current - step * 4, PageUp: current + step * 4,
      Home: 0, End: maxH,
    };
    if (!(event.key in values)) return;
    event.preventDefault();
    onHours(clamp(values[event.key]));
  }

  return (
    <div className="time-dial">
      <button type="button" data-playback-control onClick={onTogglePlay}
        className="theatre-button theatre-primary" aria-keyshortcuts="Space">
        <PlayIcon size={16} aria-hidden="true" /> {playLabel}
      </button>
      <div className="time-dial-track">
        <div className="time-dial-labels"><span>0 h</span><output aria-live="off">Time {current.toFixed(1)} h</output><span>{maxH} h</span></div>
        <div role="slider" data-dial-strip tabIndex={0} aria-label="Simulated time, in hours"
          aria-orientation="horizontal" aria-valuemin={0} aria-valuemax={maxH}
          aria-valuenow={Number(current.toFixed(2))} aria-valuetext={`${current.toFixed(1)} hours`}
          data-dial-value={current.toFixed(2)} onKeyDown={onKeyDown}
          onPointerDown={(event) => {
            if (event.button !== 0) return;
            event.currentTarget.setPointerCapture(event.pointerId);
            event.currentTarget.focus();
            seekPointer(event);
          }}
          onPointerMove={(event) => { if (event.currentTarget.hasPointerCapture(event.pointerId)) seekPointer(event); }}
          onPointerUp={endDrag} onPointerCancel={endDrag}>
          <div className="time-dial-rail" aria-hidden="true">
            <div className="time-dial-fill" style={{ width: `${fraction * 100}%` }} />
            <span className="time-dial-thumb" style={{ left: `${fraction * 100}%` }} />
          </div>
        </div>
        <div className="time-dial-caption">
          <span>{tmaxH == null ? "Simulated time" : `Peak at ${tmaxH.toFixed(2)} h`}</span>
          <span><kbd>Space</kbd> pause / resume</span>
        </div>
      </div>
    </div>
  );
}
