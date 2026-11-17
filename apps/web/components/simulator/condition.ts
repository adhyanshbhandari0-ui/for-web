/**
 * What a condition touches, and what the model can honestly say about it.
 *
 * The engine is a one-compartment model: a dose goes into the gut, is
 * absorbed into a central compartment, and eliminated by first-order
 * clearance. The condition selects the stops in the anatomy walkthrough.
 *
 * Kept free of React and Three.js so it can be tested on its own.
 */

import type { FocusOrgan } from "./scene";

/**
 * A condition, and the organs it is about.
 *
 * The organs are where the condition is *felt or measured*, not where a drug
 * acts. Nothing here says a drug treats a condition; the simulator does not
 * know that.
 */
export type Condition = {
  id: string;
  label: string;
  /** One line, plain, no claims. */
  blurb: string;
  /** Organs associated with the condition. Playback orders the visits by model stage. */
  organs: FocusOrgan[];
};

export const CONDITIONS: Condition[] = [
  {
    id: "general",
    label: "General — no condition",
    blurb: "Follow the overview of absorption, concentration and elimination.",
    organs: ["gut", "heart", "liver", "kidneys"],
  },
  {
    id: "pain-fever",
    label: "Pain and fever",
    blurb: "Walk through the gut, circulation, liver and kidneys.",
    organs: ["gut", "heart", "liver", "kidneys"],
  },
  {
    id: "infection",
    label: "Infection",
    blurb: "Adds a lung view to the circulation stage.",
    organs: ["lungs", "heart", "liver", "kidneys"],
  },
  {
    id: "diabetes",
    label: "Diabetes",
    blurb: "The liver view illustrates total elimination from the model.",
    organs: ["liver", "heart", "kidneys"],
  },
  {
    id: "hypertension",
    label: "High blood pressure",
    blurb: "The heart view illustrates modeled central concentration.",
    organs: ["heart", "kidneys", "liver"],
  },
  {
    id: "asthma",
    label: "Asthma",
    blurb: "Adds a lung view to the circulation stage.",
    organs: ["lungs", "heart", "liver"],
  },
  {
    id: "neuro",
    label: "Neurological — headache, epilepsy",
    blurb: "Adds a brain anatomy view during circulation.",
    organs: ["brain", "heart", "liver"],
  },
  {
    id: "liver",
    label: "Liver and digestion",
    blurb: "The guide visits the gut during absorption and the liver during elimination.",
    organs: ["liver", "gut", "kidneys"],
  },
  {
    id: "kidney",
    label: "Kidney disease",
    blurb: "The kidney view illustrates total elimination from the model.",
    organs: ["kidneys", "liver", "heart"],
  },
];

/** The condition with this id, or the general one. */
export function conditionById(id: string): Condition {
  return CONDITIONS.find((c) => c.id === id) ?? CONDITIONS[0];
}

/** The organs the walkthrough visits, for a condition. */
export function organsFor(condition: Condition): FocusOrgan[] {
  return condition.organs;
}

/* ------------------------------------------------------------------ */
/* Narration                                                          */
/* ------------------------------------------------------------------ */

/** The engine's numbers at one moment. */
export type SimMoment = {
  /** Hours since simulation start. */
  hours: number;
  /** What is still sitting in the gut, in mg. */
  gutMg: number;
  /** Amount in the model's central compartment, in mg. */
  bodyMg: number;
  /** Blood concentration, mg/L. */
  concMgPerL: number;
  /** How fast the body is clearing, mg/h. */
  eliminationMgPerH: number;
};

export type Narration = {
  /** The organ this step is about, or null for the whole body. */
  organ: FocusOrgan | null;
  /** The heading. */
  title: string;
  /** The paragraph under it. */
  body: string;
  /** Two or three numbers, labelled. */
  figures: Array<{ label: string; value: string }>;
  /**
   * Several medicines in the treatment: their own numbers, one group per
   * medicine, never a summed set. Present only when the treatment holds
   * more than one simulatable medicine.
   */
  groups?: Array<{
    name: string;
    color: string;
    figures: Array<{ label: string; value: string }>;
  }>;
};

/** One medicine's own moment — what a walkthrough group carries. */
export type MedicationBreakdown = {
  name: string;
  color: string;
  moment: SimMoment;
};

/** What each organ is, in the model's own terms. */
const ORGAN_TITLE: Record<FocusOrgan, string> = {
  gut: "The gut — where the dose starts",
  heart: "Heart and circulation",
  lungs: "Lungs",
  liver: "Liver",
  kidneys: "Kidneys",
  brain: "Brain",
};

/**
 * The prose and figures for one organ at one moment.
 *
 * Every number is the engine's. The wording says what the model does, not
 * what the drug treats — the model does not know that.
 */
