import assert from "node:assert/strict";
import test from "node:test";
import { findOrCreateVisitorWithStore } from "../src/lib/visitor-store.ts";

test("returns an existing visitor without writing", async () => {
  let creates = 0;
  const visitor = await findOrCreateVisitorWithStore({
    findUnique: async () => ({ id: "visitor-existing" }),
    create: async () => {
      creates += 1;
      return { id: "visitor-created" };
    },
  }, "shop-1", "visitor-key");

  assert.equal(visitor.id, "visitor-existing");
  assert.equal(creates, 0);
});

test("recovers the visitor when a concurrent create wins the D1 race", async () => {
  let reads = 0;
  const visitor = await findOrCreateVisitorWithStore({
    findUnique: async () => {
      reads += 1;
      return reads === 1 ? null : { id: "visitor-from-concurrent-request" };
    },
    create: async () => {
      throw new Error("UNIQUE constraint failed: Visitor.shopId, Visitor.anonymousKeyHash");
    },
  }, "shop-1", "visitor-key");

  assert.equal(visitor.id, "visitor-from-concurrent-request");
  assert.equal(reads, 2);
});

test("rethrows a create failure when no concurrent visitor exists", async () => {
  await assert.rejects(
    findOrCreateVisitorWithStore({
      findUnique: async () => null,
      create: async () => {
        throw new Error("database unavailable");
      },
    }, "shop-1", "visitor-key"),
    /database unavailable/,
  );
});
