import assert from "node:assert/strict";
import test from "node:test";
import {
  parseShadeVisionResult,
  reconcileShadeVision,
  validateShadeImageDataUrl,
} from "../src/lib/shade-vision.js";

function dataUrl(mime: "image/jpeg" | "image/png" | "image/webp", header: number[]) {
  const bytes = Buffer.alloc(700, 7);
  Buffer.from(header).copy(bytes);
  return `data:${mime};base64,${bytes.toString("base64")}`;
}

test("accepts only bounded image data with a matching signature", () => {
  const jpeg = dataUrl("image/jpeg", [0xff, 0xd8, 0xff]);
  assert.equal(validateShadeImageDataUrl(jpeg), jpeg);
  assert.equal(validateShadeImageDataUrl(jpeg.replace("image/jpeg", "image/png")), null);
  assert.equal(validateShadeImageDataUrl("data:text/plain;base64,SGVsbG8="), null);
  assert.equal(validateShadeImageDataUrl("https://example.com/customer-photo.jpg"), null);
});

test("parses strict model output and rejects invented shades", () => {
  assert.deepEqual(parseShadeVisionResult('{"shade":"dark_brown","confidence":0.91}'), {
    shade: "dark_brown",
    confidence: 0.91,
  });
  assert.deepEqual(parseShadeVisionResult('```json\n{"shade":"uncertain","confidence":2}\n```'), {
    shade: "uncertain",
    confidence: 1,
  });
  assert.equal(parseShadeVisionResult('{"shade":"caramel","confidence":0.9}'), null);
});

test("prevents highlighted dark hair from becoming light brown", () => {
  assert.deepEqual(
    reconcileShadeVision({ shade: "light_brown", confidence: 0.94 }, "dark_brown"),
    { shade: "uncertain", confidence: 0.94 },
  );
  assert.deepEqual(
    reconcileShadeVision({ shade: "dark_brown", confidence: 0.9 }, "light_brown"),
    { shade: "dark_brown", confidence: 0.9 },
  );
  assert.deepEqual(
    reconcileShadeVision({ shade: "black", confidence: 0.9 }, "dark_brown"),
    { shade: "dark_brown", confidence: 0.9 },
  );
});

test("sends low-confidence and conflicting results to manual selection", () => {
  assert.deepEqual(
    reconcileShadeVision({ shade: "dark_brown", confidence: 0.55 }, "dark_brown"),
    { shade: "uncertain", confidence: 0.55 },
  );
  assert.deepEqual(
    reconcileShadeVision({ shade: "wine_red", confidence: 0.8 }, "black"),
    { shade: "uncertain", confidence: 0.8 },
  );
});
