"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowDown, ArrowUpRight, Play, Save, ScanLine, SlidersHorizontal } from "lucide-react";
import { simulate, buildReport, type BodyProfile, type DoseEvent } from "@dib/engine";
import type { DataClient } from "@dib/data-client";
import { getBrowserDataClient } from "@/lib/browser-data-client";
import { DRUG_COLORS, SEPARATE_CURVES_CAPTION, type MedicationRun } from "@/lib/treatment";
import { exampleDrug, EXAMPLE_BANNER } from "@/lib/example-drug";
import { STUDY_CASES } from "@/lib/study-cases";
import { topicForOrgan } from "@/lib/pubmed";
import SimulatorConsole, { type SimulatorInput } from "./console";
import TimeDial from "./time-dial";
import BodyFigure, { type SceneStatus } from "./body-figure";
import OrganDetail from "./organ-detail";
import OrganMonitor from "./organ-monitor";
import JourneyRail from "./journey-rail";
import TheatreNav from "../theatre-nav";
import StepLiterature from "./step-literature";
import RunResults, { ConcentrationChart, PdfAction, useReportPdf } from "./run-results";
import { conditionById, levelsFor } from "./condition";
import { buildStages, playbackAt, progressAt, readMoment, stageMotion, STAGE_MS, TRAVEL_FRACTION } from "./playback";
import type { FocusOrgan, SimulatorScene } from "./scene";

type SexUi = "female" | "male" | "other";
const toEngineSex = (s: SexUi): BodyProfile["sex"] =>
  s === "female" ? "F" : s === "male" ? "M" : "other";

const DEFAULT_INPUT: SimulatorInput = {
  conditionId: "general",
  description: "",
  ageYears: 30,
  weightKg: 70,
  sex: "other",
  drugs: [],
  tEndH: 48,
};

const OVERVIEW_MS = 1400;
const buttonClass = "theatre-button";

