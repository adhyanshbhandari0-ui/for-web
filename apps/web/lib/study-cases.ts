import type { SimulatorInput } from "@/components/simulator/console";

const REFERENCE_WEIGHT_KG = 70;

export type StudyCase = {
  id: string;
  doseLabel: string;
  input: SimulatorInput;
  references: { label: string; url: string }[];
};

function makeStudyCase(
  id: string,
  name: string,
  conditionId: string,
  doseLabel: string,
  doseMg: number,
  times: number[],
  ka: number,
  volumeL: number,
  clearanceLPerH: number,
  notes: string,
  references: StudyCase["references"],
): StudyCase {
  return {
    id,
    doseLabel,
    references,
    input: {
      conditionId,
      description: notes,
      ageYears: 30,
      weightKg: REFERENCE_WEIGHT_KG,
      sex: "other",
      tEndH: 48,
      drugs: [{
        drug: {
          id,
          name,
          route: "oral",
          model: "one-compartment",
          ka_per_h: ka,
          F: 1,
          V_L_per_kg: volumeL / REFERENCE_WEIGHT_KG,
          CL_L_per_h_per_kg: clearanceLPerH / REFERENCE_WEIGHT_KG,
          studied_dose_range_mg: null,
          sources: references.map(({ url }) => url),
          notes,
        },
        doses: times.map((timeH) => ({ doseMg, timeH })),
      }],
    },
  };
}

export const STUDY_CASES = [
  makeStudyCase(
    "study-levetiracetam", "Levetiracetam", "neuro", "Single 500 mg dose", 500, [0],
    0.616, 34.7, 3.26,
    "The one-compartment fit comes from adult outpatients with refractory epilepsy. The study reports apparent volume (V/F) and clearance (CL/F). The tablet label reports F = 1. The simulator uses these values for one illustrative oral dose.",
    [
      { label: "Adult population PK study", url: "https://pergamos.lib.uoa.gr/uoa/dl/object/uoadl%3A3005353" },
      { label: "DailyMed levetiracetam label, section 12.3", url: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=08e1bfea-7f3f-42d9-823d-f75080e664ff" },
    ],
  ),
  makeStudyCase(
    "study-linezolid", "Linezolid", "infection", "600 mg at 0 and 24 hours", 600, [0, 24],
    1.5, 29.6, 0.25 * 29.6,
    "The model uses medians from the once-daily group in an adult pulmonary tuberculosis study. Clearance is derived as 0.25 per hour multiplied by 29.6 L. The oral label reports F near 1, modeled here as 1. The example spans two illustrative doses.",
    [
      { label: "Adult pulmonary tuberculosis PK study", url: "https://journals.asm.org/doi/10.1128/aac.01378-08" },
      { label: "DailyMed ZYVOX label, section 12.3", url: "https://dailymed.nlm.nih.gov/dailymed/drugInfo.cfm?setid=6e70e63b-bfd5-478d-a8ee-8ba22c9efabd" },
    ],
  ),
];
