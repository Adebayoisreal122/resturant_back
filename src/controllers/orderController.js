const mongoose = require("mongoose");
const Order = require("../models/Order");
const Branch = require("../models/Branch");
const MenuItem = require("../models/MenuItem");
const User = require("../models/User");
const Counter = require("../models/Counter");
const Shift = require("../models/Shift");
const { asyncHandler, AppError, normalizePhone, isValidNgPhone } = require("../utils/helpers");
const { buildLines, computeTotals, round2 } = require("../services/pricing");
const { checkTransition, nextStatus, STAFF_ROLES } = require("../services/orderFlow");
const { lagosRange } = require("../utils/dates");
const { emitOrder, emitToUser } = require("../socket");

const VAT_RATE = Number(process.env.VAT_RATE ?? 0.075);
const VAT_MODE = process.env.VAT_MODE || "exclusive"; // exclusive | inclusive | none

const STAFF_PAY_METHODS = ["cash", "transfer", "pos_terminal", "pay_on_delivery"];
const POPULATE = [
  { path: "branch", select: "name code phone" },
  { path: "customer", select: "name phone" },
  { path: "delivery.rider", select: "name phone" },
];

// Africa/Lagos is UTC+1 all year
const lagosDay = () => new Date(Date.now() + 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, "");

async function nextOrderNumber(branchCode) {
  const key = `${branchCode}-${lagosDay()}`;
  const c = await Counter.findOneAndUpdate({ _id: key }, { $inc: { seq: 1 } }, { new: true, upsert: true });
  return `${key}-${String(c.seq).padStart(4, "0")}`;
}

// Returns the order only if this user is allowed to see it (404 otherwise, no leaking)
async function loadScoped(req) {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError("Order not found", 404);
  const order = await Order.findById(req.params.id);
  const u = req.user;
  const allowed =
    order &&
    (u.role === "super_admin" ||
      (STAFF_ROLES.includes(u.role) && String(order.branch) === String(u.branch)) ||
      (u.role === "customer" && String(order.customer) === String(u._id)) ||
      (u.role === "rider" && String(order.delivery?.rider) === String(u._id)));
  if (!allowed) throw new AppError("Order not found", 404);
  return order;
}

