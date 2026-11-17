"use client";

/**
 * The heart simulator page.
 *
 * React owns the furniture — panels, controls, the info card, the quiz. The
 * 3D scene lives in `./engine`, imported lazily so three never runs on the
 * server and never bloats the first payload. The engine pushes labels and
 * numbers back here at a deliberately low frequency; the canvas itself is
 * driven by its own animation loop, so orbiting the heart does not cause a
 * React render.
 *
 * Everything in the side panels comes from `data/heart/*.json`, the same
 * arrays the meshes are built from. A label, a colour and an info card cannot
 * drift apart because they share one source.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Compass,
  HeartPulse,
  Layers,
  Pause,
  Play,
  RotateCcw,
  Scan,
  Scissors,
  Volume2,
  VolumeX,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import type { HeartEngine, LabelPlacement, Readout, Tier } from "./engine";
import type { LayerId } from "./geometry";
import {
  NOT_MEDICAL_ADVICE,
  anatomy,
  circulation,
  conditions,
  findAnatomy,
  findAnatomyByMesh,
  pharmacology,
  physiology,
  quiz,
  type AnatomyItem,
} from "./data";

type Status = "loading" | "ready" | "error";

const LAYERS: { id: LayerId; label: string }[] = [
  { id: "pericardium", label: "Pericardium" },
  { id: "muscle", label: "Myocardium" },
  { id: "valves", label: "Valves" },
  { id: "arteries", label: "Arteries" },
  { id: "veins", label: "Veins" },
  { id: "coronaries", label: "Coronaries" },
  { id: "conduction", label: "Conduction" },
  { id: "blood", label: "Blood" },
];

const TIER_LABEL: Record<Tier, string> = {
  0: "Whole organ",
  1: "Chambers & vessels",
  2: "Valves & wall layers",
  3: "Tissue & cells",
};

const INITIAL_LAYERS: Record<LayerId, number> = {
  pericardium: 1,
  muscle: 1,
  valves: 1,
  arteries: 1,
  veins: 1,
  coronaries: 1,
  conduction: 1,
  blood: 1,
};

function zoomToSlider(zoom: number) {
  return Math.min(1, Math.max(0, Math.log10(Math.max(1, zoom)) / 2));
}

function sliderToZoom(value: number) {
  return Math.pow(10, Math.min(1, Math.max(0, value)) * 2);
}

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

/** The 3D stage: two stacked canvases and the DOM labels above them. */
function HeartStage({
  status,
  labels,
  labelsVisible,
  zoom,
  tier,
  paused,
  onZoomInput,
  onZoomStep,
  onReset,
  onRide,
  onTogglePlay,
}: {
  status: Status;
  labels: LabelPlacement[];
  labelsVisible: boolean;
  zoom: number;
  tier: Tier;
  paused: boolean;
  onZoomInput: (zoom: number) => void;
  onZoomStep: (factor: number) => void;
  onReset: () => void;
  onRide: () => void;
  onTogglePlay: () => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  // React owns the canvas element; the engine mounts into it from the parent.
  return (
    <div className="relative flex min-h-[420px] flex-1 flex-col overflow-hidden rounded-xl border border-line bg-[radial-gradient(120%_90%_at_50%_0%,#14203a_0%,#0a1121_58%,#070b16_100%)]">
      <canvas
        ref={canvasRef}
        data-heart-canvas=""
        role="img"
        aria-label="Interactive 3D heart. Drag to rotate, use the wheel or pinch to zoom, click a structure to read about it."
        className="absolute inset-0 h-full w-full touch-none outline-none"
        tabIndex={0}
      />
      <canvas
        ref={overlayRef}
        data-heart-overlay=""
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 h-full w-full"
      />

      {/* Leader-line labels. The engine draws the lines; the text is DOM so it
          stays crisp at any zoom and is readable by assistive tech. */}
      {labelsVisible ? (
        <div className="pointer-events-none absolute inset-0" aria-live="off">
          {labels
            .filter((label) => label.visible)
            .map((label) => (
              <span
                key={label.id}
                style={{ left: label.x, top: label.y }}
                className="absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border border-brand/40 bg-[#071021]/90 px-2 py-0.5 font-mono text-[10px] tracking-wide text-brand-text shadow-[0_2px_10px_rgba(0,0,0,0.55)]"
              >
                {label.text}
              </span>
            ))}
        </div>
      ) : null}

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 p-3">
        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-line bg-surface/85 px-2 py-1 backdrop-blur-sm">
          <button
            type="button"
            onClick={onTogglePlay}
            aria-pressed={!paused}
            aria-label={paused ? "Play the heartbeat" : "Pause the heartbeat"}
            className="rounded-full p-1 text-ink-2 transition hover:bg-white/5 hover:text-ink"
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <span className="h-3 w-px bg-line" />
          <button
            type="button"
            onClick={() => onZoomStep(1 / 1.25)}
            aria-label="Zoom out"
            className="rounded-full p-1 text-ink-2 transition hover:bg-white/5 hover:text-ink"
          >
            <ZoomOut size={14} />
          </button>
          <input
            type="range"
            min={0}
            max={1}
            step={0.005}
            value={zoomToSlider(zoom)}
            onChange={(event) => onZoomInput(sliderToZoom(Number(event.target.value)))}
            aria-label="Zoom level"
            className="heart-range w-24"
          />
          <button
            type="button"
            onClick={() => onZoomStep(1.25)}
            aria-label="Zoom in"
            className="rounded-full p-1 text-ink-2 transition hover:bg-white/5 hover:text-ink"
          >
            <ZoomIn size={14} />
          </button>
          <span className="w-12 text-right font-mono text-[10px] tabular-nums text-ink-3">
            {zoom < 10 ? zoom.toFixed(1) : Math.round(zoom)}x
          </span>
        </div>
        <div className="pointer-events-auto flex items-center gap-1.5">
          <button
            type="button"
            onClick={onRide}
            className="rounded-full border border-line bg-surface/85 px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-2 backdrop-blur-sm transition hover:text-ink"
          >
            Ride the blood
          </button>
          <button
            type="button"
            onClick={onReset}
            aria-label="Reset view"
            className="rounded-full border border-line bg-surface/85 p-1.5 text-ink-2 backdrop-blur-sm transition hover:text-ink"
          >
            <RotateCcw size={13} />
          </button>
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 p-3">
        <span className="rounded-full border border-line bg-surface/80 px-2 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-ink-3 backdrop-blur-sm">
          {TIER_LABEL[tier]}
        </span>
        <span className="rounded-full border border-line bg-surface/80 px-2 py-0.5 font-mono text-[10px] text-ink-3 backdrop-blur-sm">
          drag · wheel / pinch · click a part
        </span>
      </div>

      {status === "loading" ? (
        <div className="absolute inset-0 grid place-items-center">
          <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-ink-3">Building the heart…</p>
        </div>
      ) : null}
      {status === "error" ? (
        <div className="absolute inset-0 grid place-items-center px-6 text-center">
          <p className="max-w-sm text-sm text-ink-2">
            WebGL could not start, so the 3D view is unavailable. Every panel on this page still works, and
            the written anatomy is complete.
          </p>
        </div>
      ) : null}
    </div>
  );
}

/** The ECG strip. Drawn imperatively from the engine readout, never in React. */
function EcgStrip({ readout }: { readout: Readout | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const historyRef = useRef<number[]>([]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const width = canvas.clientWidth || 260;
    const height = canvas.clientHeight || 72;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    ctx.strokeStyle = "rgba(101,213,236,0.10)";
    ctx.lineWidth = 1;
    for (let x = 0; x < width; x += 16) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, height);
      ctx.stroke();
    }
    for (let y = 0; y < height; y += 16) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(width, y + 0.5);
      ctx.stroke();
    }

    const history = historyRef.current;
    if (history.length < 2) return;
    ctx.strokeStyle = "#a2ecf9";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    const step = width / Math.max(1, history.length - 1);
    history.forEach((value, index) => {
      const y = height * 0.62 - Math.max(-1, Math.min(1, value)) * height * 0.42;
      if (index === 0) ctx.moveTo(0, y);
      else ctx.lineTo(index * step, y);
    });
    ctx.stroke();
  }, [readout]);

  return (
    <canvas
      ref={canvasRef}
      aria-label="Electrocardiogram trace"
      role="img"
      className="h-[72px] w-full rounded-lg border border-line bg-[#060b16]"
    />
  );
}

