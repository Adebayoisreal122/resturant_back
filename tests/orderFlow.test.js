const test = require("node:test");
const assert = require("node:assert");
const { checkTransition, nextStatus } = require("../src/services/orderFlow");

const staff = { _id: "s1", role: "worker" };
const manager = { _id: "m1", role: "branch_manager" };
const rider = { _id: "r1", role: "rider" };
const otherRider = { _id: "r2", role: "rider" };
const customer = { _id: "c1", role: "customer" };

const mk = (o) => ({ type: "delivery", status: "pending", payment: { method: "cash", status: "unpaid" }, delivery: {}, ...o });

test("delivery flow order", () => {
  assert.equal(nextStatus(mk({ status: "ready" })), "out_for_delivery");
  assert.equal(nextStatus(mk({ type: "takeaway", status: "ready" })), "completed");
});

test("cannot skip steps or go backwards", () => {
  assert.equal(checkTransition({ order: mk({ status: "pending" }), to: "ready", user: staff }).ok, false);
  assert.equal(checkTransition({ order: mk({ status: "ready" }), to: "preparing", user: staff }).ok, false);
});

test("staff can confirm/prepare; customer and rider cannot", () => {
  assert.equal(checkTransition({ order: mk(), to: "confirmed", user: staff }).ok, true);
  assert.equal(checkTransition({ order: mk(), to: "confirmed", user: customer }).ok, false);
  assert.equal(checkTransition({ order: mk({ status: "confirmed" }), to: "preparing", user: rider }).ok, false);
});

test("unpaid card order cannot be confirmed until paid", () => {
  const o = mk({ payment: { method: "card_online", status: "unpaid" } });
  assert.equal(checkTransition({ order: o, to: "confirmed", user: staff }).ok, false);
  o.payment.status = "paid";
  assert.equal(checkTransition({ order: o, to: "confirmed", user: staff }).ok, true);
});

test("only the assigned rider (or a manager) moves a delivery out and delivers it", () => {
  const o = mk({ status: "ready", delivery: { rider: "r1" } });
  assert.equal(checkTransition({ order: o, to: "out_for_delivery", user: rider }).ok, true);
  assert.equal(checkTransition({ order: o, to: "out_for_delivery", user: otherRider }).ok, false);
  assert.equal(checkTransition({ order: o, to: "out_for_delivery", user: manager }).ok, true);
  assert.equal(checkTransition({ order: mk({ status: "ready" }), to: "out_for_delivery", user: manager }).ok, false); // no rider
});

test("pay-on-delivery can be delivered unpaid; other unpaid orders cannot", () => {
  const pod = mk({ status: "out_for_delivery", delivery: { rider: "r1" }, payment: { method: "pay_on_delivery", status: "unpaid" } });
  assert.equal(checkTransition({ order: pod, to: "delivered", user: rider }).ok, true);
  const unpaid = mk({ status: "out_for_delivery", delivery: { rider: "r1" }, payment: { method: "transfer", status: "unpaid" } });
  assert.equal(checkTransition({ order: unpaid, to: "delivered", user: rider }).ok, false);
});

test("pickup/dine-in cannot complete until payment is recorded", () => {
  const o = mk({ type: "dine_in", status: "ready" });
  assert.equal(checkTransition({ order: o, to: "completed", user: staff }).ok, false);
  o.payment.status = "paid";
  assert.equal(checkTransition({ order: o, to: "completed", user: staff }).ok, true);
});

test("cancellation rules", () => {
  assert.equal(checkTransition({ order: mk({ status: "pending" }), to: "cancelled", user: customer }).ok, true);
  assert.equal(checkTransition({ order: mk({ status: "confirmed" }), to: "cancelled", user: customer }).ok, false);
  assert.equal(checkTransition({ order: mk({ status: "preparing" }), to: "cancelled", user: staff }).ok, true);
  assert.equal(checkTransition({ order: mk({ status: "ready" }), to: "cancelled", user: manager }).ok, false);
  assert.equal(checkTransition({ order: mk({ status: "pending" }), to: "cancelled", user: rider }).ok, false);
});