/* ---------------- Create ---------------- */
exports.createOrder = asyncHandler(async (req, res) => {
  const u = req.user;
  const isStaff = STAFF_ROLES.includes(u.role);
  const { type, items, tableNumber, delivery = {}, payment = {} } = req.body;

  if (!["dine_in", "takeaway", "delivery"].includes(type)) throw new AppError("Invalid order type");
  if (!isStaff && type === "dine_in") throw new AppError("Dine-in orders are taken at the restaurant");

  const branchId = isStaff && u.role !== "super_admin" ? u.branch : req.body.branch;
  if (!mongoose.isValidObjectId(branchId)) throw new AppError("Choose a branch");
  const branch = await Branch.findById(branchId);
  if (!branch || !branch.isActive) throw new AppError("This branch is not available", 404);
  if (type === "delivery" && !branch.acceptsDelivery) throw new AppError("This branch does not offer delivery");
  if (type === "dine_in" && !branch.acceptsDineIn) throw new AppError("This branch does not offer dine-in");

  // Prices come from the database, never from the client
  const reqItems = Array.isArray(items) ? items : [];
  const ids = [...new Set(reqItems.map((i) => String(i.menuItem)))];
  if (ids.some((id) => !mongoose.isValidObjectId(id))) throw new AppError("Invalid menu item");
  const menu = await MenuItem.find({ _id: { $in: ids } });
  const lines = buildLines(reqItems, new Map(menu.map((m) => [String(m._id), m])), branch._id);

  // Delivery details and fee
  let deliveryInfo;
  let deliveryFee = 0;
  if (type === "delivery") {
    const zone = branch.deliveryZones.find((z) => z.name === delivery.zone);
    if (!zone) throw new AppError("Choose a delivery area this branch serves");
    if (!delivery.address || delivery.address.trim().length < 5) throw new AppError("Enter a delivery address");
    const phone = normalizePhone(delivery.phone || (u.role === "customer" ? u.phone : ""));
    if (!isValidNgPhone(phone)) throw new AppError("Enter a valid phone number for the rider to call");
    deliveryFee = zone.fee;
    deliveryInfo = { address: delivery.address.trim(), zone: zone.name, phone };
  }

  // Payment method rules
  let method = payment.method;
  if (isStaff) {
    method = method || "cash";
    if (!STAFF_PAY_METHODS.includes(method)) throw new AppError("Invalid payment method");
  } else {
    const allowed = type === "delivery" ? ["card_online", "pay_on_delivery"] : ["card_online", "cash"];
    method = method || allowed[allowed.length - 1];
    if (!allowed.includes(method)) throw new AppError(`Payment method not allowed for ${type} orders`);
  }
  if (method === "pay_on_delivery" && type !== "delivery") throw new AppError("Pay on delivery only applies to delivery orders");

  const totals = computeTotals({ lines, vatRate: VAT_RATE, vatMode: VAT_MODE, deliveryFee });
  const paidNow = isStaff && payment.paid === true && method !== "pay_on_delivery";

  // Cashiers must have an open shift to take money, so every naira lands in a reconciliation
  const shift = paidNow ? await Shift.findOne({ cashier: u._id, status: "open" }) : null;
  if (paidNow && u.role === "worker" && !shift) throw new AppError("Open your shift before taking payments", 409);
  const status = isStaff ? "confirmed" : "pending"; // staff orders are confirmed at the counter

  const order = await Order.create({
    orderNumber: await nextOrderNumber(branch.code),
    branch: branch._id,
    customer: u.role === "customer" ? u._id : undefined,
    createdBy: isStaff ? u._id : undefined,
    source: isStaff ? "pos" : "online",
    type,
    tableNumber: type === "dine_in" ? tableNumber : undefined,
    items: lines,
    ...totals,
    status,
    statusHistory: [{ status, by: u._id }],
    payment: {
      method,
      status: paidNow ? "paid" : "unpaid",
      paidAt: paidNow ? new Date() : undefined,
      reference: payment.reference,
      recordedBy: paidNow ? u._id : undefined,
    },
    delivery: deliveryInfo,
    shift: shift ? shift._id : undefined,
  });

  await order.populate(POPULATE);
  emitOrder("order:new", order);
  res.status(201).json({ order });
});

/* ---------------- Read ---------------- */
exports.listOrders = asyncHandler(async (req, res) => {
  const u = req.user;
  const { status, type, from, to, branch, q } = req.query;
  const filter = {};

  if (u.role === "customer") filter.customer = u._id;
  else if (u.role === "rider") filter["delivery.rider"] = u._id;
  else if (u.role === "super_admin") {
    if (branch) filter.branch = branch;
  } else filter.branch = u.branch;

  if (status) filter.status = { $in: String(status).split(",") };
  if (type) filter.type = type;
  if (q) filter.orderNumber = new RegExp(String(q).replace(/[^\w-]/g, ""), "i");
  if (from || to) {
    const dayRe = /^\d{4}-\d{2}-\d{2}$/;
    if ((!from || dayRe.test(from)) && (!to || dayRe.test(to))) {
      // Plain dates are Lagos calendar days, inclusive (same as reports and shifts). One date alone means that single day.
      const range = lagosRange(from, to);
      if (!range) throw new AppError("Invalid date filter (use YYYY-MM-DD)");
      filter.createdAt = { $gte: range.start, $lte: range.end };
    } else {
      // Full timestamps still work
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from);
      if (to) filter.createdAt.$lte = new Date(to);
      if (Object.values(filter.createdAt).some((d) => isNaN(d))) throw new AppError("Invalid date filter");
    }
  }

  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 20));
  const [orders, total] = await Promise.all([
    Order.find(filter).populate(POPULATE).sort("-createdAt").skip((page - 1) * limit).limit(limit),
    Order.countDocuments(filter),
  ]);
  res.json({ page, limit, total, pages: Math.ceil(total / limit), orders });
});