function FactList({ item }: { item: AnatomyItem }) {
  return (
    <dl className="mt-3 grid grid-cols-1 gap-1.5 text-[12px] sm:grid-cols-2">
      {item.facts.map(([label, value]) => (
        <div key={label} className="rounded-md border border-line/70 bg-white/[0.02] px-2 py-1.5">
          <dt className="font-mono text-[9px] uppercase tracking-[0.14em] text-ink-3">{label}</dt>
          <dd className="mt-0.5 text-ink">{value}</dd>
        </div>
      ))}
    </dl>
  );
}

export default function HeartExperience() {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const engineRef = useRef<HeartEngine | null>(null);

  const [status, setStatus] = useState<Status>("loading");
  const [readout, setReadout] = useState<Readout | null>(null);
  const [labels, setLabels] = useState<LabelPlacement[]>([]);
  const [zoom, setZoom] = useState(1);
  const [tier, setTier] = useState<Tier>(0);
  const [paused, setPaused] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [muted, setMuted] = useState(true);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [xray, setXray] = useState(false);
  const [exploded, setExploded] = useState(0);
  const [clipping, setClipping] = useState(false);
  const [clippingOffset, setClippingOffset] = useState(0);
  const [opacities, setOpacities] = useState<Record<LayerId, number>>(INITIAL_LAYERS);
  const [selectedMesh, setSelectedMesh] = useState<string | null>("heart");
  const [conditionId, setConditionId] = useState("normal");
  const [drugId, setDrugId] = useState<string | null>(null);
  const [routeIndex, setRouteIndex] = useState(0);
  const [quizIndex, setQuizIndex] = useState(0);
  const [quizChoice, setQuizChoice] = useState<number | null>(null);
  const [quizScore, setQuizScore] = useState(0);

  const selected = useMemo(() => {
    if (!selectedMesh) return null;
    return findAnatomyByMesh(selectedMesh) ?? findAnatomy(selectedMesh);
  }, [selectedMesh]);

  const condition = useMemo(
    () => conditions.conditions.find((entry) => entry.id === conditionId) ?? conditions.conditions[0],
    [conditionId],
  );

  const drug = useMemo(
    () => pharmacology.drugs.find((entry) => entry.id === drugId) ?? null,
    [drugId],
  );

  const question = quiz.questions[quizIndex] ?? quiz.questions[0];

  // Mount the engine once. It is imported lazily so three stays out of SSR.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const canvas = stage.querySelector<HTMLCanvasElement>("[data-heart-canvas]");
    const overlay = stage.querySelector<HTMLCanvasElement>("[data-heart-overlay]");
    if (!canvas || !overlay) return;

    let cancelled = false;
    const coarse = window.matchMedia("(pointer: coarse)").matches;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    import("./engine")
      .then(({ HeartEngine: Engine }) => {
        if (cancelled) return;
        const engine = new Engine({
          canvas,
          overlay,
          reducedMotion,
          onPick: (meshId) => setSelectedMesh(meshId),
          onLabels: (next) => setLabels(next),
          onZoom: (nextZoom, nextTier) => {
            setZoom(nextZoom);
            setTier(nextTier);
          },
          onTier: (nextTier) => setTier(nextTier),
        });
        engineRef.current = engine;
        engine.setHeartRate(68);
        engine.setMuted(true);
        engine.resize();
        if (coarse) engine.setLayer("pericardium", 0.55);
        setStatus("ready");
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });

    const resize = new ResizeObserver(() => engineRef.current?.resize());
    resize.observe(stage);

    const visible = new IntersectionObserver(
      ([entry]) => engineRef.current?.setPaused(!entry.isIntersecting || paused),
      { threshold: 0.05 },
    );
    visible.observe(stage);

    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (event.key === "+" || event.key === "=") engineRef.current?.zoomBy(1.2);
      else if (event.key === "-" || event.key === "_") engineRef.current?.zoomBy(1 / 1.2);
      else if (event.key === "0") engineRef.current?.reset();
      else if (event.key === " ") {
        event.preventDefault();
        setPaused((value) => !value);
      } else if (event.key.toLowerCase() === "x") setXray((value) => !value);
      else if (event.key.toLowerCase() === "l") setLabelsVisible((value) => !value);
      else if (event.key === "ArrowRight") engineRef.current?.stepPhase(1);
      else if (event.key === "ArrowLeft") engineRef.current?.stepPhase(-1);
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      cancelled = true;
      window.removeEventListener("keydown", onKeyDown);
      resize.disconnect();
      visible.disconnect();
      engineRef.current?.dispose();
      engineRef.current = null;
    };
    // The engine is created once per mount; state that must reach it is pushed
    // by the effects below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push UI state into the engine.
  useEffect(() => {
    engineRef.current?.setPaused(paused);
  }, [paused]);

  useEffect(() => {
    engineRef.current?.setSpeed(speed);
  }, [speed]);

  useEffect(() => {
    engineRef.current?.setMuted(muted);
  }, [muted]);

  useEffect(() => {
    engineRef.current?.setLabelsVisible(labelsVisible);
    if (!labelsVisible) setLabels([]);
  }, [labelsVisible]);

  useEffect(() => {
    engineRef.current?.setXray(xray);
  }, [xray]);

  useEffect(() => {
    engineRef.current?.setExploded(exploded);
  }, [exploded]);

  useEffect(() => {
    engineRef.current?.setClipping(clipping);
  }, [clipping]);

  useEffect(() => {
    engineRef.current?.setClippingOffset(clippingOffset);
  }, [clippingOffset]);

  useEffect(() => {
    engineRef.current?.setCondition(conditionId);
    const hr = engineRef.current?.heartRate;
    if (typeof hr === "number") setReadout((current) => (current ? { ...current, hr } : current));
  }, [conditionId]);

  useEffect(() => {
    engineRef.current?.setDrug(drugId);
  }, [drugId]);

  // Numbers arrive at ~8 fps: fast enough to feel live, slow enough that the
  // panels never compete with the render loop.
  useEffect(() => {
    let raf = 0;
    let lastPush = 0;
    const tick = (time: number) => {
      raf = requestAnimationFrame(tick);
      const engine = engineRef.current;
      if (!engine) return;
      if (time - lastPush > 120) {
        lastPush = time;
        setReadout({ ...engine.latest });
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const applyZoom = useCallback((next: number) => {
    engineRef.current?.setZoom(next);
    setZoom(next);
  }, []);

  const stepZoom = useCallback(
    (factor: number) => {
      engineRef.current?.zoomBy(factor);
      setZoom((current) => Math.min(100, Math.max(1, current * factor)));
    },
    [],
  );

  const setLayerOpacity = useCallback((id: LayerId, value: number) => {
    setOpacities((current) => ({ ...current, [id]: value }));
    engineRef.current?.setLayer(id, value);
  }, []);

  const pickStructure = useCallback((meshId: string) => {
    setSelectedMesh(meshId);
    engineRef.current?.focus(meshId);
  }, []);

  const answer = useCallback(
    (index: number) => {
      if (quizChoice !== null) return;
      setQuizChoice(index);
      if (index === question.answer) setQuizScore((value) => value + 1);
    },
    [question.answer, quizChoice],
  );

  const nextQuestion = useCallback(() => {
    setQuizChoice(null);
    setQuizIndex((value) => (value + 1) % quiz.questions.length);
  }, []);

  const routeStation = circulation.oralRoute[routeIndex] ?? circulation.oralRoute[0];

  return (
    <main className="theatre-main pt-6">
      <header>
        <p className="theatre-eyebrow">Heart simulator</p>
        <h1 className="mt-2 font-heading text-4xl leading-[1.05] text-ink sm:text-5xl">
          The heart, at every scale
        </h1>
        <p className="mt-3 max-w-[52ch] text-sm leading-relaxed text-ink-2">
          {anatomy.items.length} structures, one beating model. Zoom from the whole organ down to the
          muscle cells, follow an oral substance from the gut to the aorta, and see what each phase of the
          cardiac cycle is doing while it happens.
        </p>
      </header>

      <div className="mt-6 grid gap-4 lg:grid-cols-[248px_minmax(0,1fr)_320px]">
        {/* Left: layers, conditions, drug route */}
        <aside className="flex flex-col gap-4">
          <section className="theatre-surface p-4">
            <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
              <Layers size={12} aria-hidden="true" /> Layers
            </h2>
            <div className="mt-3 space-y-2.5">
              {LAYERS.map((layer) => (
                <label key={layer.id} className="block">
                  <span className="flex items-center justify-between text-[12px] text-ink-2">
                    {layer.label}
                    <span className="font-mono text-[10px] tabular-nums text-ink-3">
                      {percent(opacities[layer.id])}
                    </span>
                  </span>
                  <input
                    type="range"
                    min={0}
                    max={1}
                    step={0.05}
                    value={opacities[layer.id]}
                    onChange={(event) => setLayerOpacity(layer.id, Number(event.target.value))}
                    aria-label={`${layer.label} opacity`}
                    className="heart-range mt-1 w-full"
                  />
                </label>
              ))}
            </div>
            <div className="mt-4 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setLabelsVisible((value) => !value)}
                aria-pressed={labelsVisible}
                className="theatre-button text-[11px]"
              >
                Labels
              </button>
              <button
                type="button"
                onClick={() => setXray((value) => !value)}
                aria-pressed={xray}
                className="theatre-button text-[11px]"
              >
                <Scan size={11} aria-hidden="true" /> X-ray
              </button>
              <button
                type="button"
                onClick={() => setMuted((value) => !value)}
                aria-pressed={!muted}
                className="theatre-button text-[11px]"
              >
                {muted ? <VolumeX size={11} aria-hidden="true" /> : <Volume2 size={11} aria-hidden="true" />}
                {muted ? "Sound off" : "Sound on"}
              </button>
            </div>
            <label className="mt-3 block text-[12px] text-ink-2">
              Exploded view
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={exploded}
                onChange={(event) => setExploded(Number(event.target.value))}
                className="heart-range mt-1 w-full"
              />
            </label>
            <label className="mt-3 flex items-center gap-2 text-[12px] text-ink-2">
              <input
                type="checkbox"
                checked={clipping}
                onChange={(event) => setClipping(event.target.checked)}
                className="accent-[color:var(--accent-fill)]"
              />
              <Scissors size={12} aria-hidden="true" /> Cutaway
            </label>
            {clipping ? (
              <input
                type="range"
                min={-2.4}
                max={2.4}
                step={0.05}
                value={clippingOffset}
                onChange={(event) => setClippingOffset(Number(event.target.value))}
                aria-label="Cutaway depth"
                className="heart-range mt-2 w-full"
              />
            ) : null}
          </section>

          <section className="theatre-surface p-4">
            <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
              <Activity size={12} aria-hidden="true" /> Teaching condition
            </h2>
            <select
              value={conditionId}
              onChange={(event) => setConditionId(event.target.value)}
              className="theatre-select mt-2 w-full text-[12px]"
              aria-label="Teaching condition"
            >
              {conditions.conditions.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <p className="mt-2 text-[12px] leading-5 text-ink-2">{condition.summary}</p>
            <dl className="mt-2 grid gap-1">
              {condition.effects.map((effect) => (
                <div key={effect.label} className="flex items-baseline justify-between gap-2 text-[11px]">
                  <dt className="text-ink-3">{effect.label}</dt>
                  <dd className="font-mono text-ink">{effect.value}</dd>
                </div>
              ))}
            </dl>
          </section>

          <section className="theatre-surface p-4">
            <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
              <HeartPulse size={12} aria-hidden="true" /> Substance
            </h2>
            <select
              value={drugId ?? ""}
              onChange={(event) => setDrugId(event.target.value || null)}
              className="theatre-select mt-2 w-full text-[12px]"
              aria-label="Show a substance travelling the circulation"
            >
              <option value="">No substance</option>
              {pharmacology.drugs.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            {drug ? (
              <div className="mt-2">
                <p className="text-[12px] leading-5 text-ink-2">{drug.summary}</p>
                <ul className="mt-2 space-y-1">
                  {drug.effects.map((effect) => (
                    <li key={effect.organ} className="text-[11px] leading-4 text-ink-2">
                      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-brand-text">
                        {effect.organ} {effect.direction}
                      </span>
                      <br />
                      {effect.note}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="mt-2 text-[11px] leading-4 text-ink-3">
                Particles follow the oral route: gut, portal vein, liver, vena cava, right heart, lungs,
                left heart, aorta, body.
              </p>
            )}
          </section>
        </aside>

        {/* Centre: the stage and its transport */}
        <div className="flex flex-col gap-3">
          <div ref={stageRef} className="flex min-h-[420px] flex-col">
            <HeartStage
              status={status}
              labels={labels}
              labelsVisible={labelsVisible}
              zoom={zoom}
              tier={tier}
              paused={paused}
              onZoomInput={applyZoom}
              onZoomStep={stepZoom}
              onReset={() => {
                engineRef.current?.reset();
                setZoom(1);
              }}
              onRide={() => {
                engineRef.current?.rideBlood();
                setPaused(false);
              }}
              onTogglePlay={() => setPaused((value) => !value)}
            />
          </div>

          <section className="theatre-surface flex flex-wrap items-center gap-3 p-3">
            <button
              type="button"
              onClick={() => setPaused((value) => !value)}
              className="theatre-primary text-[11px]"
              aria-pressed={!paused}
            >
              {paused ? <Play size={12} aria-hidden="true" /> : <Pause size={12} aria-hidden="true" />}
              {paused ? "Play" : "Pause"}
            </button>
            <button
              type="button"
              onClick={() => engineRef.current?.stepPhase(-1)}
              className="theatre-button text-[11px]"
            >
              ← Phase
            </button>
            <button
              type="button"
              onClick={() => engineRef.current?.stepPhase(1)}
              className="theatre-button text-[11px]"
            >
              Phase →
            </button>
            <label className="flex items-center gap-2 text-[11px] text-ink-2">
              Speed
              <select
                value={speed}
                onChange={(event) => setSpeed(Number(event.target.value))}
                className="theatre-select py-1 text-[11px]"
              >
                <option value={0.1}>0.1×</option>
                <option value={0.25}>0.25×</option>
                <option value={0.5}>0.5×</option>
                <option value={1}>1×</option>
                <option value={2}>2×</option>
                <option value={3}>3×</option>
              </select>
            </label>
            <label className="flex flex-1 items-center gap-2 text-[11px] text-ink-2">
              <span className="whitespace-nowrap">Heart rate</span>
              <input
                type="range"
                min={30}
                max={200}
                step={1}
                value={readout?.hr ?? 68}
                onChange={(event) => {
                  const next = Number(event.target.value);
                  engineRef.current?.setHeartRate(next);
                  setReadout((current) => (current ? { ...current, hr: next } : current));
                }}
                aria-label="Heart rate in beats per minute"
                className="heart-range w-full"
              />
              <span className="w-14 text-right font-mono text-[11px] tabular-nums text-ink">
                {readout?.hr ?? 68} bpm
              </span>
            </label>
            <div className="flex gap-1.5">
              {physiology.presets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => engineRef.current?.setHeartRate(preset.hr)}
                  className="theatre-button text-[11px]"
                  title={preset.note}
                >
                  {preset.label}
                </button>
              ))}
            </div>
          </section>

          <section className="theatre-surface flex flex-wrap items-center gap-3 p-3">
            <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
              <Compass size={12} aria-hidden="true" /> Oral route
            </h2>
            <div className="flex flex-1 items-center gap-2">
              <input
                type="range"
                min={0}
                max={circulation.oralRoute.length - 1}
                step={1}
                value={routeIndex}
                onChange={(event) => setRouteIndex(Number(event.target.value))}
                aria-label="Position along the oral route"
                className="heart-range w-full"
              />
              <span className="min-w-[132px] text-[11px] text-ink">{routeStation.label}</span>
            </div>
            <p className="w-full text-[11px] leading-4 text-ink-3">{routeStation.note}</p>
          </section>
        </div>

        {/* Right: detail, live numbers, quiz */}
        <aside className="flex flex-col gap-4">
          <section className="theatre-surface p-4">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">Selected structure</h2>
            {selected ? (
              <>
                <div className="mt-2 flex items-baseline gap-2">
                  <span
                    aria-hidden="true"
                    className="mt-1 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: selected.colour }}
                  />
                  <h3 className="font-[family-name:var(--font-theatre-display)] text-xl leading-tight text-ink">
                    {selected.name}
                  </h3>
                </div>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
                  {selected.group}
                </p>
                <p className="mt-2 text-[12px] leading-5 text-ink-2">{selected.description}</p>
                <FactList item={selected} />
                <p className="mt-3 border-l-2 border-brand/40 pl-2 text-[11px] leading-4 text-ink-2">
                  {selected.funFact}
                </p>
              </>
            ) : (
              <p className="mt-2 text-[12px] leading-5 text-ink-2">
                Click any structure in the model to read about it. Double-click flies the camera there.
              </p>
            )}
          </section>

          <section className="theatre-surface p-4">
            <h2 className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
              <Activity size={12} aria-hidden="true" /> Live
            </h2>
            <EcgStrip readout={readout} />
            <p className="mt-1 flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
              <span>{readout?.phaseLabel ?? "—"}</span>
              <span className="tabular-nums">{readout ? `${readout.seconds.toFixed(2)} s` : ""}</span>
            </p>
            <div className="mt-1 h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full bg-brand/70 transition-[width] duration-100"
                style={{ width: `${Math.round((readout?.progress ?? 0) * 100)}%` }}
              />
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1.5 text-[11px]">
              {[
                ["LV volume", readout ? `${Math.round(readout.lvVolume)} mL` : "—"],
                ["Aortic", readout ? `${Math.round(readout.aorticPressure)} mmHg` : "—"],
                ["LV pressure", readout ? `${Math.round(readout.lvPressure)} mmHg` : "—"],
                ["LA", readout ? `${Math.round(readout.laPressure)} mmHg` : "—"],
                ["Ejection fraction", readout ? `${Math.round(readout.ejectionFraction)}%` : "—"],
                ["Cardiac output", readout ? `${readout.cardiacOutput.toFixed(1)} L/min` : "—"],
              ].map(([label, value]) => (
                <div key={label} className="flex items-baseline justify-between gap-2">
                  <dt className="text-ink-3">{label}</dt>
                  <dd className="font-mono tabular-nums text-ink">{value}</dd>
                </div>
              ))}
            </dl>

            <div className="mt-3 grid grid-cols-2 gap-1.5">
              {readout
                ? (
                    [
                      ["Mitral", readout.valves.mitral],
                      ["Aortic", readout.valves.aortic],
                      ["Tricuspid", readout.valves.tricuspid],
                      ["Pulmonary", readout.valves.pulmonary],
                    ] as const
                  ).map(([label, value]) => (
                    <div
                      key={label}
                      className="rounded-md border border-line/70 px-2 py-1 text-[10px] text-ink-2"
                    >
                      <span className="font-mono uppercase tracking-[0.12em] text-ink-3">{label}</span>
                      <span className="ml-1 tabular-nums text-ink">{value > 0.5 ? "open" : "closed"}</span>
                    </div>
                  ))
                : null}
            </div>
          </section>

          <section className="theatre-surface p-4">
            <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">
              Quiz · {quizScore}/{quiz.questions.length}
            </h2>
            <p className="mt-2 text-[12px] leading-5 text-ink">{question.question}</p>
            <div className="mt-2 space-y-1.5">
              {question.options.map((option, index) => {
                const chosen = quizChoice === index;
                const correct = index === question.answer;
                const state =
                  quizChoice === null
                    ? "border-line/70 hover:border-line-strong"
                    : correct
                      ? "border-brand/60 text-ink"
                      : chosen
                        ? "border-amber-400/60 text-ink-2"
                        : "border-line/50 text-ink-3";
                return (
                  <button
                    key={option}
                    type="button"
                    onClick={() => answer(index)}
                    disabled={quizChoice !== null}
                    className={`w-full rounded-md border px-2 py-1.5 text-left text-[11px] leading-4 transition ${state}`}
                  >
                    {option}
                  </button>
                );
              })}
            </div>
            {quizChoice !== null ? (
              <div className="mt-2">
                <p className="text-[11px] leading-4 text-ink-2">{question.explain}</p>
                <button type="button" onClick={nextQuestion} className="theatre-button mt-2 text-[11px]">
                  Next question
                </button>
              </div>
            ) : null}
          </section>

          <p className="px-1 text-[10px] leading-4 text-ink-3">{NOT_MEDICAL_ADVICE}</p>
        </aside>
      </div>

      <section className="theatre-surface mt-4 p-4">
        <h2 className="font-mono text-[10px] uppercase tracking-[0.18em] text-ink-3">Jump to a structure</h2>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {anatomy.items.slice(0, 26).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => pickStructure(item.mesh)}
              className="rounded-full border border-line/70 px-2.5 py-1 text-[11px] text-ink-2 transition hover:border-line-strong hover:text-ink"
            >
              {item.name}
            </button>
          ))}
        </div>
      </section>
    </main>
  );
}
