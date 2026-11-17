/**
 * PubMed, called straight from the browser.
 *
 * The strip needs a handful of field-tagged queries — the fixed topic
 * queries and one drug query whose name comes from the catalogue. NCBI's
 * E-utilities is a public endpoint with open CORS (`esearch`/`esummary`),
 * so the static site can call it directly; there is no server in the loop,
 * and nothing here lets the request carry visitor-typed search text.
 *
 * The module caches per tab and spaces requests to respect NCBI's
 * anonymous limit when several walkthrough sections become visible.
 */

import {
  drugTopicQuery,
  parseSummary,
  TOPIC_QUERIES,
  topicForOrgan,
  type LiteratureResult,
  type LiteratureTopic,
} from "@/lib/pubmed";

const EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils";
const TOOL = "dib-literature-strip";
const SEARCH_HITS = 6;

export type DrugLiterature = {
  label: string | null;
  articles: LiteratureResult["articles"];
  error: "pubmed-unreachable" | "bad-drug-name" | null;
};

type CacheKey = string;
const cache = new Map<CacheKey, Promise<unknown>>();
let nextRequest = Promise.resolve();

function requestSlot(): Promise<void> {
  const slot = nextRequest;
  nextRequest = slot.then(() => new Promise((resolve) => setTimeout(resolve, 350)));
  return slot;
}

async function getJson(url: URL): Promise<unknown> {
  // One quiet retry: from a conference Wi-Fi or a laptop about to sleep,
  // a single miss is often a transient refusal rather than an outage.
  // The second failure is reported as unreachable — the step reads fine
  // without the strip.
  for (let attempt = 0; ; attempt++) {
    try {
      await requestSlot();
      const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
      if (!response.ok) throw new Error(`PubMed returned ${response.status}`);
      return await response.json();
    } catch (error) {
      if (attempt === 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 700));
    }
  }
}

function cached<T>(key: CacheKey, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  const pending = load().catch((error: unknown) => {
    cache.delete(key);
    throw error;
  });
  cache.set(key, pending);
  return pending;
}

async function articlesForQuery(query: string): Promise<LiteratureResult["articles"]> {
  const searchUrl = new URL(`${EUTILS}/esearch.fcgi`);
  searchUrl.search = new URLSearchParams({
    db: "pubmed",
    term: query,
    retmode: "json",
    retmax: String(SEARCH_HITS),
    sort: "relevance",
    tool: TOOL,
  }).toString();
  const search = (await getJson(searchUrl)) as { esearchresult?: { idlist?: string[] } };
  const pmids = search.esearchresult?.idlist ?? [];
  if (pmids.length === 0) return [];
  const summaryUrl = new URL(`${EUTILS}/esummary.fcgi`);
  summaryUrl.search = new URLSearchParams({
    db: "pubmed",
    id: pmids.join(","),
    retmode: "json",
    tool: TOOL,
  }).toString();
  const summary = await getJson(summaryUrl);
  return parseSummary("whole-body", summary).articles;
}

export async function fetchTopicLiterature(
  requested: string,
): Promise<{ label: string; articles: LiteratureResult["articles"]; error: "pubmed-unreachable" | null }> {
  const valid = Object.keys(TOPIC_QUERIES) as LiteratureTopic[];
  const topic: LiteratureTopic = valid.includes(requested as LiteratureTopic)
    ? (requested as LiteratureTopic)
    : topicForOrgan(null);
  try {
    const articles = await cached(`topic:${topic}`, () => articlesForQuery(TOPIC_QUERIES[topic]));
    return { label: topic, articles, error: null };
  } catch {
    return { label: topic, articles: [], error: "pubmed-unreachable" };
  }
}

export async function fetchDrugLiterature(catalogueName: string): Promise<DrugLiterature> {
  const name = catalogueName.trim();
  if (!name || /["\r\n]/.test(name)) {
    return { label: null, articles: [], error: "bad-drug-name" };
  }
  try {
    const articles = await cached(`drug:${name}`, () => articlesForQuery(drugTopicQuery(name)));
    return { label: name, articles, error: null };
  } catch {
    return { label: name, articles: [], error: "pubmed-unreachable" };
  }
}
