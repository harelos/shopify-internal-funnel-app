import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const meta = readFileSync(path.join(root, "src/lib/meta-ads.ts"), "utf8");

test("a window with no ad delivery is zero spend, not missing spend", () => {
  // Meta returns an empty list, not a zero row, for a day nothing was
  // delivered yet; every "today" window looked broken until the first
  // impression was billed.
  const empty = meta.slice(meta.indexOf("if (!rows.length)"), meta.indexOf("if (!rows.length)") + 500);
  assert.match(empty, /amount: 0/);
  assert.match(empty, /quality: "ACTUAL"/);
  assert.doesNotMatch(empty, /return missing[(]/);
  // A malformed row is still refused rather than summed.
  assert.match(meta, /spends[.]some[(]value => !Number[.]isFinite[(]value[)] [|][|] value < 0[)]/);
});
