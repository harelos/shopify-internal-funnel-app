/**
 * Recognises the team's own traffic so it never counts as a customer.
 *
 * Twenty of a hundred and ten concierge sessions were internal testing that no
 * existing rule caught: the whole shade branch and most of the deep funnel were
 * the team, which made a dead path look like the strongest one. The UTM markers
 * that used to be the only signal are absent when someone simply opens the live
 * page, so an explicit marker and a small set of unmistakable typed answers are
 * both honoured.
 */

/** Setting this on the URL marks the browser internal for the whole session. */
export const INTERNAL_QUERY_FLAG = "fc_internal";

const MARKED_ATTRIBUTION = [
  "codex_qa",
  "production_test",
  "production_qa",
  "popup-qa",
  "concierge_email_release_",
];

// Words nobody types as their own name. Matched only where a name is expected,
// so a customer who uses the word in a sentence is never mislabelled.
const TEST_NAME_ANSWERS = new Set([
  "בדיקה", "בדיקה בדיקה", "בדיקה1", "בדיקה 1", "טסט", "בדיקת מערכת",
  "test", "testing", "qa", "asdf", "aaa", "123", "abc",
]);

export interface InternalTrafficInput {
  attribution?: Array<unknown>;
  query?: Record<string, unknown>;
  stepId?: unknown;
  freeText?: unknown;
  internalFlag?: unknown;
}

function normalise(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

function flagIsOn(value: unknown): boolean {
  const text = normalise(value);
  return text === "1" || text === "true" || text === "yes";
}

/** A name field is the only place a bare test word is unambiguous. */
export function isTestNameAnswer(stepId: unknown, freeText: unknown): boolean {
  if (normalise(stepId) !== "ask_name") return false;
  return TEST_NAME_ANSWERS.has(normalise(freeText));
}

export function looksLikeInternalTraffic(input: InternalTrafficInput): boolean {
  if (flagIsOn(input.internalFlag)) return true;
  if (input.query && flagIsOn(input.query[INTERNAL_QUERY_FLAG])) return true;

  const attribution = (input.attribution ?? []).filter(Boolean).map(normalise);
  if (attribution.some(value => MARKED_ATTRIBUTION.some(marker =>
    marker.endsWith("_") ? value.includes(marker) : value === marker || value.includes(marker)))) return true;

  // A page opened with the internal flag keeps it in the recorded path.
  if (attribution.some(value => value.includes(`${INTERNAL_QUERY_FLAG}=1`))) return true;

  return isTestNameAnswer(input.stepId, input.freeText);
}
