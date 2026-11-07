// Runs the real report pipelines against sample orders using mingo (an in-memory Mongo query engine).
const test = require("node:test");
const assert = require("node:assert");
const { Aggregator } = require("mingo");
const R = require("../src/services/reports");
const { lagosRange } = require("../src/utils/dates");

const range = lagosRange("2026-10-22", "2026-10-22");
const at = (iso) => new Date(iso);
const mk = (o) => ({ branch: "b1", type: "delivery", source: "online", status: "completed", subtotal: 0, vat: 0, deliveryFee: 0, discount: 0, total: 0, items: [], payment: { status: "paid", method: "cash" }, delivery: {}, createdAt: at("2026-10-22T10:00:00Z"), ...o });

const orders = [
  mk({ _id: 1, type: "dine_in", source: "pos", subtotal: 4000, vat: 300, total: 4300, createdAt: at("2026-10-22T09:00:00Z"), payment: { status: "paid", method: "cash", recordedBy: "w1" }, items: [{ name: "Jollof Rice", quantity: 2, lineTotal: 4000 }] }),
  mk({ _id: 2, subtotal: 6000, vat: 450, deliveryFee: 1000, total: 7450, payment: { status: "paid", method: "card_online" }, status: "delivered", delivery: { rider: "r1" }, items: [{ name: "Jollof Rice", quantity: 1, lineTotal: 2000 }, { name: "Fried Rice", quantity: 2, lineTotal: 4000 }] }),
  mk({ _id: 3, subtotal: 3000, vat: 225, deliveryFee: 500, total: 3725, payment: { status: "paid", method: "pay_on_delivery" }, status: "delivered", delivery: { rider: "r1", cashCollected: 4000, cashRemitted: false }, items: [{ name: "Fried Rice", quantity: 1, lineTotal: 3000 }] }),
  mk({ _id: 4, subtotal: 2000, vat: 150, deliveryFee: 500, total: 2650, payment: { status: "paid", method: "pay_on_delivery" }, status: "delivered", delivery: { rider: "r1", cashRemitted: true } }),
  mk({ _id: 5, total: 9999, status: "cancelled", payment: { status: "paid", method: "card_online" } }), // cancelled: no revenue
  mk({ _id: 6, total: 5555, status: "pending", payment: { status: "unpaid", method: "cash" } }), // unpaid: no revenue
  mk({ _id: 7, branch: "b2", total: 1000, subtotal: 1000, payment: { status: "paid", method: "cash" } }), // other branch
  mk({ _id: 8, total: 8888, createdAt: at("2026-10-20T10:00:00Z") }), // outside range
  // 23:30 UTC on the 21st is 00:30 on the 22nd in Lagos, so it belongs to the 22nd
  mk({ _id: 9, subtotal: 1000, total: 1000, createdAt: at("2026-10-21T23:30:00Z"), payment: { status: "paid", method: "transfer" } }),
];
const run = (pipeline, data = orders) => new Aggregator(pipeline).run(data);
const m = R.paidMatch({ branch: "b1", range });

test("totals count only paid, non-cancelled orders in range and branch", () => {
  const [t] = run(R.totals(m));
  assert.equal(t.orders, 5); // ids 1,2,3,4,9
  assert.equal(t.revenue, 4300 + 7450 + 3725 + 2650 + 1000);
  assert.equal(t.vat, 300 + 450 + 225 + 150);
  assert.equal(t.deliveryFees, 1000 + 500 + 500);
});

test("by payment method and type", () => {
  const byMethod = Object.fromEntries(run(R.groupBy(m, "payment.method")).map((r) => [r._id, r.revenue]));
  assert.deepEqual(byMethod, { cash: 4300, card_online: 7450, pay_on_delivery: 3725 + 2650, transfer: 1000 });
  const byType = Object.fromEntries(run(R.groupBy(m, "type")).map((r) => [r._id, r.orders]));
  assert.deepEqual(byType, { dine_in: 1, delivery: 4 });
});

test("daily grouping uses Lagos days", () => {
  const days = run(R.daily(R.paidMatch({ branch: "b1", range: lagosRange("2026-10-20", "2026-10-22") })));
  assert.deepEqual(days.map((d) => d._id), ["2026-10-20", "2026-10-22"]);
  assert.equal(days[1].orders, 5);
});

test("top items", () => {
  const items = run(R.topItems(m, 10));
  assert.deepEqual(items[0], { _id: "Fried Rice", quantity: 3, sales: 7000 });
  assert.equal(items.find((i) => i._id === "Jollof Rice").quantity, 3);
  assert.equal(run(R.topItems(m, 1)).length, 1);
});

test("status counts include cancelled and unpaid (all orders in range)", () => {
  const s = Object.fromEntries(run(R.statusCounts(R.anyMatch({ branch: "b1", range }))).map((r) => [r._id, r.count]));
  assert.equal(s.cancelled, 1);
  assert.equal(s.pending, 1);
});

test("staff report only includes payments recorded by a person", () => {
  const rows = run(R.byStaff(m));
  assert.deepEqual(rows, [{ _id: "w1", orders: 1, revenue: 4300 }]);
});

test("riders: deliveries, cash collected and cash not yet handed over", () => {
  const [r] = run(R.riders({ branch: "b1", range }));
  assert.equal(r._id, "r1");
  assert.equal(r.deliveries, 3);
  assert.equal(r.cashCollected, 3725 + 2650);
  assert.equal(r.cashNotRemitted, 3725); // order 4 already remitted
});

test("branch filter omitted = all branches", () => {
  const [t] = run(R.totals(R.paidMatch({ range })));
  assert.equal(t.orders, 6);
});