function organContent(
  organ: FocusOrgan | null,
  moment: SimMoment,
): Pick<Narration, "body" | "figures"> {
  const f = (x: number, digits = 1) => x.toFixed(digits);
  const concentration = `${f(moment.concMgPerL, 3)} mg/L`;
  const centralAmount = `${f(moment.bodyMg)} mg`;
  const elimination = `${f(moment.eliminationMgPerH, 2)} mg/h`;
  const exposure = [
    { label: "Concentration", value: concentration },
    { label: "Central amount", value: centralAmount },
  ];
  const clearance = [
    { label: "Total elimination rate", value: elimination },
    { label: "Central amount", value: centralAmount },
  ];

  if (!organ) {
    return {
      body:
        `At ${f(moment.hours, 2)} h the central compartment holds ${centralAmount} at ${concentration}. ` +
        `The modeled elimination rate is ${elimination}. The selected condition changes the organs shown in the walkthrough.`,
      figures: exposure,
    };
  }

  switch (organ) {
    case "gut":
      return {
        body: "Oral doses enter the gut depot. Absorption moves drug from the depot into the central compartment.",
        figures: [
          { label: "In the gut", value: `${f(moment.gutMg)} mg` },
          { label: "Central amount", value: centralAmount },
        ],
      };
    case "heart":
      return {
        body:
          "The heart highlight follows the modeled central concentration relative to its peak.",
        figures: exposure,
      };
    case "lungs":
      return {
        body:
          "The lungs share the circulation highlight. The values come from the model's central compartment.",
        figures: exposure,
      };
    case "liver":
      return {
        body:
          "The liver highlight follows the model's total elimination rate. The engine uses one clearance term per medicine.",
        figures: clearance,
      };
    case "kidneys":
      return {
        body:
          "The kidneys share the total elimination highlight. The model groups renal and other elimination into one term per medicine.",
        figures: clearance,
      };
    case "brain":
    default:
      return {
        body:
          "The brain view is an anatomy reference. The values below describe the model's central compartment.",
        figures: exposure,
      };
  }
}

/** The title of a step with no medicine and no organ to name. */
const WHOLE_BODY_TITLE = "The whole body — one pool of blood";

const MULTI_BODY: Record<string, string> = {
  none:
    "Each medicine in this treatment has its own curve through the same blood. " +
    "The model does not know how they act together. Interactions are not modelled.",
  gut:
    "Each medicine is taken up from the gut at its own rate into its own pool. " +
    "Each gut depot drains at its own absorption rate. Interactions are not modelled.",
  heart:
    "The same blood carries every medicine. The figures are per medicine, never a sum. Interactions are not modelled.",
  lungs:
    "One blood pool per medicine, one lung — no separate lung compartment. Interactions are not modelled.",
  liver:
    "Clearance is computed per medicine from its own parameters. There is no combined clearing. Interactions are not modelled.",
  kidneys:
    "One clearance term per medicine; never one number for the treatment. Interactions are not modelled.",
  brain:
    "The brain is supplied by the same blood, per medicine, with no model of the blood–brain barrier. Interactions are not modelled.",
};

/**
 * The narration for one step.
 *
 * With one medicine this is exactly the single-medicine design. With several,
 * the numbers travel as one group per medicine — nothing is summed across
 * drugs, because summing milligrams of different drugs is not a
 * pharmacological quantity.
 */
export function narrate(
  organ: FocusOrgan | null,
  moment: SimMoment,
  _condition?: Condition,
  breakdown?: MedicationBreakdown[]
): Narration {
  if (!breakdown || breakdown.length <= 1) {
    const content = organContent(organ, moment);
    return {
      organ,
      title: organ ? ORGAN_TITLE[organ] : WHOLE_BODY_TITLE,
      ...content,
    };
  }
  const groups = breakdown.map((b) => {
    const { figures } = organContent(organ, b.moment);
    return { name: b.name, color: b.color, figures };
  });
  const title = organ ? ORGAN_TITLE[organ] : WHOLE_BODY_TITLE;
  return {
    organ,
    title,
    body: MULTI_BODY[organ ?? "none"] ?? MULTI_BODY.none,
    figures: [],
    groups,
  };
}

/**
 * The organ levels to draw, from one moment of the simulation.
 *
 * Each quantity is normalised against its own maximum over the run: the
 * blood against the peak concentration, the clearance against the peak
 * clearance. Comparing a clearance rate with a concentration would be
 * comparing two different things, and the organ would read full when it was
 * not.
 *
 */
export function levelsFor(
  moment: SimMoment,
  peaks: { concMgPerL: number; eliminationMgPerH: number; gutMg?: number }
): Record<string, number> {
  const blood = Math.min(1, moment.concMgPerL / Math.max(peaks.concMgPerL, 1e-9));
  const clearance = Math.min(
    1,
    moment.eliminationMgPerH / Math.max(peaks.eliminationMgPerH, 1e-9)
  );

  return {
    // The blood group: the heart, the lungs, the vessels.
    heart: blood,
    lungs: blood,
    gut: Math.min(1, moment.gutMg / Math.max(peaks.gutMg ?? 0, 1e-9)),
    // Clearance: the liver and the kidneys.
    liver: clearance,
    kidneys: clearance,
  };
}

/**
 * Reads the engine's series at one hour.
 *
 * Use the latest sample through that hour so a dose never appears early.
 */
export function momentAt(
  tH: number[],
  gutMg: number[],
  bodyMg: number[],
  concMgPerL: number[],
  eliminationMgPerH: number[],
  hours: number
): SimMoment {
  if (tH.length === 0) {
    return { hours: 0, gutMg: 0, bodyMg: 0, concMgPerL: 0, eliminationMgPerH: 0 };
  }
  const index = Math.max(0, tH.findLastIndex((time) => time <= hours + 1e-12));
  return {
    hours: tH[index],
    gutMg: gutMg[index] ?? 0,
    bodyMg: bodyMg[index] ?? 0,
    concMgPerL: concMgPerL[index] ?? 0,
    eliminationMgPerH: eliminationMgPerH[index] ?? 0,
  };
}