export default function Simulator() {
  const [studyId, setStudyId] = React.useState(STUDY_CASES[0].id);
  const [draft, setDraft] = React.useState<SimulatorInput>(DEFAULT_INPUT);
  const [active, setActive] = React.useState<SimulatorInput>(DEFAULT_INPUT);
  const [runs, setRuns] = React.useState<MedicationRun[] | null>(null);
  const [inspection, setInspection] = React.useState<FocusOrgan | null>(null);
  const [monitorOpen, setMonitorOpen] = React.useState(false);
  const [simError, setSimError] = React.useState<string | null>(null);
  const [progress, setProgress] = React.useState(0);
  const [playing, setPlaying] = React.useState(false);
  const [readyToAdvance, setReadyToAdvance] = React.useState(false);
  const [scene, setScene] = React.useState<SimulatorScene | null>(null);
  const [sceneStatus, setSceneStatus] = React.useState<SceneStatus>("loading");
  const [showLiterature, setShowLiterature] = React.useState(false);
  const studioRef = React.useRef<HTMLElement | null>(null);
  const inputsRef = React.useRef<HTMLDetailsElement | null>(null);
  const launch = React.useRef<"studio" | "setup" | null>(null);
  /* ---- session -------------------------------------------------------- */

  const [client, setClient] = React.useState<DataClient | null>(null);
  const [signedInEmail, setSignedInEmail] = React.useState<string | null>(null);
  const [action, setAction] = React.useState<string | null>(null);
  const [profileNotice, setProfileNotice] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);

  React.useEffect(() => {
    const c = getBrowserDataClient();
    if (!c) return;
    const res = c.auth.onAuthChange((_event, session) => setSignedInEmail(session?.email ?? null));
    if (res.error) return;
    setClient(c);
    return res.data?.unsubscribe;
  }, []);

  // Pre-fill the form from the stored profile once, when signed in.
  React.useEffect(() => {
    if (!client || !signedInEmail) return;
    let current = true;
    void client.profile.getProfile().then(({ data, error }) => {
      if (!current || error || !data) return;
      setDraft((d) => ({
        ...d,
        ageYears: d.ageYears === DEFAULT_INPUT.ageYears ? data.ageYears : d.ageYears,
        weightKg: d.weightKg === DEFAULT_INPUT.weightKg ? data.weightKg : d.weightKg,
        sex: d.sex === DEFAULT_INPUT.sex ? data.sex : d.sex,
      }));
    });
    return () => { current = false; };
  }, [client, signedInEmail]);

  // The dose that comes first determines the route. All curves remain independent.
  const subject = React.useMemo(() => active.drugs.reduce<SimulatorInput["drugs"][number] | undefined>((first, line) => {
    const time = Math.min(...line.doses.map(({ timeH }) => timeH));
    const firstTime = first ? Math.min(...first.doses.map(({ timeH }) => timeH)) : Infinity;
    return time < firstTime ? line : first;
  }, undefined), [active.drugs]);
  const primaryRun = runs?.find(({ id }) => id === subject?.drug.id);
  const result = primaryRun?.result ?? null;
  const reports = React.useMemo(() => runs?.map((run) => ({ run, report: buildReport(run.result) })) ?? [], [runs]);
  const study = STUDY_CASES.find((item) => item.id === active.drugs[0]?.drug.id);
  const isExample = active.drugs.some(({ drug }) => drug.id === exampleDrug.id);
  const treatmentLabel = active.drugs.length === 1
    ? active.drugs[0].drug.name
    : `${active.drugs.length} medicines`;
  const condition = conditionById(active.conditionId);
  const stripDrugs = React.useMemo(
    () => active.drugs.map(({ drug }) => ({ id: drug.id, name: drug.name })),
    [active.drugs],
  );
  const stages = React.useMemo(
    () => result && subject ? buildStages(result, subject.doses.map(({ timeH }) => timeH), condition) : [],
    [subject, condition, result],
  );
  const finalStage = Math.max(0, stages.length - 1);
  const { index, hours } = playbackAt(stages, progress);
  const stage = stages[index];
  const finished = stages.length > 0 && progress >= finalStage;
  const focus = stage?.organ ?? null;
  const route = stage?.route;
  const motion = stageMotion(progress);
  const detailOnRight = index % 2 === 1;
  const chosenStudy = STUDY_CASES.find((item) => item.id === studyId) ?? STUDY_CASES[0];
  const previousStage = stages[index - 1];
  const peakLevels = React.useMemo(() => {
    const max = (series: number[]) => series.reduce((peak, value) => Math.max(peak, value), 0);
    return result ? {
      concMgPerL: result.cmaxMgPerL,
      eliminationMgPerH: max(result.eliminationMgPerH),
      gutMg: max(result.gutMg),
    } : null;
  }, [result]);

  const pdf = useReportPdf({ runs, primaryRun, active, stages, study, isExample, treatmentLabel });

  React.useEffect(() => {
    scene?.setIsolation(inspection);
    scene?.setStage(focus, route, motion.fraction, !playing);
  }, [scene, focus, route, motion.fraction, playing, inspection]);

  React.useEffect(() => {
    scene?.setLevels(result && peakLevels ? levelsFor(readMoment(result, hours), peakLevels) : {});
  }, [scene, result, hours, peakLevels]);

  React.useEffect(() => {
    if (!playing || !result || readyToAdvance) return;
    if (sceneStatus !== "loading") {
      setReadyToAdvance(true);
      return;
    }
    const timeout = window.setTimeout(() => setReadyToAdvance(true), 4500);
    return () => window.clearTimeout(timeout);
  }, [playing, result, readyToAdvance, sceneStatus]);

  React.useEffect(() => {
    if (!playing || !readyToAdvance || finalStage === 0 || finished) return;
    let previous = performance.now();
    let frame = 0;
    const advance = (now: number) => {
      const elapsed = Math.min(now - previous, 80);
      previous = now;
      if (!document.hidden) {
        setProgress((value) => Math.min(finalStage, value + elapsed / (value < 1 ? OVERVIEW_MS : STAGE_MS)));
      }
      frame = requestAnimationFrame(advance);
    };
    frame = requestAnimationFrame(advance);
    return () => cancelAnimationFrame(frame);
  }, [playing, readyToAdvance, finalStage, finished]);

  // Bring the studio into view once when a run starts.
  React.useEffect(() => {
    if (!launch.current || !result) return;
    if (launch.current === "setup") {
      if (inputsRef.current) inputsRef.current.open = false;
    }
    studioRef.current?.scrollIntoView({ block: "start", behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth" });
    launch.current = null;
    studioRef.current?.querySelector<HTMLElement>("[data-playback-control]")?.focus({ preventScroll: true });
  }, [result]);

  function start(input: SimulatorInput, fromSetup = false) {
    const profile: BodyProfile = { ageYears: input.ageYears, weightKg: input.weightKg, sex: toEngineSex(input.sex) };
    try {
      const sampleAtH = input.drugs.flatMap(({ doses }) => doses.map(({ timeH }) => timeH));
      const nextRuns = input.drugs.map(({ drug, doses }, index) => {
        const events: DoseEvent[] = doses.map((dose) => ({ ...dose, drugId: drug.id }));
        return { id: drug.id, name: drug.name, color: DRUG_COLORS[index % DRUG_COLORS.length], result: simulate({ profile, drug, doses: events, tEndH: input.tEndH, sampleAtH }) };
      });
      setRuns(nextRuns);
    } catch {
      setSimError("The model could not run with these inputs. Check the doses, parameters and simulation window.");
      return;
    }
    launch.current = fromSetup ? "setup" : "studio";
    setActive(input);
    setInspection(null);
    setProgress(0);
    setReadyToAdvance(false);
    setPlaying(true);
    setSimError(null);
    setAction(null);
  }

  function seek(next: number) {
    setInspection(null);
    setPlaying(false);
    setProgress(next);
  }

  const togglePlay = React.useCallback(() => {
    setInspection(null);
    if (finished) {
      setProgress(0);
      setPlaying(true);
    } else {
      setPlaying((value) => !value);
    }
  }, [finished]);

  React.useEffect(() => {
    if (!result) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target;
      if (target instanceof HTMLElement && (target.isContentEditable || target.closest('input, textarea, select, button, a, summary, [role="button"], [role="combobox"], [role="textbox"]'))) return;
      event.preventDefault();
      if (!event.repeat) togglePlay();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [result, togglePlay]);

  function showInputs() {
    setPlaying(false);
    if (!inputsRef.current) return;
    inputsRef.current.open = true;
    inputsRef.current.scrollIntoView({ block: "start" });
    inputsRef.current.querySelector("summary")?.focus({ preventScroll: true });
  }

  const saveReport = React.useCallback(async () => {
    if (!client || !primaryRun || reports.length === 0 || saving || isExample || study) return;
    setSaving(true);
    setAction(null);

    // One entry per (medicine, amount), each carrying every time that
    // amount was given.
    const drugs = active.drugs.flatMap((line) => {
      const byAmount = new Map<number, number[]>();
      for (const r of line.doses) {
        const times = byAmount.get(r.doseMg) ?? [];
        times.push(r.timeH);
        byAmount.set(r.doseMg, times);
      }
      return [...byAmount.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([doseMg, times]) => ({
          drugId: line.drug.id,
          doseMg,
          times: times.sort((a, b) => a - b),
        }));
    });

    const perMedicine = reports.map(
      ({ run, report }) =>
        `${run.name}: ${report.bullets.join("; ")}`
    );
    const summaryText = [
      isExample ? EXAMPLE_BANNER : "Parameters from reviewed, cited oral PK rows.",
      active.drugs.length > 1 ? SEPARATE_CURVES_CAPTION : "",
      reports[0].report.disclaimer,
      active.description.trim() ? `Case: ${active.description.trim()}` : "",
      `Saved peak metrics: ${primaryRun.name}.`,
      ...perMedicine,
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 1000);

    // The report schema carries one metrics object; it is the first
    // medicine's, and the summary names it — the panel never sums.
    const first = primaryRun.result;

    const { error } = await client.reports.saveReport({
      title: `${treatmentLabel} — ${new Date().toISOString().slice(0, 10)}`.slice(0, 100),
      profileSnapshot: {
        ageYears: active.ageYears,
        weightKg: active.weightKg,
        sex: active.sex,
      },
      drugs,
      metrics: {
        cmaxMgPerL: first.cmaxMgPerL,
        tmaxH: first.tmaxH,
        timeToClearH: first.timeToClearH,
      },
      // No verified interaction pairs exist yet. Sending [] is the honest value.
      warnings: [],
      summary: summaryText,
      summarySource: "template",
      engineVersion: "0.1.0",
    });
    setSaving(false);
    setAction(error ? `Save failed: ${error.message}` : "Report saved to your account.");
  }, [active, client, isExample, primaryRun, reports, saving, study, treatmentLabel]);

  const saveProfile = React.useCallback(async () => {
    if (!client) return;
    setProfileNotice(null);
    const { error } = await client.profile.saveProfile({
      ageYears: draft.ageYears,
      weightKg: draft.weightKg,
      sex: draft.sex,
    });
    setProfileNotice(error ? `Profile save failed: ${error.message}` : "Profile saved to your account.");
  }, [client, draft]);

  function replay() {
    setInspection(null);
    setProgress(0);
    setPlaying(true);
    studioRef.current?.scrollIntoView({ block: "start" });
    studioRef.current?.querySelector<HTMLElement>("[data-playback-control]")?.focus({ preventScroll: true });
  }

  function jumpToStage(next: number) {
    seek(next > 0 && next < finalStage ? next + TRAVEL_FRACTION : next);
  }

  const playLabel = finished ? "Replay" : playing ? "Pause" : progress > 0 ? "Resume" : "Play";
  const intro = !result;
  const currentStage = route && result
    ? <OrganDetail key={route} stage={stage} result={result} hours={hours} holding={motion.holding} playing={playing} />
    : (
      <div>
        <h2 className="mt-2 font-heading text-3xl">{finished ? "Journey complete" : "Follow the first dose"}</h2>
        <p className="mt-3 text-sm leading-6 text-ink-2">
          {finished ? "Review the concentration curve, model inputs and sources." : "Watch the marker travel. The camera stops at each organ for four seconds."}
        </p>
        {finished ? <div className="mt-4 flex flex-wrap gap-2"><PdfAction pdf={pdf} /><a onClick={() => setPlaying(false)} href="#simulation-results" className="theatre-button">Results <ArrowDown size={14} aria-hidden="true" /></a></div> : null}
      </div>
    );

  return (
    <div className="theatre">
      <TheatreNav onSetup={showInputs} />
      <main id="main" tabIndex={-1} className="theatre-main">
        {intro ? (
          <section className="theatre-hero" aria-labelledby="intro-title">
            <div className="theatre-intro">
              <p className="theatre-eyebrow">Anatomy Theatre</p>
              <h1 id="intro-title">Follow one dose <em>through the body.</em></h1>
              <p>Trace an oral dose through the gut, heart and lungs, and see how its modeled concentration changes over time.</p>
              <label htmlFor="study-case" className="mt-7 block text-xs font-medium text-ink">Study example</label>
              <select id="study-case" className="theatre-select mt-2 w-full max-w-[20rem]" value={studyId} onChange={(event) => setStudyId(event.target.value)}>
                {STUDY_CASES.map((item) => <option key={item.id} value={item.id}>{item.input.drugs[0].drug.name} · {item.doseLabel}</option>)}
              </select>
              <div className="mt-4 flex flex-wrap gap-2">
                <button type="button" className="theatre-button theatre-primary" onClick={() => start(chosenStudy.input)}>
                  <Play className="size-4 fill-current" aria-hidden="true" /> Start journey
                </button>
                <button type="button" className="theatre-button" onClick={showInputs}><SlidersHorizontal size={15} aria-hidden="true" /> Custom setup</button>
              </div>
              {simError ? <p role="alert" className="mt-3 text-sm text-warn">{simError}</p> : null}
            </div>
            <JourneyRail previewBrain={conditionById(chosenStudy.input.conditionId).organs.includes("brain")} />
          </section>
        ) : runs && primaryRun ? (
          <section ref={studioRef} aria-label="Guided simulation" className="theatre-workspace">
            <JourneyRail stages={stages} index={index} onSelect={jumpToStage} />
            <div className="theatre-stage" data-detail-side={detailOnRight ? "right" : "left"}>
              <h1 className="sr-only">Anatomy Theatre simulator</h1>
              <div className="theatre-canvas">
                <BodyFigure scene={scene} stageLabel={inspection ? null : route ? stage.label : null} onScene={setScene} onStatus={setSceneStatus} />
              </div>
              <div className="theatre-stage-detail theatre-surface">
                <p className="theatre-eyebrow">
                  {inspection ? `Inspecting ${inspection}` : route ? `Stage ${index} of ${finalStage - 1} · ${primaryRun.name}` : primaryRun.name}
                </p>
                {inspection ? (
                  <>
                    <h2 className="mt-2 font-heading text-3xl capitalize">{inspection}</h2>
                    <p className="mt-3 text-sm leading-6 text-ink-2">Anatomy inspection at {hours.toFixed(2)} h.</p>
                    <button type="button" className="theatre-button mt-4" onClick={() => setInspection(null)}>Back to journey</button>
                  </>
                ) : currentStage}
              </div>
            </div>
            <aside className="theatre-readout theatre-surface" aria-label="Model outputs">
              <p className="theatre-eyebrow">Model outputs</p>
              <h2 className="mt-2 font-heading text-[1.65rem]">{treatmentLabel}</h2>
              {previousStage?.route ? (
                <div className="theatre-previous"><OrganDetail key={previousStage.route} stage={previousStage} result={result} hours={previousStage.hours} holding previous playing={false} /></div>
              ) : <p className="my-3 text-xs leading-5 text-ink-2">The route is illustrative. The clock tracks modeled hours.</p>}
              {runs.length > 1 ? <p className="my-2 text-xs text-ink-2">The guided values are for {primaryRun.name}.</p> : null}
              <ConcentrationChart runs={runs} hours={hours} />
              <div className="mt-5 border-t border-line pt-3">
                <p className="mb-2 flex items-center gap-2 text-xs font-medium"><ScanLine size={14} aria-hidden="true" /> Inspect an organ</p>
                <div className="theatre-organ-buttons">
                  {(["gut", "heart", "lungs", "brain", "liver", "kidneys"] as const).map((organ) => (
                    <button type="button" key={organ} className="theatre-button capitalize" aria-pressed={inspection === organ}
                      onClick={() => { setPlaying(false); setInspection(inspection === organ ? null : organ); }}>{organ}</button>
                  ))}
                </div>
              </div>
            </aside>
            <div className="theatre-transport theatre-surface">
              <div className="theatre-transport-title">
                <p className="text-sm font-medium">{primaryRun.name}</p>
                <label className="flex flex-wrap items-center gap-2 text-xs text-ink-2">
                  Jump to stage
                  <select aria-label="Jump to stage" value={index} onChange={(event) => jumpToStage(Number(event.target.value))} className="theatre-select">
                    {stages.map((entry, i) => <option key={entry.label} value={i}>{entry.label}</option>)}
                  </select>
                </label>
              </div>
              <TimeDial maxH={active.tEndH} hours={hours} onHours={(next) => seek(progressAt(stages, next))}
                onTogglePlay={togglePlay} playLabel={playLabel} tmaxH={result.tmaxH} />
              <div className="theatre-transport-results">
                <a className="theatre-button" href="#simulation-results">Results <ArrowDown size={14} aria-hidden="true" /></a>
              </div>
            </div>
          </section>
        ) : null}

        {runs && primaryRun ? (
          <>
            <details className="theatre-surface theatre-monitor p-4" open={monitorOpen}
              onToggle={(event) => setMonitorOpen(event.currentTarget.open)}>
              <summary className="cursor-pointer font-medium">Organ monitor</summary>
              {monitorOpen ? (
                <OrganMonitor runs={runs} hours={hours} focus={inspection} onSelect={(organ) => {
                  setPlaying(false);
                  setInspection(inspection === organ ? null : organ);
                  studioRef.current?.scrollIntoView({ block: "start" });
                  studioRef.current?.querySelector<HTMLElement>("[data-playback-control]")?.focus({ preventScroll: true });
                }} />
              ) : null}
            </details>
            <RunResults runs={runs} primaryRun={primaryRun} active={active} study={study} isExample={isExample} treatmentLabel={treatmentLabel} pdf={pdf} onReplay={replay} />
            {!isExample ? (
              <details
                className="theatre-surface mt-3 p-4"
                onToggle={(event) => setShowLiterature(event.currentTarget.open)}
              >
                <summary className="cursor-pointer font-medium">Related literature for {stage?.label.toLowerCase() ?? "the overview"}</summary>
                {showLiterature ? <StepLiterature topic={topicForOrgan(inspection ?? focus)} drugs={stripDrugs} /> : null}
              </details>
            ) : null}
            {client ? (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                {signedInEmail && !study && !isExample ? (
                  <button type="button" className={buttonClass} onClick={() => void saveReport()} disabled={saving}>
                    <Save className="size-4" aria-hidden="true" /> {saving ? "Saving…" : "Save report to account"}
                  </button>
                ) : !signedInEmail && !study && !isExample ? (
                  <Link href="/signin" className="text-sm text-brand-text underline">Sign in to save to your account</Link>
                ) : null}
                {action ? <p role="status" className="text-sm text-ink-2">{action}</p> : null}
              </div>
            ) : null}
          </>
        ) : null}

        <section id="studies" className="theatre-studies" aria-labelledby="study-title">
          <div>
            <p className="theatre-eyebrow">Published research</p>
            <h2 id="study-title" className="mt-2 font-heading text-4xl">Study examples</h2>
          </div>
          <div className="theatre-study-grid">
            {STUDY_CASES.map((item) => {
              const drug = item.input.drugs[0].drug;
              return (
                <button key={item.id} type="button" className="theatre-surface study-card" aria-label={`Play ${drug.name}`} onClick={() => start(item.input)}>
                  <span className="min-w-0"><span className="block font-heading text-2xl">{drug.name}</span><span className="mt-1 block text-sm text-ink-2">{item.doseLabel}</span></span>
                  <ArrowUpRight size={18} aria-hidden="true" />
                </button>
              );
            })}
          </div>
        </section>
        <details ref={inputsRef} onToggle={(event) => { if (event.currentTarget.open) setPlaying(false); }} id="simulation-inputs" className="theatre-surface theatre-setup p-4 sm:p-6">
          <summary className="cursor-pointer font-heading text-lg font-semibold">Set up a custom simulation</summary>
          <div className="mt-4">
            <SimulatorConsole value={draft} onChange={setDraft} onSubmit={() => start(draft, true)} error={simError} />
            {client && signedInEmail ? (
              <button type="button" onClick={() => void saveProfile()} className={`${buttonClass} mt-3`}>Save profile</button>
            ) : null}
            {signedInEmail && profileNotice ? <p role="status" className="mt-3 text-sm text-ink-2">{profileNotice}</p> : null}
          </div>
        </details>

        <footer className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs text-ink-3">
          <Link href="/how-it-works" className="underline">How the model works</Link>
          <Link href="/about" className="underline">Anatomy credits</Link>
          <span>For education. Consult a clinician for medical decisions.</span>
        </footer>
      </main>
    </div>
  );
}
