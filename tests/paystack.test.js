const test = require("node:test");
const assert = require("node:assert");
const crypto = require("crypto");
const http = require("http");

process.env.JWT_ACCESS_SECRET = "a";
process.env.JWT_REFRESH_SECRET = "b";
process.env.NODE_ENV = "test";
process.env.PAYSTACK_SECRET_KEY = "sk_test_secret";

const paystack = require("../src/services/paystack");
const Order = require("../src/models/Order");
const app = require("../src/app");

const sign = (raw) => crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(raw).digest("hex");

test("signature check accepts the right HMAC and rejects everything else", () => {
  const raw = Buffer.from('{"event":"charge.success"}');
  assert.equal(paystack.verifySignature(raw, sign(raw)), true);
  assert.equal(paystack.verifySignature(raw, "0".repeat(128)), false);
  assert.equal(paystack.verifySignature(raw, "short"), false);
  assert.equal(paystack.verifySignature(raw, undefined), false);
  assert.equal(paystack.verifySignature(undefined, sign(raw)), false);
  assert.equal(paystack.verifySignature(Buffer.from('{"event":"charge.success","x":1}'), sign(raw)), false); // tampered body
});

test("validateCharge requires success, NGN and the exact amount in kobo", () => {
  const order = { total: 5362.5 };
  assert.equal(paystack.validateCharge(order, { status: "success", currency: "NGN", amount: 536250 }).ok, true);
  assert.equal(paystack.validateCharge(order, { status: "success", currency: "NGN", amount: 100 }).ok, false);
  assert.equal(paystack.validateCharge(order, { status: "failed", currency: "NGN", amount: 536250 }).ok, false);
  assert.equal(paystack.validateCharge(order, { status: "success", currency: "USD", amount: 536250 }).ok, false);
  assert.equal(paystack.toKobo(0.1 + 0.2), 30); // no floating point drift
});

test("initialize sends kobo, NGN, reference and the secret key", async () => {
  let seen;
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    seen = { url, opts, body: JSON.parse(opts.body) };
    return { ok: true, status: 200, json: async () => ({ status: true, data: { authorization_url: "https://checkout.paystack.com/abc", reference: "R1" } }) };
  };
  try {
    const data = await paystack.initialize({ email: "a@b.com", amount: 4500, reference: "R1", callbackUrl: "http://x/cb", metadata: { orderId: "1" } });
    assert.equal(data.authorization_url, "https://checkout.paystack.com/abc");
    assert.equal(seen.url, "https://api.paystack.co/transaction/initialize");
    assert.equal(seen.opts.headers.Authorization, "Bearer sk_test_secret");
    assert.equal(seen.body.amount, 450000);
    assert.equal(seen.body.currency, "NGN");
  } finally {
    global.fetch = realFetch;
  }
});

test("Paystack errors become clean 4xx/5xx errors, not crashes", async () => {
  const realFetch = global.fetch;
  global.fetch = async () => ({ ok: false, status: 400, json: async () => ({ status: false, message: "Invalid key" }) });
  await assert.rejects(() => paystack.verify("R1"), /Invalid key/);
  global.fetch = async () => { throw new Error("network down"); };
  await assert.rejects(() => paystack.verify("R1"), /Could not reach Paystack/);
  global.fetch = realFetch;
});

/* ---- Webhook through the real route, with the Order model stubbed ---- */
let server, port, updates;
const unpaidOrder = () => ({ _id: "o1", orderNumber: "IKD-1", total: 5000, status: "pending", payment: { status: "unpaid", method: "card_online" } });
let found;

test.before(() => new Promise((r) => {
  Order.findOne = async () => found;
  Order.findOneAndUpdate = async (cond, update) => {
    updates.push({ cond, update });
    return { populate: async () => {}, toJSON: () => ({}) };
  };
  server = http.createServer(app).listen(0, () => { port = server.address().port; r(); });
}));
test.after(() => server.close());

const post = (body, signature) => new Promise((resolve) => {
  const raw = typeof body === "string" ? body : JSON.stringify(body);
  const headers = { "Content-Type": "application/json" };
  if (signature !== null) headers["x-paystack-signature"] = signature ?? sign(raw);
  const req = http.request({ port, path: "/api/payments/paystack/webhook", method: "POST", headers }, (res) => {
    let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve(res.statusCode));
  });
  req.write(raw); req.end();
});
const evt = (amount, extra = {}) => ({ event: "charge.success", data: { reference: "IKD-1-abcd", status: "success", currency: "NGN", amount, ...extra } });

test("webhook: bad or missing signature is rejected and changes nothing", async () => {
  updates = []; found = unpaidOrder();
  assert.equal(await post(evt(500000), "f".repeat(128)), 401);
  assert.equal(await post(evt(500000), null), 401);
  assert.equal(updates.length, 0);
});

test("webhook: valid signed payment for the right amount marks the order paid", async () => {
  updates = []; found = unpaidOrder();
  assert.equal(await post(evt(500000)), 200);
  assert.equal(updates.length, 1);
  assert.equal(updates[0].update.$set["payment.status"], "paid");
  assert.deepEqual(updates[0].cond["payment.status"], { $ne: "paid" }); // atomic guard
});

test("webhook: wrong amount is acknowledged but NOT marked paid", async () => {
  updates = []; found = unpaidOrder();
  assert.equal(await post(evt(100)), 200);
  assert.equal(updates.length, 0);
});

test("webhook: duplicate delivery for an already-paid order does nothing", async () => {
  updates = []; found = { ...unpaidOrder(), payment: { status: "paid" } };
  assert.equal(await post(evt(500000)), 200);
  assert.equal(updates.length, 0);
});

test("webhook: unknown reference and other events return 200 (so Paystack stops retrying)", async () => {
  updates = []; found = null;
  assert.equal(await post(evt(500000)), 200);
  assert.equal(await post({ event: "transfer.success", data: {} }), 200);
  assert.equal(updates.length, 0);
});

test("webhook: AUTO_CONFIRM_PAID moves a pending order to confirmed", async () => {
  process.env.AUTO_CONFIRM_PAID = "true";
  updates = []; found = unpaidOrder();
  await post(evt(500000));
  assert.equal(updates[0].update.$set.status, "confirmed");
  delete process.env.AUTO_CONFIRM_PAID;
});
