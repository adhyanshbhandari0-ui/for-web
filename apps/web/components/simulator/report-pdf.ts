import { buildReport } from "@dib/engine";
import { SEPARATE_CURVES_CAPTION } from "@/lib/treatment";
import { jsPDF } from "jspdf";
import { EXAMPLE_BANNER } from "@/lib/example-drug";
import { conditionById } from "./condition";
import { readMoment, ROUTE_COPY } from "./playback";
import { chartData, parameterRows, reportMetrics, type ReportData } from "./report-data";

const PAGE_WIDTH = 210;
const PAGE_HEIGHT = 297;
const MARGIN = 18;
const CONTENT = PAGE_WIDTH - 2 * MARGIN;
const FOOTER = 276;
const INK = "#152736";
const MUTED = "#435665";
const ACCENT = "#057787";
const RULE = "#d4dfe6";

const pdfText = (value: string) => value.replace(/[–—]/g, "-").replace(/[·•]/g, " | ").replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

export function generateReportPdf(data: ReportData): Blob {
  const { active, isExample, primaryRun, runs, stages, study, treatmentLabel } = data;
  const result = primaryRun.result;
  const warnings = [...new Set(runs.flatMap(({ name, result }) => result.warnings.map((warning) => `${name}: ${warning}`)))];
  const doc = new jsPDF({ format: "a4", unit: "mm", compress: true });
  doc.setProperties({ title: pdfText(`${treatmentLabel} | Drug-in-Body simulation`), subject: "Educational oral pharmacokinetic simulation" });
  let y = MARGIN;

  function reserve(height: number) {
    if (y + height <= FOOTER) return;
    doc.addPage();
    y = MARGIN;
  }

  function heading(text: string, size = 14) {
    reserve(17);
    doc.setFont("helvetica", "bold").setFontSize(size).setTextColor(INK);
    doc.text(text, MARGIN, y);
    y += size > 20 ? 10 : 7;
  }

  function paragraph(text: string, options: { url?: string; size?: number } = {}) {
    const { url, size = 10 } = options;
    const normalized = pdfText(text);
    const step = size * 0.49;
    doc.setFont("helvetica", "normal").setFontSize(size).setTextColor(url ? ACCENT : MUTED);

    // Helvetica has limited character coverage. Use the browser's font
    // fallback for text outside that coverage, such as a case note in Hindi.
    if (/[^\x00-\xff]/.test(normalized)) {
      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(CONTENT * 8);
      canvas.height = Math.ceil(step * 8);
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Unable to render report text");
      context.font = `${Math.round(size * 2.82)}px sans-serif`;
      context.fillStyle = url ? ACCENT : MUTED;
      context.textBaseline = "middle";
      const draw = (line: string) => {
        reserve(step);
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.fillText(line, 0, canvas.height / 2);
        doc.addImage(canvas, "PNG", MARGIN, y - step * 0.72, CONTENT, step);
        y += step;
      };
      for (const block of normalized.split("\n")) {
        let line = "";
        for (const word of block.split(/\s+/)) {
          const candidate = line ? `${line} ${word}` : word;
          if (context.measureText(candidate).width <= canvas.width) {
            line = candidate;
          } else {
            if (line) draw(line);
            line = "";
            for (const letter of word) {
              if (context.measureText(line + letter).width > canvas.width) {
                draw(line);
                line = "";
              }
              line += letter;
            }
          }
        }
        draw(line);
      }
    } else {
      const lines: string[] = doc.splitTextToSize(normalized, CONTENT);
      for (const line of lines) {
        reserve(step);
        if (url) doc.textWithLink(line, MARGIN, y, { url });
        else doc.text(line, MARGIN, y);
        y += step;
      }
    }
    y += 1.5;
  }

  paragraph("DRUG-IN-BODY  /  SIMULATION REPORT", { size: 10 });
  y += 3;
  if (/[^\x00-\xff]/.test(pdfText(treatmentLabel))) paragraph(treatmentLabel, { size: 22 });
  else heading(pdfText(treatmentLabel), 24);
  paragraph(`${active.tEndH} hours | Oral, one-compartment model | ${study ? "Research-based example" : isExample ? "Synthetic example" : "Custom simulation"}`);
  if (active.drugs.length > 1) paragraph(SEPARATE_CURVES_CAPTION);
  y += 5;

  for (const run of runs) {
    reserve(40);
    heading(pdfText(run.name), 12);
    const metrics = reportMetrics(run.result);
  const tileWidth = CONTENT / metrics.length;
  metrics.forEach(({ label, value }, index) => {
    const x = MARGIN + index * tileWidth;
    doc.setFillColor("#eff6f8").roundedRect(x, y - 3, tileWidth - 3, 19, 2, 2, "F");
    doc.setTextColor(MUTED).setFont("helvetica", "normal").setFontSize(9).text(label, x + 4, y + 3);
    doc.setTextColor(ACCENT).setFont("helvetica", "bold").setFontSize(13).text(value, x + 4, y + 10);
  });
    y += 23;
  }
  paragraph("The 5% threshold uses the sampled peak and applies after the final dose.", { size: 9 });
  y += 5;

  reserve(70 + 5 * runs.length);
  heading("Modeled central concentration (mg/L)");
  const chart = chartData(runs);
  const x = MARGIN + 14;
  const width = CONTENT - 16;
  const height = 46;
  doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(MUTED);
  for (const tick of [0, 0.5, 1]) {
    const tickY = y + tick * height;
    doc.setLineWidth(0.18).setDrawColor(RULE).line(x, tickY, x + width, tickY);
    doc.text((chart.max * (1 - tick)).toFixed(3), x - 2, tickY + 1, { align: "right" });
    doc.text(`${chart.duration * tick} h`, x + width * tick, y + height + 5, { align: "center" });
  }
  const pdfColors = [ACCENT, "#b4376e", "#977019", "#247959", "#7851a6"];
  chart.series.forEach(({ points }, index) => {
    const segments = points.slice(1).map(([px, py], i) => [
      (px - points[i][0]) * width,
      (py - points[i][1]) * height,
    ]);
    const [px, py] = points[0];
    doc.setDrawColor(pdfColors[index % pdfColors.length]).setLineWidth(0.55)
      .lines(segments, x + px * width, y + py * height);
  });
  y += height + 12;
  if (runs.length > 1) {
    runs.forEach(({ name }, index) => {
      doc.setDrawColor(pdfColors[index % pdfColors.length]).line(x, y - 1, x + 5, y - 1);
      doc.text(pdfText(name), x + 8, y);
      y += 5;
    });
  }
  y += 4;

  reserve(26 + 6 * stages.length);
  heading("Guided playback checkpoints");
  paragraph(primaryRun.name, { size: 9 });
  paragraph("Model values at arrival, held during each reading pause.", { size: 9 });
  const columns = [MARGIN + 3, 59, 83, 112, 135, 164];
  const tableLabels = ["Stage", "Time (h)", "Conc. (mg/L)", "Gut (mg)", "Central (mg)", "Elim. (mg/h)"];
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(INK);
  tableLabels.forEach((text, index) => doc.text(text, columns[index], y));
  y += 6;
  for (const [index, stage] of stages.entries()) {
    const moment = readMoment(result, stage.hours);
    const row = [stage.label, stage.hours.toFixed(2), moment.concMgPerL.toFixed(3), moment.gutMg.toFixed(1), moment.bodyMg.toFixed(1), moment.eliminationMgPerH.toFixed(2)];
    if (index % 2 === 0) doc.setFillColor("#eff6f8").rect(MARGIN, y - 4, CONTENT, 6, "F");
    doc.setTextColor(INK).setFont("helvetica", "normal").setFontSize(9);
    row.forEach((text, i) => doc.text(text, columns[i], y));
    y += 6;
  }
  y += 5;
  paragraph(isExample ? EXAMPLE_BANNER : buildReport(result).disclaimer, { size: 9 });

  y += 5;
  heading("Doses, model inputs and sources");
  const condition = conditionById(active.conditionId);
  paragraph(`Anatomy context: ${condition.label}`);
  if (study) paragraph("Fixed study estimates. The run uses the reported adult volume and clearance totals.");
  else paragraph(`Profile: ${active.ageYears} years, ${active.weightKg} kg, ${active.sex}. Volume and clearance scale with weight.`);
  if (!study && active.description.trim()) paragraph(`Case note: ${active.description.trim()}`);

  for (const row of parameterRows(data)) {
    y += 5;
    if (/[^\x00-\xff]/.test(pdfText(row.name))) paragraph(row.name, { size: 14 });
    else heading(row.name, 12);
    paragraph(`Oral doses: ${row.doses.join(", ")}`);
    paragraph(row.parameters.map(({ label, value }) => `${label}: ${value}`).join(" | "));
    if (row.notes) paragraph(row.notes);
    for (const citation of row.citations ?? []) {
      paragraph(`${citation.parameter} - ${citation.sourceTitle || citation.sourceUrl}`, { url: citation.sourceUrl, size: 9 });
    }
    for (const { label, url } of row.references) {
      paragraph(label, { url });
      paragraph(url, { url, size: 8 });
    }
  }

  if (warnings.length) {
    y += 4;
    heading("Run notes", 12);
    for (const warning of warnings) paragraph(warning);
  }
  y += 5;
  heading("First-dose route", 12);
  paragraph("The anatomy illustrates a common oral route. Checkpoint times and values come from the pharmacokinetic model.", { size: 9 });
  for (const stage of stages) {
    if (stage.route) paragraph(`${stage.label}: ${ROUTE_COPY[stage.route]}`, { size: 9 });
  }

  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page);
    doc.setLineWidth(0.22).setDrawColor(RULE).line(MARGIN, PAGE_HEIGHT - 15, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 15);
    doc.setFont("helvetica", "normal").setFontSize(8).setTextColor(MUTED);
    doc.text("Drug-in-Body Simulator", MARGIN, PAGE_HEIGHT - 9);
    doc.text(`${page} / ${pages}`, PAGE_WIDTH - MARGIN, PAGE_HEIGHT - 9, { align: "right" });
  }
  return doc.output("blob");
}
