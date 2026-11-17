/**
 * Typed access to the heart knowledge base in `apps/web/data/heart`.
 *
 * The JSON files are content, not code: they describe anatomy items, the
 * cardiac cycle, the blood path, drug effects, teaching conditions and quiz
 * questions. The 3D engine reads the same arrays, so a label, a mesh and an
 * info card can never drift apart.
 */

import anatomyJson from "@/data/heart/anatomy.json";
import circulationJson from "@/data/heart/circulation.json";
import conditionsJson from "@/data/heart/conditions.json";
import pharmacologyJson from "@/data/heart/pharmacology.json";
import physiologyJson from "@/data/heart/physiology.json";
import quizJson from "@/data/heart/quiz.json";

export type Oxygenation = "rich" | "poor";

export type Fact = readonly [label: string, value: string];

export type AnatomyItem = {
  id: string;
  name: string;
  group: string;
  parent: string | null;
  mesh: string;
  colour: string;
  description: string;
  facts: readonly Fact[];
  funFact: string;
};

export type CardiacPhase = {
  id: string;
  label: string;
  start: number;
  end: number;
  detail: string;
};

export type HeartSound = { id: string; at: number; label: string };
export type EcgWave = { wave: string; at: number; label: string };

export type Physiology = {
  cycle: {
    referenceHr: number;
    beatSeconds: number;
    systoleSeconds: number;
    diastoleSeconds: number;
    phases: CardiacPhase[];
    sounds: HeartSound[];
    ecg: EcgWave[];
  };
  volumes: {
    endDiastolicMl: number;
    endSystolicMl: number;
    strokeVolumeMl: number;
    ejectionFractionPct: number;
  };
  pressures: Record<string, number>;
  numbers: { label: string; value: string; note: string }[];
  presets: { id: string; label: string; hr: number; note: string }[];
};

export type BloodStation = {
  id: string;
  label: string;
  mesh: string;
  oxygen: Oxygenation;
  note: string;
};

export type DrugEffect = {
  organ: string;
  direction: string;
  note: string;
};

export type Drug = {
  id: string;
  name: string;
  class: string;
  summary: string;
  effects: DrugEffect[];
};

export type TeachingCondition = {
  id: string;
  name: string;
  summary: string;
  visual: string;
  effects: { label: string; value: string }[];
};

export type QuizQuestion = {
  id: string;
  question: string;
  options: string[];
  answer: number;
  explain: string;
};

// JSON imports widen the `facts` tuples to `string[][]`, so the cast goes
// through `unknown` rather than pretending the shapes already overlap.
export const anatomy = anatomyJson as unknown as {
  version: number;
  items: AnatomyItem[];
};
export const physiology = physiologyJson as unknown as Physiology;
export const circulation = circulationJson as {
  version: number;
  oxygenation: Record<Oxygenation, string>;
  bloodPath: BloodStation[];
  oralRoute: BloodStation[];
  notes: string[];
};
export const pharmacology = pharmacologyJson as {
  version: number;
  disclaimer: string;
  drugs: Drug[];
};
export const conditions = conditionsJson as {
  version: number;
  conditions: TeachingCondition[];
};
export const quiz = quizJson as { version: number; questions: QuizQuestion[] };

export const anatomyById = new Map(anatomy.items.map((item) => [item.id, item]));
export const anatomyByMesh = new Map(anatomy.items.map((item) => [item.mesh, item]));

export const anatomyGroups = Array.from(
  anatomy.items.reduce((groups, item) => {
    const list = groups.get(item.group) ?? [];
    list.push(item);
    groups.set(item.group, list);
    return groups;
  }, new Map<string, AnatomyItem[]>()),
  ([group, items]) => ({ group, items }),
);

export function anatomyChildren(parent: string | null): AnatomyItem[] {
  return anatomy.items.filter((item) => item.parent === parent);
}

export function findAnatomy(id: string | null | undefined): AnatomyItem | null {
  if (!id) return null;
  return anatomyById.get(id) ?? null;
}

export function findAnatomyByMesh(mesh: string): AnatomyItem | null {
  return anatomyByMesh.get(mesh) ?? null;
}

export const NOT_MEDICAL_ADVICE =
  "Educational animation only. Not medical advice, and no dosing information.";
