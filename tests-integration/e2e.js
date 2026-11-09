/* End-to-end check against a REAL running API + MongoDB.
   Usage:  API=http://localhost:5000/api MONGO_URI=... PAYSTACK_SECRET_KEY=... ADMIN_PHONE=... ADMIN_PASSWORD=... node tests-integration/e2e.js
   Uses a throwaway database: never point it at production data. */
const crypto = require("crypto");
const mongoose = require("mongoose");

const API = process.env.API || "http://localhost:5000/api";
const SECRET = process.env.PAYSTACK_SECRET_KEY;
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { cond ? pass++ : fail++; console.log(`${cond ? "PASS" : "FAIL"}  ${name}${cond ? "" : "  -> " + JSON.stringify(extra)}`); };

async function call(method, path, token, body, raw) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(API + path, { method, headers, body: raw ?? (body ? JSON.stringify(body) : undefined) });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}
const login = async (phone, password) => (await call("POST", "/auth/login", null, { phone, password })).body.accessToken;

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const Order = require("../src/models/Order");
  const run = Date.now().toString().slice(-6);
  const pw = "Passw0rd!x";

  // ---------- setup as admin ----------
  const admin = await login(process.env.ADMIN_PHONE, process.env.ADMIN_PASSWORD);
  ok(!!admin, "admin can log in");

  const b = await call("POST", "/branches", admin, { name: "Ibadan Bodija", code: "IKD", address: "12 Bodija Road", city: "Ibadan", phone: "08030000000",
    deliveryZones: [{ name: "Bodija", fee: 1000, estimatedMinutes: 30 }, { name: "Ring Road", fee: 1500, estimatedMinutes: 45 }] });
  ok(b.status === 201, "admin creates branch", b.body);
  const branchId = b.body.branch._id;
  const b2 = await call("POST", "/branches", admin, { name: "Lagos Ikeja", code: "LKJ", address: "5 Allen Ave" });
  const branch2 = b2.body.branch._id;

  const cat = (await call("POST", "/categories", admin, { name: "Rice " + run })).body.category;
  const cat2 = (await call("POST", "/categories", admin, { name: "Drinks " + run })).body.category;
  ok(!!cat?._id, "admin creates categories");

  const jollof = (await call("POST", "/menu", admin, { name: "Jollof Rice", category: cat._id, basePrice: 2500, tags: ["popular", "spicy"],
    variants: [{ name: "Regular", price: 2500 }, { name: "Large", price: 3500 }], addOns: [{ name: "Extra chicken", price: 1500 }] })).body.item;
  const zobo = (await call("POST", "/menu", admin, { name: "Zobo", category: cat2._id, basePrice: 800 })).body.item;
  ok(!!jollof?._id && !!zobo?._id, "admin creates menu items");

  const mk = async (role, extra = {}) => {
    const phone = `080${run}${Math.floor(10 + Math.random() * 89)}`.slice(0, 11);
    const r = await call("POST", "/users", admin, { name: role + " " + run, phone, password: pw, role, branch: branchId, ...extra });
    return { phone, res: r };
  };
  const mgr = await mk("branch_manager");
  const cashier = await mk("worker", { workerType: "cashier" });
  const rider = await mk("rider", { vehicle: "bike" });
  ok(mgr.res.status === 201 && cashier.res.status === 201 && rider.res.status === 201, "admin creates manager, cashier, rider", [mgr.res.body, cashier.res.body, rider.res.body]);
  const mgrT = await login(mgr.phone, pw), cashT = await login(cashier.phone, pw), ridT = await login(rider.phone, pw);
  const riderId = rider.res.body.user._id;

  const custPhone = `0803${run}0`.slice(0, 11);
  const reg = await call("POST", "/auth/register", null, { name: "Ade Customer", phone: custPhone, password: pw });
  ok(reg.status === 201, "customer registers", reg.body);
  const custT = reg.body.accessToken;

  // ---------- login rate limit: only failures count, per account ----------
  const victim = `0801${run}77`.slice(0, 11);
  const limitCodes = [];
  for (let i = 0; i < 11; i++) limitCodes.push((await call("POST", "/auth/login", null, { phone: victim, password: "wrong-password" })).status);
  ok(limitCodes.slice(0, 10).every((c) => c === 401) && limitCodes[10] === 429, "11th wrong password for one account is blocked (429)", limitCodes);
  for (let i = 0; i < 25; i++) await login(mgr.phone, pw);
  ok((await call("POST", "/auth/login", null, { phone: mgr.phone, password: pw })).status === 200, "25 successful logins from one address never get blocked");
  ok((await call("POST", "/auth/login", null, { phone: cashier.phone, password: pw })).status === 200, "other accounts are unaffected by one account's lockout");

  // ---------- permissions ----------
  ok((await call("POST", "/branches", custT, { name: "x", code: "XX", address: "y" })).status === 403, "customer cannot create branches");
  ok((await call("POST", "/users", mgrT, { name: "n", phone: "08099999999", password: pw, role: "super_admin" })).status === 403, "manager cannot create a super admin");
  ok((await call("GET", "/users", custT)).status === 403, "customer cannot list users");

  // ---------- menu ----------
  const menu = await call("GET", `/menu?branch=${branchId}`);
  ok(menu.body.items?.length === 2, "public menu lists both items for the branch", menu.body);

  // ---------- customer order: totals ----------
  const body = { branch: branchId, type: "delivery", items: [
      { menuItem: jollof._id, quantity: 2, variant: "Large", addOns: ["Extra chicken"] }, { menuItem: zobo._id, quantity: 1 }],
    delivery: { address: "10 Test Street, Bodija", zone: "Bodija" }, payment: { method: "card_online" }, price: 1 };
  const o1 = await call("POST", "/orders", custT, body);
  ok(o1.status === 201, "customer places delivery order", o1.body);
  const order1 = o1.body.order;
  ok(order1.subtotal === 10800 && order1.vat === 810 && order1.deliveryFee === 1000 && order1.total === 12610, "server prices: 10,800 + VAT 810 + delivery 1,000 = 12,610", order1);
  ok(/^IKD-\d{8}-0001$/.test(order1.orderNumber), "order number format", order1.orderNumber);
  ok((await call("POST", "/orders", custT, { ...body, type: "dine_in" })).status === 400, "customer cannot place dine-in");
  ok((await call("POST", "/orders", custT, { ...body, delivery: { address: "10 Test Street", zone: "Mars" } })).status === 400, "unknown delivery zone rejected");
  ok((await call("POST", "/orders", custT, { ...body, items: [{ menuItem: jollof._id, quantity: 1 }] })).status === 400, "variant is required for jollof");

  // ---------- Paystack webhook with a real DB ----------
  const ref = `${order1.orderNumber}-abc123`;
  await Order.updateOne({ _id: order1._id }, { $set: { "payment.references": [ref], "payment.reference": ref } });
  const evt = (amount, reference) => JSON.stringify({ event: "charge.success", data: { reference, status: "success", currency: "NGN", amount } });
  const hook = (raw, sig) => fetch(API + "/payments/paystack/webhook", { method: "POST", headers: { "Content-Type": "application/json", "x-paystack-signature": sig }, body: raw }).then((r) => r.status);
  const sign = (raw) => crypto.createHmac("sha512", SECRET).update(raw).digest("hex");

  ok((await hook(evt(1261000, ref), "bad")) === 401, "webhook: bad signature -> 401");
  let o = (await call("GET", `/orders/${order1._id}`, custT)).body.order;
  ok(o.payment.status === "unpaid", "webhook: bad signature did not mark paid");
  ok((await hook(evt(100, ref), sign(evt(100, ref)))) === 200, "webhook: wrong amount acknowledged");
  o = (await call("GET", `/orders/${order1._id}`, custT)).body.order;
  ok(o.payment.status === "unpaid", "webhook: wrong amount did NOT mark paid");
  const good = evt(1261000, ref);
  const codes = await Promise.all([hook(good, sign(good)), hook(good, sign(good)), hook(good, sign(good))]);
  ok(codes.every((c) => c === 200), "webhook: 3 simultaneous duplicate deliveries all return 200", codes);
  o = (await call("GET", `/orders/${order1._id}`, custT)).body.order;
  ok(o.payment.status === "paid" && o.payment.method === "card_online", "webhook: order is paid exactly once", o.payment);

  // ---------- status flow, scoping ----------
  const st = (id, token, status, extra = {}) => call("PATCH", `/orders/${id}/status`, token, { status, ...extra });
  ok((await st(order1._id, custT, "confirmed")).status === 403, "customer cannot confirm");
  ok((await st(order1._id, cashT, "ready")).status === 409, "cannot skip steps");
  ok((await st(order1._id, cashT, "confirmed")).status === 200, "cashier confirms paid order");
  ok((await st(order1._id, cashT, "preparing")).status === 200 && (await st(order1._id, cashT, "ready")).status === 200, "preparing -> ready");

  ok((await call("PATCH", `/riders/me/status`, ridT, { isOnline: true })).body.isOnline === true, "rider goes online");
  const avail = await call("GET", "/riders/available", cashT);
  ok(avail.body.riders?.some((r) => r._id === riderId), "online rider is listed as available", avail.body);
  ok((await call("PATCH", `/orders/${order1._id}/rider`, cashT, { riderId })).status === 200, "staff assigns rider");
  ok((await st(order1._id, ridT, "out_for_delivery")).status === 200, "rider picks up");
  ok((await st(order1._id, ridT, "delivered")).status === 200, "rider delivers (already paid online)");
  ok((await call("GET", "/orders", ridT)).body.total === 1, "rider sees only assigned orders");
  const today = new Date(Date.now() + 3600000).toISOString().slice(0, 10);
  ok((await call("GET", `/orders?from=${today}&to=${today}`, cashT)).body.total >= 1, "orders list: a single Lagos day (from=to=today) returns today's orders");
  ok((await call("GET", `/orders?from=2020-01-01&to=2020-01-01`, cashT)).body.total === 0, "orders list: a past day returns nothing");
  ok((await call("GET", `/orders?from=garbage`, cashT)).status === 400, "orders list: bad date rejected");
  ok((await call("GET", `/orders/${order1._id}`, (await call("POST", "/auth/register", null, { name: "Other", phone: `0805${run}1`.slice(0, 11), password: pw })).body.accessToken)).status === 404, "another customer cannot see the order");

  // ---------- shifts + POS ----------
  const pos = { type: "dine_in", tableNumber: "4", items: [{ menuItem: zobo._id, quantity: 3 }], payment: { method: "cash", paid: true } };
  ok((await call("POST", "/orders", cashT, pos)).status === 409, "cashier cannot take payment without an open shift");
  const sh = await call("POST", "/shifts/open", cashT, { openingFloat: 5000 });
  ok(sh.status === 201, "cashier opens shift", sh.body);
  ok((await call("POST", "/shifts/open", cashT, { openingFloat: 1 })).status === 409, "cannot open a second shift at once");
  const p1 = await call("POST", "/orders", cashT, pos);
  ok(p1.status === 201 && p1.body.order.status === "confirmed" && p1.body.order.payment.status === "paid", "POS order created, confirmed and paid", p1.body);
  ok(Math.abs(p1.body.order.total - 2580) < 0.001, "POS total = 2,400 + VAT 180 = 2,580", p1.body.order.total);

  // unpaid takeaway paid later by the cashier
  const tk = await call("POST", "/orders", cashT, { type: "takeaway", items: [{ menuItem: zobo._id, quantity: 1 }], payment: { method: "transfer" } });
  ok(tk.status === 201 && tk.body.order.payment.status === "unpaid", "POS takeaway starts unpaid");
  ok((await call("POST", `/orders/${tk.body.order._id}/payment`, cashT, { method: "transfer", reference: "TRF123" })).status === 200, "cashier records transfer");

  const cur = await call("GET", "/shifts/current", cashT);
  ok(cur.body.live?.expected.cash === 5000 + 2580 && cur.body.live?.expected.transfer === 860, "live shift figures: cash 7,580 and transfer 860", cur.body.live);
  const close = await call("POST", "/shifts/close", cashT, { declared: { cash: 7080, transfer: 860, pos_terminal: 0 } });
  ok(close.status === 200 && close.body.shift.variance.cash === -500 && close.body.shift.hasVariance === true, "closing records a -500 cash variance", close.body.shift);
  ok((await call("POST", "/shifts/close", cashT, { declared: {} })).status === 409, "cannot close twice");
  const sd = await call("GET", `/shifts/${close.body.shift._id}`, mgrT);
  ok(sd.status === 200 && sd.body.orders?.length >= 2 && sd.body.shift.cashier?.name, "branch manager can open a shift's details (with its payments)", sd.body.message);
  ok((await call("GET", `/shifts/${close.body.shift._id}`, cashT)).status === 200, "the cashier can open their own shift's details");
  ok((await call("GET", `/shifts/${close.body.shift._id}`, custT)).status === 403, "a customer cannot open shift details");
  ok((await call("PATCH", `/shifts/${close.body.shift._id}/review`, mgrT, { note: "Short by 500, warned" })).status === 200, "manager reviews the shift");

  // ---------- pay on delivery + rider cash ----------
  const pod = await call("POST", "/orders", custT, { ...body, price: undefined, payment: { method: "pay_on_delivery" }, items: [{ menuItem: zobo._id, quantity: 2 }] });
  const podId = pod.body.order._id; const podTotal = pod.body.order.total;
  await st(podId, cashT, "confirmed"); await st(podId, cashT, "preparing"); await st(podId, cashT, "ready");
  await call("PATCH", `/orders/${podId}/rider`, cashT, { riderId });
  await st(podId, ridT, "out_for_delivery");
  ok((await st(podId, ridT, "delivered")).status === 400, "rider must enter cash collected");
  ok((await st(podId, ridT, "delivered", { cashCollected: podTotal - 1 })).status === 400, "cash collected must cover the total");
  const dl = await st(podId, ridT, "delivered", { cashCollected: podTotal });
  ok(dl.status === 200 && dl.body.order.payment.status === "paid", "delivered, cash recorded and order marked paid", dl.body);
  const mine0 = await call("GET", "/riders/me/cash", ridT);
  ok(mine0.status === 200 && mine0.body.expected === podTotal && mine0.body.count === 1, "rider sees their own outstanding cash", mine0.body);
  ok((await call("GET", "/riders/me/cash", mgrT)).status === 403, "a manager is not a rider (403 on /riders/me/cash)");
  const sum0 = await call("GET", "/riders/cash", mgrT);
  ok(sum0.body.totalOwed === podTotal && sum0.body.riders[0]?.rider?.name && sum0.body.riders[0].count === 1, "manager sees who owes cash across the branch", sum0.body);
  const owed = await call("GET", `/riders/${riderId}/cash`, mgrT);
  ok(owed.body.expected === podTotal, "manager sees rider owes the order total", owed.body);
  const rem = await call("POST", `/riders/${riderId}/remit`, mgrT, { amountReceived: podTotal - 100 });
  ok(rem.status === 201 && rem.body.remittance.variance === -100, "remittance records a -100 shortage", rem.body);
  ok((await call("POST", `/riders/${riderId}/remit`, mgrT, { amountReceived: 1 })).status === 409, "nothing left to remit");
  ok((await call("GET", "/riders/remittances", mgrT)).body.remittances?.[0]?.variance === -100, "manager sees the remittance history with the shortage");
  ok((await call("GET", "/riders/remittances", custT)).status === 403, "customers cannot see remittances");

  // ---------- cancel + refund ----------
  const c1 = await call("POST", "/orders", custT, { ...body, price: undefined, payment: { method: "pay_on_delivery" }, items: [{ menuItem: zobo._id, quantity: 1 }] });
  ok((await call("PATCH", `/orders/${c1.body.order._id}/status`, custT, { status: "cancelled" })).status === 200, "customer cancels a pending order");
  const rf = await call("POST", `/orders/${p1.body.order._id}/refund`, mgrT, { manual: true });
  ok(rf.status === 409, "cannot refund an order that is not cancelled");

  // ---------- branch availability ----------
  ok((await call("PATCH", `/menu/${zobo._id}/branches/${branchId}`, mgrT, { isAvailable: false })).status === 200, "manager marks zobo sold out");
  const m1 = await call("GET", `/menu?branch=${branchId}`), m2 = await call("GET", `/menu?branch=${branch2}`);
  ok(!m1.body.items.some((i) => i.name === "Zobo") && m2.body.items.some((i) => i.name === "Zobo"), "sold out here, still available at the other branch", { m1: m1.body.items.length, m2: m2.body.items.length });
  ok((await call("POST", "/orders", custT, { ...body, price: undefined, items: [{ menuItem: zobo._id, quantity: 1 }] })).status === 400, "cannot order a sold-out item");
  ok((await call("PATCH", `/menu/${zobo._id}/branches/${branch2}`, mgrT, { isAvailable: false })).status === 403, "manager cannot change another branch");

  // ---------- reports ----------
  const rep = await call("GET", "/reports/summary", admin);
  ok(rep.status === 200 && rep.body.orders === 4, "summary counts 4 paid orders (online, POS, transfer, POD)", rep.body);
  ok(Math.abs(rep.body.revenue - (12610 + 2580 + 860 + podTotal)) < 0.01, "summary revenue adds up", rep.body.revenue);
  const daily = await call("GET", "/reports/daily", admin);
  ok(daily.body.days?.length === 1 && daily.body.days[0].orders === 4, "daily report groups into today (Lagos)", daily.body);
  ok((await call("GET", "/reports/top-items", admin)).body.items?.[0]?.quantity >= 2, "top items works");
  const rr = await call("GET", "/reports/riders", admin);
  ok(rr.body.riders?.[0]?.deliveries === 2, "riders report shows 2 deliveries", rr.body);
  ok((await call("GET", "/reports/branches", admin)).body.branches?.length === 1, "branch comparison works");
  ok((await call("GET", "/reports/branches", mgrT)).status === 403, "manager cannot see branch comparison");
  ok((await call("GET", "/reports/summary?from=nope", admin)).status === 400, "bad date rejected");

  // ---------- indexes ----------
  const idx = await mongoose.connection.collection("shifts").indexes();
  const cashierIdx = idx.filter((i) => JSON.stringify(i.key) === '{"cashier":1}');
  ok(cashierIdx.length === 1 && cashierIdx[0].unique === true, "shifts has ONE unique partial index on cashier", cashierIdx);

  console.log(`\n${pass} passed, ${fail} failed`);
  await mongoose.disconnect();
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error("CRASH", e); process.exit(2); });
