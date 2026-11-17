/**
 * The catalogue, read straight from the browser.
 *
 * This app deploys as a static site (GitHub Pages), so there is no app
 * server between the browser and the two things it needs to read:
 *
 * - Supabase (the catalogue): read with the anon key. Your RLS policies
 *   already make the catalogue publicly readable and the approved PK rows
 *   public; the browser key is the same one inlined everywhere else.
 * - Nothing here writes. The service key never ships.
 */

import type { DrugCatalogHit, DrugParameterCitation, DrugPkRow } from "@dib/data-client";
import { getBrowserDataClient } from "./browser-data-client";

export type CatalogueHit = DrugCatalogHit;

export type CatalogueSearch =
  | { hits: CatalogueHit[]; error: null }
  | { hits: null; error: "unconfigured" | "unreachable" };

export async function searchCatalogue(rawQuery: string, limit = 12): Promise<CatalogueSearch> {
  const q = rawQuery.trim().slice(0, 80);
  if (q.length < 2) return { hits: [], error: null };
  const c = getBrowserDataClient();
  if (!c) return { hits: null, error: "unconfigured" };
  const { data, error } = await c.drugs.searchDrugs(q, limit);
  if (error || data === null) return { hits: null, error: "unreachable" };
  return { hits: data, error: null };
}

export type CataloguePk = DrugPkRow;

/** The citation behind each value of a drug's parameters. */
export type CatalogueCitation = DrugParameterCitation;

/**
 * The citations for one drug's parameters.
 *
 * The public view only exposes an approved drug's citations, so a drug with no
 * approved row returns an empty list — which is the honest answer: a drug with
 * no approved parameters has nothing to cite.
 */
export async function getApprovedCitations(
  rawId: string
): Promise<CatalogueCitation[] | "error" | "unconfigured"> {
  const id = rawId.trim();
  if (!/^[a-z0-9][a-z0-9 ()/+-]{0,99}$/i.test(id)) return "error";
  const c = getBrowserDataClient();
  if (!c) return "unconfigured";
  const { data, error } = await c.drugs.getDrugCitations(id);
  if (error) return "error";
  return data ?? [];
}

export async function getApprovedPk(rawId: string): Promise<CataloguePk | null | "error" | "unconfigured"> {
  const id = rawId.trim();
  // Same exact-id rule the old API route enforced.
  if (!/^[a-z0-9][a-z0-9 ()/+-]{0,99}$/i.test(id)) return "error";
  const c = getBrowserDataClient();
  if (!c) return "unconfigured";
  const { data, error } = await c.drugs.getDrugPk(id);
  if (error) return "error";
  return data; // null when no approved row exists — that is a normal answer
}
