const crypto = require("crypto");
const mongoose = require("mongoose");
const Order = require("../models/Order");
const paystack = require("../services/paystack");
const { asyncHandler, AppError } = require("../utils/helpers");
const { emitOrder } = require("../socket");

const POPULATE = [
  { path: "branch", select: "name code phone" },
  { path: "customer", select: "name phone" },
  { path: "delivery.rider", select: "name phone" },
];

const canSee = (user, order) =>
  user.role === "super_admin" ||
  (["branch_manager", "worker"].includes(user.role) && String(order.branch) === String(user.branch)) ||
  (user.role === "customer" && String(order.customer) === String(user._id));

/**
 * Marks an order paid from a Paystack charge. Safe to call many times (webhook retries,
 * the customer's verify call, both at once): only the first call changes anything.
 */
async function settlePaystackPayment(reference, data) {
  const order = await Order.findOne({ "payment.references": reference });
  if (!order) return { handled: false, reason: "unknown reference" };
  if (order.payment.status === "paid") return { handled: true, already: true, order };

  const check = paystack.validateCharge(order, data);
  if (!check.ok) {
    console.error(`Paystack ${reference} for ${order.orderNumber} rejected: ${check.reason}`);
    return { handled: true, rejected: true, reason: check.reason, order };
  }

  const autoConfirm = process.env.AUTO_CONFIRM_PAID === "true" && order.status === "pending";
  const update = {
    $set: {
      "payment.status": "paid",
      "payment.method": "card_online",
      "payment.reference": reference,
      "payment.paidAt": new Date(),
      ...(autoConfirm ? { status: "confirmed" } : {}),
    },
    ...(autoConfirm ? { $push: { statusHistory: { status: "confirmed", at: new Date() } } } : {}),
  };
  // The condition makes this atomic: a concurrent duplicate gets null and does nothing
  const updated = await Order.findOneAndUpdate({ _id: order._id, "payment.status": { $ne: "paid" } }, update, { new: true });
  if (!updated) return { handled: true, already: true, order };

  await updated.populate(POPULATE);
  emitOrder("order:updated", updated);
  return { handled: true, paid: true, order: updated };
}

/* Customer starts an online payment */
exports.initialize = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.body.orderId)) throw new AppError("Order not found", 404);
  const order = await Order.findById(req.body.orderId);
  if (!order || String(order.customer) !== String(req.user._id)) throw new AppError("Order not found", 404);
  if (order.payment.method !== "card_online") throw new AppError("This order is not set to pay online", 409);
  if (order.payment.status === "paid") throw new AppError("This order is already paid", 409);
  if (order.status !== "pending") throw new AppError(`This order is ${order.status} and can't be paid online`, 409);

  // Paystack needs an email; many customers sign up with a phone number only
  const email = req.user.email || `${req.user.phone.replace("+", "")}@${process.env.PAYSTACK_FALLBACK_EMAIL_DOMAIN || "customers.example.com"}`;
  const reference = `${order.orderNumber}-${crypto.randomBytes(4).toString("hex")}`;
  const callbackUrl = `${(process.env.CLIENT_URL || "").split(",")[0]}/orders/${order._id}/payment-status`;

  const data = await paystack.initialize({
    email,
    amount: order.total,
    reference,
    callbackUrl,
    metadata: { orderId: String(order._id), orderNumber: order.orderNumber },
  });

  await Order.updateOne({ _id: order._id }, { $addToSet: { "payment.references": reference }, $set: { "payment.reference": reference } });
  res.json({ authorizationUrl: data.authorization_url, reference });
});

/* Paystack calls this. No login; the signature is the authentication. */
exports.webhook = asyncHandler(async (req, res) => {
  if (!paystack.verifySignature(req.rawBody, req.headers["x-paystack-signature"])) {
    return res.status(401).json({ message: "Invalid signature" });
  }
  const event = req.body;
  if (event?.event === "charge.success" && event.data?.reference) {
    // Errors bubble up as 500 so Paystack retries; unknown references still return 200
    await settlePaystackPayment(event.data.reference, event.data);
  }
  res.sendStatus(200);
});

/* Customer's return page calls this, so it works even if the webhook is slow */
exports.verify = asyncHandler(async (req, res) => {
  const reference = String(req.params.reference);
  const order = await Order.findOne({ "payment.references": reference });
  if (!order || !canSee(req.user, order)) throw new AppError("Payment not found", 404);

  if (order.payment.status !== "paid") {
    const data = await paystack.verify(reference);
    if (data.status === "success") await settlePaystackPayment(reference, data);
  }
  const fresh = await Order.findById(order._id).populate(POPULATE);
  res.json({ paid: fresh.payment.status === "paid", order: fresh });
});

/* Refund a cancelled, paid order (manager/admin) */
exports.refundOrder = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError("Order not found", 404);
  const order = await Order.findById(req.params.id);
  if (!order || !canSee(req.user, order)) throw new AppError("Order not found", 404);
  if (order.status !== "cancelled") throw new AppError("Cancel the order before refunding it", 409);
  if (order.payment.status !== "paid") throw new AppError("There is no payment to refund", 409);

  if (order.payment.method === "card_online") {
    const data = await paystack.refund(order.payment.reference);
    order.payment.refundReference = String(data?.id ?? data?.transaction?.id ?? "");
    order.payment.refundNote = `Paystack refund ${data?.status || "requested"}`;
  } else {
    // Cash/transfer/POS: money goes back by hand, we just record it
    if (req.body.manual !== true) throw new AppError("Confirm you refunded the customer by sending manual: true");
    order.payment.refundNote = String(req.body.note || "Refunded manually").slice(0, 200);
  }
  order.payment.status = "refunded";
  order.payment.refundedAt = new Date();
  await order.save();

  await order.populate(POPULATE);
  emitOrder("order:updated", order);
  res.json({ order });
});

exports.settlePaystackPayment = settlePaystackPayment;
