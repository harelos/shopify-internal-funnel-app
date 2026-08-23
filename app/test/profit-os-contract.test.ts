import test from "node:test";
import assert from "node:assert/strict";
import { computeProfitOsAggregate } from "../src/lib/profit-os-contract.js";

test("Profit OS fails closed when a required source is missing", () => {
  const result = computeProfitOsAggregate({
    contributionRevenueIls: 1000,
    cjTotalVariableCostIls: 250,
    paymentFeesIls: null,
    metaSpendIls: 300,
    orders: 10,
  });
  assert.equal(result.profitComplete, false);
  assert.equal(result.cm1, null);
  assert.equal(result.cm2, null);
});

test("Profit OS aggregate CM2 subtracts all scoped Meta spend", () => {
  const result = computeProfitOsAggregate({
    contributionRevenueIls: 1000,
    cjTotalVariableCostIls: 250,
    paymentFeesIls: 50,
    metaSpendIls: 300,
    orders: 10,
  });
  assert.equal(result.profitComplete, true);
  assert.equal(result.cm1, 700);
  assert.equal(result.cm2, 400);
  assert.equal(result.marginPct, 40);
  assert.equal(result.breakEvenCpa, 70);
  assert.equal(result.poas, 2.33);
});

test("Profit OS includes additional variable costs in CM1", () => {
  const result = computeProfitOsAggregate({
    contributionRevenueIls: 500,
    cjTotalVariableCostIls: 100,
    paymentFeesIls: 20,
    metaSpendIls: 150,
    additionalVariableCostsIls: 30,
    orders: 5,
  });
  assert.equal(result.cm1, 350);
  assert.equal(result.cm2, 200);
});
