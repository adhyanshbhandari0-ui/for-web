/**
 * Which catalogue drugs have a published reference checked by
 * `npm run validate:pk`. Mirrors data/validation.json — update both
 * together. Drugs without a reference show an honest badge in the UI so a
 * visitor never mistakes "simulated" for "checked against a published
 * curve".
 */
export const VALIDATION_STATUS: Record<string, "validated" | "failed" | "unvalidated"> = {
  acetaminophen: "validated", // Cmax 6.3% OK, tmax 13.3% OK vs DailyMed 0.75 h
  ibuprofen: "failed", // The sampled peak time exceeds the reference tolerance.
  caffeine: "unvalidated",
  amoxicillin: "unvalidated",
  gabapentin: "unvalidated",
};

export function isValidated(drugId: string): boolean {
  return VALIDATION_STATUS[drugId] === "validated";
}
