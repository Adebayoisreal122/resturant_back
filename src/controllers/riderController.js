const User = require("../models/User");
const Order = require("../models/Order");
const RiderRemittance = require("../models/RiderRemittance");
const mongoose = require("mongoose");
const { asyncHandler, AppError } = require("../utils/helpers");

// Branch staff: riders in their branch who are online, with their current load
exports.available = asyncHandler(async (req, res) => {
  const branch = req.user.role === "super_admin" ? req.query.branch : req.user.branch;
  const riders = await User.find({ role: "rider", status: "active", branch, "rider.isOnline": true }).lean();

  const loads = await Order.aggregate([
    { $match: { "delivery.rider": { $in: riders.map((r) => r._id) }, status: { $in: ["confirmed", "preparing", "ready", "out_for_delivery"] } } },
    { $group: { _id: "$delivery.rider", active: { $sum: 1 } } },
  ]);
  const byId = new Map(loads.map((l) => [String(l._id), l.active]));
  res.json({
    riders: riders.map((r) => ({ _id: r._id, name: r.name, phone: r.phone, vehicle: r.rider?.vehicle, activeDeliveries: byId.get(String(r._id)) || 0 })),
  });
});

exports.setStatus = asyncHandler(async (req, res) => {
  req.user.rider = { ...(req.user.rider?.toObject?.() || req.user.rider || {}), isOnline: !!req.body.isOnline };
  await req.user.save();
  res.json({ isOnline: req.user.rider.isOnline });
});

/* ---------- Cash collected on pay-on-delivery orders ---------- */
async function loadRider(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError("Rider not found", 404);
  const rider = await User.findOne({ _id: req.params.id, role: "rider" });
  const allowed = rider && (req.user.role === "super_admin" || String(rider.branch) === String(req.user.branch));
  if (!allowed) throw new AppError("Rider not found", 404);
  return rider;
}

const outstandingFor = (riderId) =>
  Order.find({ "delivery.rider": riderId, status: "delivered", "payment.method": "pay_on_delivery", "payment.status": "paid", "delivery.cashRemitted": { $ne: true } })
    .select("orderNumber total createdAt")
    .sort("createdAt");

// What this rider still owes the branch
exports.cashOutstanding = asyncHandler(async (req, res) => {
  const rider = await loadRider(req);
  const orders = await outstandingFor(rider._id);
  res.json({ rider: { _id: rider._id, name: rider.name }, count: orders.length, expected: orders.reduce((s, o) => s + o.total, 0), orders });
});

// Manager counts the cash the rider hands over and records any shortage
exports.remit = asyncHandler(async (req, res) => {
  const rider = await loadRider(req);
  const received = Number(req.body.amountReceived);
  if (!Number.isFinite(received) || received < 0) throw new AppError("Enter the amount received");

  const orders = await outstandingFor(rider._id);
  if (!orders.length) throw new AppError("This rider has no cash to hand over", 409);
  const expected = Math.round(orders.reduce((s, o) => s + o.total, 0) * 100) / 100;

  const remittance = await RiderRemittance.create({
    branch: rider.branch, rider: rider._id, receivedBy: req.user._id,
    orders: orders.map((o) => o._id), expected, received,
    variance: Math.round((received - expected) * 100) / 100,
    note: req.body.note ? String(req.body.note).slice(0, 300) : undefined,
  });

  const ids = orders.map((o) => o._id);
  const r = await Order.updateMany({ _id: { $in: ids }, "delivery.cashRemitted": { $ne: true } }, { $set: { "delivery.cashRemitted": true, "delivery.remittance": remittance._id } });
  if (r.modifiedCount !== ids.length) {
    // Someone else remitted at the same moment: undo rather than double count
    await Order.updateMany({ "delivery.remittance": remittance._id }, { $set: { "delivery.cashRemitted": false }, $unset: { "delivery.remittance": 1 } });
    await remittance.deleteOne();
    throw new AppError("Another manager just recorded this handover. Refresh and check.", 409);
  }
  res.status(201).json({ remittance });
});
