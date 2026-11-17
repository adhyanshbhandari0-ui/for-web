import { SimInput, SimResult, DoseEvent } from './types';
import { curveMetrics, sampleTimes } from './curve';

/**
 * One-compartment model with gut depot and first-order absorption:
 *   dAg/dt = -ka * Ag
 *   dA/dt  = F * ka * Ag - (CL/V) * A
 *   C = A / V
 *
 * SCALING ASSUMPTION (documented per TRD): parameter fields are stored per kg
 * of body weight, so
 *   V  = V_L_per_kg          * weightKg
 *   CL = CL_L_per_h_per_kg   * weightKg
 * and the elimination rate constant is ke = CL / V. Age or sex effects are
 * only applied when a data source supports them; none are used here yet.
 *
 * Doses are injected into the gut depot at their event time (stepped through
 * in time order). RK4 splits steps at dose events and emits samples on a
 * shared output grid (default 0.05 h).
 */
export function simulate(input: SimInput): SimResult {
  // ---- validation ---------------------------------------------------------
  if (!input || typeof input !== 'object') {
    throw new Error('simulate: input object is required');
  }
  const { profile, drug, doses, tEndH } = input;
  const dtH = input.dtH ?? 0.05;

  if (!profile || typeof profile.weightKg !== 'number' || !Number.isFinite(profile.weightKg) || profile.weightKg <= 0) {
    throw new Error('simulate: profile.weightKg must be a finite number greater than 0');
  }
  if (!drug || !drug.name || !drug.id) {
    throw new Error('simulate: unknown drug (drug with non-empty id and name is required)');
  }
  if (drug.route !== 'oral') throw new Error('simulate: only the oral route is supported');
  if (!Array.isArray(doses)) {
    throw new Error('simulate: doses must be an array');
  }
  for (const d of doses) {
    if (typeof d.doseMg !== 'number' || !Number.isFinite(d.doseMg) || d.doseMg < 0) {
      throw new Error(`simulate: negative or invalid dose (${d.doseMg} mg)`);
    }
    if (typeof d.timeH !== 'number' || !Number.isFinite(d.timeH) || d.timeH < 0) {
      throw new Error(`simulate: invalid dose time (${d.timeH})`);
    }
    if (d.drugId !== drug.id) throw new Error('simulate: dose drug ID must match the simulated drug');
  }
  const tOut = sampleTimes(tEndH, dtH, input.sampleAtH);

  const warnings: string[] = [];
  if (drug.studied_dose_range_mg) {
    const [min, max] = drug.studied_dose_range_mg as [number, number];
    for (const d of doses) {
      if (d.doseMg < min || d.doseMg > max) {
        warnings.push(
          `Dose ${d.doseMg} mg at t=${d.timeH} h is outside the range the source studied ${min}–${max} mg for ${drug.name}.`
        );
      }
    }
  }

  // ---- model selection ----------------------------------------------------
  if (drug.model === 'two-compartment') {
    if (drug.k12 == null || drug.k21 == null) {
      throw new Error('simulate: two-compartment model requires k12 and k21');
    }
    throw new Error('simulate: two-compartment model is not implemented yet');
  }
  if (drug.model !== 'one-compartment') {
    throw new Error(`simulate: unknown drug model "${drug.model}"`);
  }

  const { ka_per_h: ka, F, V_L_per_kg: vPerKg, CL_L_per_h_per_kg: clPerKg } = drug;
  if (ka == null || F == null || vPerKg == null || clPerKg == null) {
    throw new Error(
      `simulate: drug parameters missing for ${drug.name} — ka_per_h, F, V_L_per_kg and CL_L_per_h_per_kg are required (TODO: source from PK-DB / label)`
    );
  }
  if (!Number.isFinite(ka) || ka <= 0) throw new Error('simulate: ka_per_h must be a finite number > 0');
  if (!Number.isFinite(vPerKg) || vPerKg <= 0) throw new Error('simulate: V_L_per_kg must be a finite number > 0');
  if (!Number.isFinite(clPerKg) || clPerKg < 0) throw new Error('simulate: CL_L_per_h_per_kg must be a finite number >= 0');
  if (!Number.isFinite(F) || F <= 0 || F > 1) throw new Error('simulate: F (bioavailability) must be in (0, 1]');

  // ---- model parameters (per-kg scaling, see header comment) ---------------
  const V = vPerKg * profile.weightKg; // L
  const CL = clPerKg * profile.weightKg; // L/h
  const ke = CL / V; // 1/h
  if (!Number.isFinite(V) || V <= 0 || !Number.isFinite(ke)) {
    throw new Error('simulate: scaled volume and elimination rate must be finite');
  }

  // ---- integration --------------------------------------------------------
  const lag = drug.tlag_h ?? 0;
  if (!Number.isFinite(lag) || lag < 0) {
    throw new Error('simulate: tlag_h must be a finite number >= 0');
  }
  // Shift the gut event while retaining the original administration in the caller.
  const sorted: DoseEvent[] = doses.map((dose) => ({ ...dose, timeH: dose.timeH + lag }))
    .sort((a, b) => a.timeH - b.timeH);
  const applicable = sorted.filter((d) => d.timeH <= tEndH);
  for (const d of sorted.slice(applicable.length)) {
    warnings.push(
      `The gut event for a ${d.doseMg} mg dose at t=${d.timeH} h is outside the simulated window (0–${tEndH} h) and was not applied.`
    );
  }
  const gutOut: number[] = [];
  const bodyOut: number[] = [];
  const concOut: number[] = [];
  const elimOut: number[] = [];

  let Ag = 0; // gut depot (mg)
  let A = 0; // central compartment amount (mg)
  let doseIdx = 0;

  const record = () => {
    const concentration = A / V;
    const elimination = ke * A;
    if (![Ag, A, concentration, elimination].every(Number.isFinite)) {
      throw new Error('simulate: model values exceed the supported numeric range');
    }
    gutOut.push(Ag);
    bodyOut.push(A);
    concOut.push(concentration);
    elimOut.push(elimination);
  };

  const deriv = (gut: number, amt: number): [number, number] => {
    const dAg = -ka * gut;
    const dA = F * ka * gut - ke * amt;
    return [dAg, dA];
  };

  // RK4 is only stable while max(ka, ke) * h is small. Subdividing keeps the
  // output grid at dtH (so curves and tests do not change shape) while making
  // stiff parameters (e.g. ka = 60 /h) integrate instead of blowing up.
  const maxStableStep = 0.5 / Math.max(ka, ke);
  if (tOut.length + applicable.length + tEndH / maxStableStep > 1_000_000) {
    throw new Error('simulate: too many integration steps for these parameters and window');
  }

  let t = 0;
  const advanceTo = (target: number) => {
    const step = target - t;
    if (step === 0) return;
    const substeps = Math.max(1, Math.ceil(step / maxStableStep));
    if (substeps > 10_000) {
      throw new Error('simulate: parameters too stiff for this step size — reduce dtH');
    }
    const h = step / substeps;

    for (let s = 0; s < substeps; s++) {
      const [k1g, k1a] = deriv(Ag, A);
      const [k2g, k2a] = deriv(Ag + (h / 2) * k1g, A + (h / 2) * k1a);
      const [k3g, k3a] = deriv(Ag + (h / 2) * k2g, A + (h / 2) * k2a);
      const [k4g, k4a] = deriv(Ag + h * k3g, A + h * k3a);

      Ag += (h / 6) * (k1g + 2 * k2g + 2 * k3g + k4g);
      A += (h / 6) * (k1a + 2 * k2a + 2 * k3a + k4a);
    }

    t = target;
  };

  let lastDoseH = -Infinity;
  for (const sample of tOut) {
    while (doseIdx < applicable.length && applicable[doseIdx].timeH <= sample) {
      const dose = applicable[doseIdx++];
      advanceTo(dose.timeH);
      Ag += dose.doseMg;
      if (dose.doseMg > 0) lastDoseH = dose.timeH;
    }
    advanceTo(sample);
    record();
  }

  return {
    tH: tOut,
    gutMg: gutOut,
    bodyMg: bodyOut,
    concMgPerL: concOut,
    eliminationMgPerH: elimOut,
    ...curveMetrics(tOut, concOut, lastDoseH),
    warnings,
  };
}
