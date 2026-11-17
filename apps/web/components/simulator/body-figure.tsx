"use client";

/**
 * The model viewport: the canvas the anatomy is drawn on, with the HUD
 * furniture around it.
 *
 * React owns the canvas and the overlays; the Three.js scene is imported
 * lazily so `three` never lands in the first payload and never runs during
 * SSR.
 *
 * The overlays are plain DOM driven from a rAF loop, so moving the camera and
 * pointing at the brain never cause a React render.
 */

import { useEffect, useRef, useState } from "react";
import { RotateCcw } from "lucide-react";
import type { BrainRegion } from "@/components/anatomy/regions";
import type { SimulatorScene } from "./scene";

export type SceneStatus = "loading" | "ready" | "error";

type BodyFigureProps = {
  /** The live scene, for the overlays. */
  scene: SimulatorScene | null;
  /** The current dose route segment, shown over the model. */
  stageLabel: string | null;
  /** Hands the scene to the parent so it can drive it. */
  onScene?: (scene: SimulatorScene | null) => void;
  onStatus?: (status: SceneStatus) => void;
  /** The brain region under the pointer. */
  onBrainRegion?: (region: BrainRegion | null) => void;
  className?: string;
};

export default function BodyFigure({
  scene,
  stageLabel,
  onScene,
  onStatus,
  onBrainRegion,
  className = "",
}: BodyFigureProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const onSceneRef = useRef(onScene);
  const onBrainRegionRef = useRef(onBrainRegion);
  const [status, setStatus] = useState<SceneStatus>("loading");
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    onSceneRef.current = onScene;
    onBrainRegionRef.current = onBrainRegion;
  }, [onScene, onBrainRegion]);

  useEffect(() => { onStatus?.(status); }, [onStatus, status]);

  // The scene is created once per mount; a retry re-runs the effect.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let scene: SimulatorScene | null = null;
    let observer: IntersectionObserver | null = null;
    let cancelled = false;

    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    import("./scene").then(({ createSimulatorScene }) => {
      if (cancelled) return;
      scene = createSimulatorScene(canvas, {
        reducedMotion,
        maxDpr: coarse ? 1.5 : 2,
        onStatus: setStatus,
        onBrainRegion: (region) => onBrainRegionRef.current?.(region),
      });
      onSceneRef.current?.(scene);

      // The scene sleeps while it is out of sight: a background tab should
      // not spend the battery drawing a body nobody is looking at.
      observer = new IntersectionObserver(
        ([entry]) => scene?.setPaused(!entry.isIntersecting),
        { threshold: 0 }
      );
      observer.observe(canvas);
    }).catch(() => {
      if (!cancelled) setStatus("error");
    });

    return () => {
      cancelled = true;
      observer?.disconnect();
      scene?.dispose();
      onSceneRef.current?.(null);
    };
  }, [reloadKey]);

  /* The label over the focused organ ---------------------------------- */

  const brainRef = useRef<HTMLDivElement | null>(null);
  const brainLabelRef = useRef<HTMLSpanElement | null>(null);
  const brainPartRef = useRef<HTMLSpanElement | null>(null);

  useEffect(() => {
    if (!scene) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let bx = 0;
    let by = 0;
    let started = false;

    const tick = () => {
      raf = requestAnimationFrame(tick);
      const canvas = canvasRef.current;
      if (!canvas) return;

      // The brain readout.
      const brainBox = brainRef.current;
      const brainLabel = brainLabelRef.current;
      const brainPart = brainPartRef.current;
      if (!brainBox || !brainLabel || !brainPart) return;

      const hit = scene.getBrainRegion();
      if (!hit) {
        brainBox.style.opacity = "0";
        return;
      }
      if (!started) {
        bx = hit.x;
        by = hit.y;
        started = true;
      } else if (reduced) {
        bx = hit.x;
        by = hit.y;
      } else {
        bx += (hit.x - bx) * 0.25;
        by += (hit.y - by) * 0.25;
      }
      if (brainLabel.textContent !== hit.region.display) {
        brainLabel.textContent = hit.region.display;
      }
      if (brainPart.textContent !== hit.region.part) {
        brainPart.textContent = hit.region.part;
      }
      const width = canvas.clientWidth || 0;
      const height = canvas.clientHeight || 0;
      const boxWidth = brainBox.offsetWidth || 220;
      const boxHeight = brainBox.offsetHeight || 24;
      const left = width ? Math.max(4, Math.min(bx + 14, width - boxWidth - 4)) : bx + 14;
      const top = height
        ? Math.max(4, Math.min(by - boxHeight - 10, height - boxHeight - 4))
        : by - boxHeight - 10;
      brainBox.style.opacity = "1";
      brainBox.style.transform = `translate3d(${left.toFixed(1)}px, ${top.toFixed(1)}px, 0)`;
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [scene]);

  return (
    <div className={`relative h-full w-full ${className}`}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="See-through anatomy with an animated capsule and a gold trail showing the dose route."
        className="block h-full w-full touch-pan-y select-none"
      />

      {status === "ready" && stageLabel ? (
        <>
          <div aria-hidden="true" className="pointer-events-none absolute left-3 top-3 z-10 rounded-md border border-line-strong bg-page/90 px-2.5 py-1.5 text-xs font-medium text-ink">
            {stageLabel}
          </div>
          <div className="pointer-events-none absolute bottom-3 left-3 z-10 flex items-center gap-2 rounded-md border border-line bg-page/90 px-2.5 py-1.5 text-xs text-ink-2">
            <span aria-hidden="true" className="size-2 rounded-full bg-amber-300" />
            Illustrative route of the first dose
          </div>
        </>
      ) : null}

      {/* The part of the brain under the pointer. */}
      <div
        ref={brainRef}
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-0 z-10 max-w-[min(280px,calc(100%-8px))] truncate rounded-[4px] border border-line-strong bg-page/85 px-2 py-1 font-mono text-[11px] uppercase leading-4 tracking-[0.12em] text-brand-text backdrop-blur-sm"
        style={{ opacity: 0, transform: "translate3d(0px, 0px, 0)" }}
      >
        <span ref={brainLabelRef} className="block truncate" />
        <span ref={brainPartRef} className="block truncate normal-case tracking-normal text-ink-2" />
      </div>

      {/* The model's own state, said plainly. */}
      {status !== "ready" ? (
        <div
          role="status"
          aria-live="polite"
          className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 text-center"
        >
          <p className="font-mono text-[12px] uppercase tracking-[0.12em] text-ink-2">
            {status === "loading" ? "Loading anatomy…" : "Anatomy unavailable"}
          </p>
          {status === "error" ? (
            <>
              <p className="max-w-[280px] text-[14px] leading-5 text-ink-2">
                You can still play the timeline and view the model values.
              </p>
              <button
                type="button"
                onClick={() => { setStatus("loading"); setReloadKey((k) => k + 1); }}
                className="pointer-events-auto flex items-center gap-2 rounded-[10px] border border-line-strong px-4 py-2 text-[13px] font-medium text-ink transition-colors hover:border-brand-text hover:text-brand-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <RotateCcw className="h-4 w-4" strokeWidth={1.5} aria-hidden="true" />
                Try again
              </button>
            </>
          ) : null}
        </div>
      ) : null}

    </div>
  );
}
