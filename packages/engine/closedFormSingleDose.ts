import { SimInput, SimResult, DoseEvent } from './types';
import { curveMetrics, sampleTimes } from './curve';

/**
 * Analytic (closed-form) solution of the one-compartment oral model for a
 * SINGLE dose event — used only by tests as an independent check on
 * simulate(). Same per-kg scaling assumption as simulate().
 *
 * For a dose D entering the gut at time t0:
 *   Ag(t) = D * e^{-ka Δt}                                  t >= t0
 *   A(t)  = D * F*ka / (ka - ke) * (e^{-ke Δt} - e^{-ka Δt})
 * with the ka ≈ ke limiting case (no division by zero):
 *   A(t)  = D * F*ka * Δt * e^{-ka Δt}
 */
export function closedFormSingleDose(input: SimInput, dose?: DoseEvent): SimResult {
  const { profile, drug, tEndH } = input;
  const dtH = input.dtH ?? 0.05;
  const event = dose ?? (input.doses && input.doses[0]);
  if (!event) throw new Error('closedFormSingleDose: a dose event is required');
  if (input.doses && input.doses.length > 1) {
    throw new Error('closedFormSingleDose: call once per dose event (use closedFormDoses for superposition)');
  }

  if (!profile || typeof profile.weightKg !== 'number' || profile.weightKg <= 0) {
    throw new Error('closedFormSingleDose: profile.weightKg must be > 0');
  }
  if (!drug || !drug.name || !drug.id) throw new Error('closedFormSingleDose: unknown drug');
  if (event.doseMg < 0) throw new Error('closedFormSingleDose: dose must be non-negative');
  if (drug.ka_per_h == null || drug.V_L_per_kg == null || drug.CL_L_per_h_per_kg == null) {
    throw new Error('closedFormSingleDose: drug parameters missing (ka_per_h, V_L_per_kg, CL_L_per_h_per_kg)');
  }
  if (drug.model === 'two-compartment') {
    throw new Error('closedFormSingleDose: implemented for the one-compartment model only');
  }

  const ka = drug.ka_per_h;
  const F = drug.F ?? 1;
  const V = drug.V_L_per_kg * profile.weightKg; // L
  const ke = (drug.CL_L_per_h_per_kg * profile.weightKg) / V; // 1/h
  const tlag = drug.tlag_h ?? 0;
  if (!Number.isFinite(tlag) || tlag < 0) {
    throw new Error('closedFormSingleDose: tlag_h must be a finite number >= 0');
  }
  const gutEventH = event.timeH + tlag;

  const tOut = sampleTimes(tEndH, dtH, input.sampleAtH);
  const gutOut: number[] = [];
  const bodyOut: number[] = [];
  const concOut: number[] = [];
  const elimOut: number[] = [];

  for (const t of tOut) {
    const d = t - gutEventH;
    let gut: number;
    let amt: number;
    if (d < 0) {
      gut = 0;
      amt = 0;
    } else {
      gut = event.doseMg * Math.exp(-ka * d);
      if (Math.abs(ka - ke) < 1e-9) {
        amt = event.doseMg * F * ka * d * Math.exp(-ka * d); // amount (mg), ka == ke limit — no division by zero
      } else {
        amt = ((event.doseMg * F * ka) / (ka - ke)) * (Math.exp(-ke * d) - Math.exp(-ka * d)); // amount (mg)
      }
    }
    gutOut.push(gut);
    bodyOut.push(amt);
    concOut.push(amt / V);
    elimOut.push(ke * amt);
  }

  return {
    tH: tOut,
    gutMg: gutOut,
    bodyMg: bodyOut,
    concMgPerL: concOut,
    eliminationMgPerH: elimOut,
    ...curveMetrics(tOut, concOut, event.doseMg > 0 && gutEventH <= tEndH ? gutEventH : -Infinity),
    warnings: [],
  };
}

/** Sum of single-dose closed-form curves (exact for this linear model). */
export function closedFormDoses(input: SimInput): SimResult {
  if (!input.doses || input.doses.length === 0) {
    throw new Error('closedFormDoses: at least one dose event is required');
  }
  const parts = input.doses.map((d) => closedFormSingleDose({ ...input, doses: [d] }, d));
  const sumAt = (key: 'gutMg' | 'bodyMg' | 'concMgPerL' | 'eliminationMgPerH', i: number) =>
    parts.reduce((s, p) => s + p[key][i], 0);
  const { tH } = parts[0];
  const concMgPerL = tH.map((_, i) => sumAt('concMgPerL', i));
  const lag = input.drug.tlag_h ?? 0;
  const lastDoseH = input.doses.reduce((latest, dose) => {
    const gutEventH = dose.timeH + lag;
    return dose.doseMg > 0 && gutEventH <= input.tEndH ? Math.max(latest, gutEventH) : latest;
  }, -Infinity);

  return {
    tH,
    gutMg: tH.map((_, i) => sumAt('gutMg', i)),
    bodyMg: tH.map((_, i) => sumAt('bodyMg', i)),
    concMgPerL,
    eliminationMgPerH: tH.map((_, i) => sumAt('eliminationMgPerH', i)),
    ...curveMetrics(tH, concMgPerL, lastDoseH),
    warnings: [],
  };
}
