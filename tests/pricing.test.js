const test = require("node:test");
const assert = require("node:assert");
const { buildLines, computeTotals } = require("../src/services/pricing");

const B1 = "branch1", B2 = "branch2";
const jollof = {
  _id: "m1", name: "Jollof Rice", isActive: true, basePrice: 2500,
  variants: [{ name: "Regular", price: 2500 }, { name: "Large", price: 3500 }],
  addOns: [{ name: "Extra chicken", price: 1500 }, { name: "Takeaway pack", price: 200 }],
  branchAvailability: [],
};
const zobo = {
  _id: "m2", name: "Zobo", isActive: true, basePrice: 800, variants: [], addOns: [],
  branchAvailability: [{ branch: B1, isAvailable: true, priceOverride: 1000 }, { branch: B2, isAvailable: false }],
};
const menu = new Map([["m1", jollof], ["m2", zobo]]);

test("variant price is the full unit price, add-ons are added, qty multiplies", () => {
  const [l] = buildLines([{ menuItem: "m1", quantity: 2, variant: "Large", addOns: ["Extra chicken", "Takeaway pack"] }], menu, B1);
  assert.equal(l.unitPrice, 3500);
  assert.equal(l.lineTotal, (3500 + 1500 + 200) * 2);
});

test("client-sent prices are ignored", () => {
  const [l] = buildLines([{ menuItem: "m1", quantity: 1, variant: "Regular", price: 1, unitPrice: 1 }], menu, B1);
  assert.equal(l.unitPrice, 2500);
});

test("branch price override applies, unavailable branch is rejected", () => {
  assert.equal(buildLines([{ menuItem: "m2", quantity: 1 }], menu, B1)[0].unitPrice, 1000);
  assert.throws(() => buildLines([{ menuItem: "m2", quantity: 1 }], menu, B2), /not available/);
});

test("rejects missing variant, bad add-on, bad quantity, empty order, unknown item", () => {
  assert.throws(() => buildLines([{ menuItem: "m1", quantity: 1 }], menu, B1), /choose an option/i);
  assert.throws(() => buildLines([{ menuItem: "m1", quantity: 1, variant: "Regular", addOns: ["Gold"] }], menu, B1), /not available for/);
  assert.throws(() => buildLines([{ menuItem: "m1", quantity: 0, variant: "Regular" }], menu, B1), /Invalid quantity/);
  assert.throws(() => buildLines([{ menuItem: "m1", quantity: 1.5, variant: "Regular" }], menu, B1), /Invalid quantity/);
  assert.throws(() => buildLines([], menu, B1), /at least one item/);
  assert.throws(() => buildLines([{ menuItem: "zzz", quantity: 1 }], menu, B1), /not found/);
});

test("VAT exclusive: 7.5% added on food only, delivery fee untaxed", () => {
  const t = computeTotals({ lines: [{ lineTotal: 10000 }], vatRate: 0.075, vatMode: "exclusive", deliveryFee: 1000 });
  assert.deepEqual([t.subtotal, t.vat, t.total], [10000, 750, 11750]);
});

test("VAT inclusive: total does not increase, VAT portion is extracted", () => {
  const t = computeTotals({ lines: [{ lineTotal: 10750 }], vatRate: 0.075, vatMode: "inclusive", deliveryFee: 500 });
  assert.equal(t.vat, 750);
  assert.equal(t.total, 11250);
});

test("VAT none", () => {
  const t = computeTotals({ lines: [{ lineTotal: 3000 }], vatMode: "none", deliveryFee: 0 });
  assert.deepEqual([t.vat, t.total], [0, 3000]);
});
