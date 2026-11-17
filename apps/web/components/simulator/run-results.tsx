"use client";

import { memo, useEffect, useMemo, useState } from "react";
import { Download, RotateCcw } from "lucide-react";
import { buildReport } from "@dib/engine";
import { SEPARATE_CURVES_CAPTION } from "@/lib/treatment";
import { EXAMPLE_BANNER } from "@/lib/example-drug";
import { Sources } from "./console";
import { chartData, parameterRows, reportMetrics, type ReportData } from "./report-data";

type Pdf = {
  url: string | null;
  filename: string;
  error: boolean;
  retry: () => void;
};

export function useReportPdf(data: Omit<ReportData, "runs" | "primaryRun"> & {
  runs: ReportData["runs"] | null;
  primaryRun: ReportData["primaryRun"] | undefined;
}): Pdf {
  const { active, runs, primaryRun, stages, study, isExample, treatmentLabel } = data;
  const [pdf, setPdf] = useState<{ runs: typeof runs; url: string | null } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const slug = treatmentLabel.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "simulation";

  useEffect(() => {
    if (!runs || !primaryRun) return;
    let cancelled = false;
    let url: string | null = null;
    void import("./report-pdf")
      .then(({ generateReportPdf }) => {
        if (cancelled) return;
        url = URL.createObjectURL(generateReportPdf({ active, runs, primaryRun, stages, study, isExample, treatmentLabel }));
        setPdf({ runs, url });
      })
      .catch(() => { if (!cancelled) setPdf({ runs, url: null }); });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [active, attempt, isExample, primaryRun, runs, stages, study, treatmentLabel]);

  const current = pdf?.runs === runs ? pdf : null;
  return {
    url: current?.url ?? null,
    filename: `dib-${slug}-report.pdf`,
    error: current !== null && current.url === null,
    retry: () => { setPdf(null); setAttempt((value) => value + 1); },
  };
}

export function ConcentrationChart({ runs, hours }: Pick<ReportData, "runs"> & { hours?: number }) {
  const { duration, max, series } = useMemo(() => {
    const data = chartData(runs);
    return {
      ...data,
      series: data.series.map(({ points, ...line }) => ({
        ...line,
        path: points.map(([x, y]) => `${(x * 640).toFixed(2)},${(y * 150).toFixed(2)}`).join(" "),
      })),
    };
  }, [runs]);
  const cursor = hours === undefined ? null : 640 * Math.min(1, Math.max(0, hours / duration));
  return (
    <figure className="min-w-0">
      <figcaption className="mb-3 text-xs font-medium text-ink">Central concentration · mg/L</figcaption>
      <div className="grid grid-cols-[minmax(2rem,auto)_minmax(0,1fr)] gap-x-2 font-mono text-[10px] text-ink-3">
        <div aria-hidden="true" className="flex flex-col items-end justify-between tabular-nums">
          <span>{max.toPrecision(3)}</span><span>{(max / 2).toPrecision(3)}</span><span>0</span>
        </div>
        <svg viewBox="0 -2 640 154" preserveAspectRatio="none"
          className="concentration-plot w-full overflow-visible border-b border-l border-line-strong"
          role="img" aria-label={`Concentration curves for ${series.map(({ name }) => name).join(", ")}`}>
          <path d="M0 0H640M0 75H640" className="stroke-line" strokeDasharray="5 5" fill="none" />
          {series.map(({ id, path, color }) => (
            <polyline key={id} points={path} stroke={color} strokeWidth="2" vectorEffect="non-scaling-stroke" fill="none" />
          ))}
          {cursor === null ? null : (
            <path d={`M${cursor} 0V150`} stroke="var(--theatre-amber, #ffc18a)" vectorEffect="non-scaling-stroke" />
          )}
        </svg>
        <div className="col-start-2 flex justify-between pt-1 tabular-nums" aria-hidden="true">
          <span>0 h</span><span>{duration / 2} h</span><span>{duration} h</span>
        </div>
      </div>
      {series.length > 1 ? (
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-2 text-xs">
          {series.map(({ id, name, color }) => (
            <li key={id} className="flex items-center gap-2"><span className="h-0.5 w-4" style={{ background: color }} />{name}</li>
          ))}
        </ul>
      ) : null}
    </figure>
  );
}

export function PdfAction({ pdf }: { pdf: Pdf }) {
  if (pdf.url) {
    return <a href={pdf.url} download={pdf.filename} className="theatre-button theatre-primary"><Download className="size-4" aria-hidden="true" /> Download PDF</a>;
  }
  if (pdf.error) {
    return <button type="button" onClick={pdf.retry} className="theatre-button">Retry PDF</button>;
  }
  return <span role="status" className="text-sm text-ink-2">Preparing PDF…</span>;
}

const RunResults = memo(function RunResults({ pdf, onReplay, ...data }: Omit<ReportData, "stages"> & { pdf: Pdf; onReplay: () => void }) {
  const { active, isExample, runs, primaryRun, study, treatmentLabel } = data;
  const rows = parameterRows(data);
  const warnings = [...new Set(runs.flatMap(({ name, result }) => result.warnings.map((warning) => `${name}: ${warning}`)))];
  return (
    <section id="simulation-results" aria-labelledby="results-title" className="theatre-surface results-panel">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="theatre-eyebrow">{treatmentLabel} · {active.tEndH} h</p>
          <h2 id="results-title" className="mt-1 font-heading text-4xl">Simulation results</h2>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <PdfAction pdf={pdf} />
          <button type="button" className="theatre-button" onClick={onReplay}><RotateCcw className="size-4" aria-hidden="true" /> Replay</button>
        </div>
      </div>
      <div className="mt-7"><ConcentrationChart runs={runs} /></div>
      {runs.map(({ id, name, color, result }) => (
        <div key={id} className="mt-5">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><span className="size-2 rounded-full" style={{ background: color }} />{name}</h3>
          <dl className="grid gap-2 sm:grid-cols-3">
            {reportMetrics(result).map(({ label, value }) => (
              <div key={label} className="rounded-xl border border-line bg-page/65 p-3">
                <dt className="text-xs text-ink-2">{label}</dt>
                <dd className="mt-2 font-mono text-sm tabular-nums text-brand-text">{value}</dd>
              </div>
            ))}
          </dl>
        </div>
      ))}
      <p className="mt-3 text-xs text-ink-3">The 5% threshold applies after the final dose.{runs.length > 1 ? ` ${SEPARATE_CURVES_CAPTION}` : ""}</p>
      {warnings.length ? <ul className="mt-4 space-y-1 text-sm text-warn">{warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul> : null}
      <details open={Boolean(study)} className="mt-6 border-t border-line pt-4">
        <summary className="cursor-pointer font-medium">Doses, model inputs and sources</summary>
        <p className="mt-2 text-sm text-ink-2">
          {study ? "Fixed study estimates. Volume and clearance use the reported adult totals." : `Volume and clearance use the entered weight of ${active.weightKg} kg.`}
        </p>
        {rows.map((row) => (
          <div key={row.id} className="mt-3 rounded-xl border border-line bg-page/60 p-3">
            <h3 className="font-semibold">{row.name}</h3>
            <p className="mt-1 text-sm text-ink-2">{row.doses.join(" · ")}</p>
            <dl className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {row.parameters.map(({ label, value }) => (
                <div key={label}>
                  <dt className="text-xs text-ink-3">{label}</dt>
                  <dd className="font-mono text-sm tabular-nums text-brand-text">{value}</dd>
                </div>
              ))}
            </dl>
            <Sources citations={row.citations} />
            {row.notes ? <p className="mt-3 max-w-[78ch] text-sm leading-6 text-ink-2">{row.notes}</p> : null}
            <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {row.references.map(({ label, url }) => (
                <li key={url}><a href={url} target="_blank" rel="noreferrer" className="text-brand-text underline underline-offset-4">{label}</a></li>
              ))}
            </ul>
          </div>
        ))}
        {!study && active.description.trim() ? <p className="mt-3 whitespace-pre-wrap text-sm text-ink-2">{active.description}</p> : null}
      </details>
      <p className="mt-4 text-xs leading-5 text-ink-3">{isExample ? EXAMPLE_BANNER : buildReport(primaryRun.result).disclaimer}</p>
    </section>
  );
});

export default RunResults;
