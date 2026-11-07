const test = require("node:test");
const assert = require("node:assert");
const { summarizeShift, computeVariance } = require("../src/services/shifts");
const { lagosRange } = require("../src/utils/dates");

test("expected cash includes the opening float; card/POD are not drawer money", () => {
  const r = summarizeShift({
    openingFloat: 10000,
    rows: [
      { _id: "cash", total: 45000, count: 9 },
      { _id: "transfer", total: 20000, count: 3 },
      { _id: "pos_terminal", total: 15000, count: 2 },
      { _id: "card_online", total: 99999, count: 7 },
      { _id: "pay_on_delivery", total: 88888, count: 5 },
    ],
  });
  assert.deepEqual(r.expected, { cash: 55000, transfer: 20000, pos_terminal: 15000 });
  assert.equal(r.totalSales, 80000);
  assert.equal(r.ordersCount, 14);
});

test("variance: short cash is negative, exact match has no variance", () => {
  const expected = { cash: 55000, transfer: 20000, pos_terminal: 15000 };
  const short = computeVariance({ cash: 54000, transfer: 20000, pos_terminal: 15000 }, expected);
  assert.equal(short.variance.cash, -1000);
  assert.equal(short.hasVariance, true);
  assert.equal(computeVariance({ cash: 55000, transfer: 20000, pos_terminal: 15000 }, expected).hasVariance, false);
  assert.equal(computeVariance({}, expected).variance.cash, -55000); // nothing declared = fully short
});

test("empty shift", () => {
  const r = summarizeShift({ openingFloat: 5000, rows: [] });
  assert.deepEqual(r.expected, { cash: 5000, transfer: 0, pos_terminal: 0 });
});

test("lagosRange: day boundaries are in Lagos time", () => {
  const r = lagosRange("2026-10-22", "2026-10-22");
  assert.equal(r.start.toISOString(), "2026-10-21T23:00:00.000Z");
  assert.equal(r.end.toISOString(), "2026-10-22T22:59:59.999Z");
});
test("lagosRange: defaults, single-sided, and bad input", () => {
  assert.ok(lagosRange());
  assert.equal(lagosRange("2026-10-05").to, "2026-10-05");
  assert.equal(lagosRange("nope", "2026-10-05"), null);
  assert.equal(lagosRange("2026-10-10", "2026-10-01"), null);
  assert.equal(lagosRange("2024-01-01", "2026-10-01"), null); // over a year
});
