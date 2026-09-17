import assert from "node:assert/strict";
import test from "node:test";
import { createEventOnceWithStore } from "../src/lib/event-store.ts";

test("returns an existing event as a duplicate without writing", async () => {
  let creates = 0;
  const result = await createEventOnceWithStore({
    findUnique: async () => ({ id: "event-existing" }),
    create: async () => {
      creates += 1;
      return { id: "event-created" };
    },
  }, "event-key", { eventKey: "event-key" });

  assert.equal(result.event.id, "event-existing");
  assert.equal(result.duplicate, true);
  assert.equal(creates, 0);
});

test("recovers the event when a concurrent create wins the D1 race", async () => {
  let reads = 0;
  const result = await createEventOnceWithStore({
    findUnique: async () => {
      reads += 1;
      return reads === 1 ? null : { id: "event-from-concurrent-request" };
    },
    create: async () => {
      throw new Error("UNIQUE constraint failed: Event.eventKey");
    },
  }, "event-key", { eventKey: "event-key" });

  assert.equal(result.event.id, "event-from-concurrent-request");
  assert.equal(result.duplicate, true);
  assert.equal(reads, 2);
});

test("rethrows an event write failure when no concurrent record exists", async () => {
  await assert.rejects(
    createEventOnceWithStore({
      findUnique: async () => null,
      create: async () => {
        throw new Error("database unavailable");
      },
    }, "event-key", { eventKey: "event-key" }),
    /database unavailable/,
  );
});
