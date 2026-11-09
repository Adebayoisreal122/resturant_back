const mongoose = require("mongoose");
const Shift = require("../models/Shift");
const Order = require("../models/Order");
const { asyncHandler, AppError } = require("../utils/helpers");
const { lagosRange } = require("../utils/dates");
const { METHODS, summarizeShift, computeVariance } = require("../services/shifts");

const num = (v, label) => {
  const n = Number(v ?? 0);
  if (!Number.isFinite(n) || n < 0) throw new AppError(`${label} must be zero or more`);
  return n;
};

// What the system says this shift took, grouped by how customers paid
async function liveFigures(shift) {
  const rows = await Order.aggregate([
    { $match: { shift: shift._id, "payment.status": "paid", "payment.method": { $in: METHODS } } },
    { $group: { _id: "$payment.method", total: { $sum: "$total" }, count: { $sum: 1 } } },
  ]);
  return summarizeShift({ openingFloat: shift.openingFloat, rows });
}

const canAccess = (user, shift) =>
  user.role === "super_admin" ||
  (user.role === "branch_manager" && String(shift.branch) === String(user.branch)) ||
  String(shift.cashier) === String(user._id);

exports.open = asyncHandler(async (req, res) => {
  const openingFloat = num(req.body.openingFloat, "Opening float");
  try {
    const shift = await Shift.create({ branch: req.user.branch, cashier: req.user._id, openingFloat });
    res.status(201).json({ shift });
  } catch (err) {
    if (err.code === 11000) throw new AppError("You already have an open shift", 409);
    throw err;
  }
});

// The running shift with live expected figures (so the cashier can count against them)
exports.current = asyncHandler(async (req, res) => {
  const shift = await Shift.findOne({ cashier: req.user._id, status: "open" });
  if (!shift) return res.json({ shift: null });
  res.json({ shift, live: await liveFigures(shift) });
});

exports.close = asyncHandler(async (req, res) => {
  const shift = await Shift.findOne({ cashier: req.user._id, status: "open" });
  if (!shift) throw new AppError("You have no open shift", 409);

  const d = req.body.declared || {};
  const declared = { cash: num(d.cash, "Cash"), transfer: num(d.transfer, "Transfers"), pos_terminal: num(d.pos_terminal, "POS") };

  const { expected, ordersCount, totalSales } = await liveFigures(shift);
  const { variance, hasVariance } = computeVariance(declared, expected);

  // The status condition stops a double-click or retry from closing twice
  const closed = await Shift.findOneAndUpdate(
    { _id: shift._id, status: "open" },
    { status: "closed", closedAt: new Date(), declared, expected, variance, hasVariance, ordersCount, totalSales, notes: req.body.notes ? String(req.body.notes).slice(0, 500) : undefined },
    { new: true }
  );
  if (!closed) throw new AppError("This shift was already closed", 409);
  res.json({ shift: closed });
});

exports.list = asyncHandler(async (req, res) => {
  const u = req.user;
  const filter = {};
  if (u.role === "worker") filter.cashier = u._id;
  else if (u.role === "branch_manager") filter.branch = u.branch;
  else if (req.query.branch) filter.branch = req.query.branch;
  if (req.query.status) filter.status = req.query.status;
  if (req.query.variance === "true") filter.hasVariance = true;
  if (req.query.cashier && u.role !== "worker") filter.cashier = req.query.cashier;
  if (req.query.from || req.query.to) {
    const range = lagosRange(req.query.from, req.query.to);
    if (!range) throw new AppError("Invalid date range (use YYYY-MM-DD)");
    filter.openedAt = { $gte: range.start, $lte: range.end };
  }
  const shifts = await Shift.find(filter).populate("cashier", "name workerType").populate("branch", "name code").sort("-openedAt").limit(100);
  res.json({ count: shifts.length, shifts });
});

exports.get = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError("Shift not found", 404);
  // Check access on the raw ids first: once cashier/branch are expanded into objects the comparison would never match
  const shift = await Shift.findById(req.params.id);
  if (!shift || !canAccess(req.user, shift)) throw new AppError("Shift not found", 404);
  await shift.populate([{ path: "cashier", select: "name workerType" }, { path: "branch", select: "name code" }]);
  const orders = await Order.find({ shift: shift._id }).select("orderNumber type total payment.method payment.status createdAt").sort("createdAt");
  res.json({ shift, orders, live: shift.status === "open" ? await liveFigures(shift) : undefined });
});

// Manager signs off a closed shift, especially one with a variance
exports.review = asyncHandler(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) throw new AppError("Shift not found", 404);
  const shift = await Shift.findById(req.params.id);
  if (!shift || !canAccess(req.user, shift)) throw new AppError("Shift not found", 404);
  if (shift.status !== "closed") throw new AppError("Only closed shifts can be reviewed", 409);
  if (String(shift.cashier) === String(req.user._id)) throw new AppError("You cannot review your own shift", 403);
  shift.reviewedBy = req.user._id;
  shift.reviewedAt = new Date();
  shift.reviewNote = req.body.note ? String(req.body.note).slice(0, 500) : undefined;
  await shift.save();
  res.json({ shift });
});
