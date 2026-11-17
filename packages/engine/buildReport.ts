import { SimResult, Report } from './types';

/**
 * Template-text report builder. No AI — pure templating from SimResult.
 * Always includes the fixed disclaimer. Never emits medical or dosing advice.
 */
export function buildReport(result: SimResult, warnings: string[] = []): Report {
  const fmt = (x: number | null, unit = '') => (x == null ? 'not reached within the simulated window' : `${x.toFixed(2)}${unit}`);

  const headline = 'Simulation complete';

  const bullets: string[] = [
    `Peak level (Cmax): ${result.cmaxMgPerL.toFixed(3)} mg/L`,
    `Time of peak (Tmax): ${fmt(result.tmaxH, ' h')}`,
    `Simulation time when concentration stays below 5% of the sampled peak after the final dose: ${fmt(result.timeToClearH, ' h')}`,
  ];
  for (const w of new Set([...result.warnings, ...warnings])) {
    bullets.push(`Note: ${w}`);
  }

  const disclaimer =
    'Educational simulator. Population-average estimate. Not medical or dosing advice.';

  return { headline, bullets, disclaimer };
}