exports.getOrder = asyncHandler(async (req, res) => {
  const order = await loadScoped(req);
  await order.populate(POPULATE);
  res.json({ order, nextStatus: nextStatus(order) });
});

/* ---------------- Status ---------------- */
exports.updateStatus = asyncHandler(async (req, res) => {
  const order = await loadScoped(req);
  const { status: to, cashCollected, reason } = req.body;

  const check = checkTransition({ order, to, user: req.user });
  if (!check.ok) throw new AppError(check.message, check.status);

  let refundRequired = false;
  if (to === "cancelled") {
    order.cancelReason = reason ? String(reason).slice(0, 200) : undefined;
    order.cancelledBy = req.user._id;
    refundRequired = order.payment.status === "paid"; // handled manually until payments are integrated
  }

  // Rider collects cash on delivery: this is what gets reconciled later
  if (to === "delivered" && order.payment.method === "pay_on_delivery" && order.payment.status !== "paid") {
    const collected = Number(cashCollected);
    if (!Number.isFinite(collected) || collected < order.total) {
      throw new AppError(`Enter the cash collected (at least ₦${order.total})`);
    }
    order.delivery.cashCollected = round2(collected);
    order.payment.status = "paid";
    order.payment.paidAt = new Date();
  }

  order.status = to;
  order.statusHistory.push({ status: to, by: req.user._id });
  await order.save();

  await order.populate(POPULATE);
  emitOrder("order:updated", order);
  res.json({ order, nextStatus: nextStatus(order), refundRequired });
});

/* ---------------- Rider assignment ---------------- */
exports.assignRider = asyncHandler(async (req, res) => {
  const order = await loadScoped(req);
  if (order.type !== "delivery") throw new AppError("Only delivery orders need a rider");
  if (!["confirmed", "preparing", "ready"].includes(order.status)) {
    throw new AppError(`Cannot assign a rider to an order that is ${order.status}`, 409);
  }
  const rider = mongoose.isValidObjectId(req.body.riderId)
    ? await User.findOne({ _id: req.body.riderId, role: "rider", status: "active", branch: order.branch })
    : null;
  if (!rider) throw new AppError("Rider not found in this branch", 404);

  order.delivery.rider = rider._id;
  await order.save();
  await order.populate(POPULATE);

  emitOrder("order:updated", order);
  emitToUser(rider._id, "delivery:assigned", order.toJSON());
  res.json({ order });
});

/* ---------------- Payment (cash / transfer / POS terminal at the counter) ---------------- */
exports.recordPayment = asyncHandler(async (req, res) => {
  const order = await loadScoped(req);
  const { method, reference, amount } = req.body;

  if (order.status === "cancelled") throw new AppError("This order was cancelled", 409);
  if (order.payment.status === "paid") throw new AppError("This order is already paid", 409);
  if (!["cash", "transfer", "pos_terminal", "card_online"].includes(method)) throw new AppError("Invalid payment method");
  if (amount !== undefined && Number(amount) < order.total) {
    throw new AppError(`Amount received is less than the order total (₦${order.total})`);
  }

  const shift = await Shift.findOne({ cashier: req.user._id, status: "open" });
  if (req.user.role === "worker" && !shift) throw new AppError("Open your shift before taking payments", 409);
  if (shift) order.shift = shift._id;
  order.payment.recordedBy = req.user._id;

  order.payment.method = method;
  order.payment.status = "paid";
  order.payment.paidAt = new Date();
  if (reference) order.payment.reference = String(reference).slice(0, 100);
  await order.save();

  await order.populate(POPULATE);
  emitOrder("order:updated", order);
  res.json({ order });
});
