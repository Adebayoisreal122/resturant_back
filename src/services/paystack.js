const crypto = require("crypto");
const { AppError } = require("../utils/helpers");

const BASE = "https://api.paystack.co";

const secret = () => {
  if (!process.env.PAYSTACK_SECRET_KEY) throw new AppError("Online payments are not configured", 503);
  return process.env.PAYSTACK_SECRET_KEY;
};

async function call(method, path, body) {
  let res;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { Authorization: `Bearer ${secret()}`, "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new AppError("Could not reach Paystack. Please try again.", 502);
  }
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.status !== true) {
    throw new AppError(json.message || "Paystack request failed", res.status >= 500 ? 502 : 400);
  }
  return json.data;
}

const toKobo = (naira) => Math.round(naira * 100);

exports.initialize = ({ email, amount, reference, callbackUrl, metadata }) =>
  call("POST", "/transaction/initialize", {
    email,
    amount: toKobo(amount),
    currency: "NGN",
    reference,
    callback_url: callbackUrl,
    metadata,
    channels: ["card", "bank", "ussd", "bank_transfer"],
  });

exports.verify = (reference) => call("GET", `/transaction/verify/${encodeURIComponent(reference)}`);

exports.refund = (reference) => call("POST", "/refund", { transaction: reference });

// x-paystack-signature = HMAC-SHA512(secret key, raw request body)
exports.verifySignature = (rawBody, signature) => {
  if (!rawBody || !signature || !process.env.PAYSTACK_SECRET_KEY) return false;
  const expected = crypto.createHmac("sha512", process.env.PAYSTACK_SECRET_KEY).update(rawBody).digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(String(signature));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
};

// Never trust the event alone: the money must match the order exactly.
exports.validateCharge = (order, data) => {
  if (!data || data.status !== "success") return { ok: false, reason: "Payment was not successful" };
  if (data.currency && data.currency !== "NGN") return { ok: false, reason: `Unexpected currency ${data.currency}` };
  if (Number(data.amount) !== toKobo(order.total)) {
    return { ok: false, reason: `Amount mismatch: paid ${data.amount} kobo, expected ${toKobo(order.total)}` };
  }
  return { ok: true };
};

exports.toKobo = toKobo;
