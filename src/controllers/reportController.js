const mongoose = require("mongoose");
const Order = require("../models/Order");
const User = require("../models/User");
const Branch = require("../models/Branch");
const { asyncHandler, AppError } = require("../utils/helpers");
const { lagosRange } = require("../utils/dates");
const R = require("../services/reports");

// Managers are locked to their own branch; admins can pick one or see all
function scope(req) {
  const range = lagosRange(req.query.from, req.query.to);
  if (!range) throw new AppError("Invalid date range (use YYYY-MM-DD, max one year)");
  let branch = req.user.role === "branch_manager" ? req.user.branch : req.query.branch;
  if (branch) {
    if (!mongoose.isValidObjectId(branch)) throw new AppError("Invalid branch");
    branch = new mongoose.Types.ObjectId(String(branch)); // aggregate() does not auto-cast
  }
  return { branch, range };
}

const nameMap = async (Model, ids, fields = "name") => {
  const docs = await Model.find({ _id: { $in: ids.filter(Boolean) } }).select(fields).lean();
  return new Map(docs.map((d) => [String(d._id), d]));
};

exports.summary = asyncHandler(async (req, res) => {
  const s = scope(req);
  const paid = R.paidMatch(s);
  const [t, byMethod, byType, bySource, statuses] = await Promise.all([
    Order.aggregate(R.totals(paid)),
    Order.aggregate(R.groupBy(paid, "payment.method")),
    Order.aggregate(R.groupBy(paid, "type")),
    Order.aggregate(R.groupBy(paid, "source")),
    Order.aggregate(R.statusCounts(R.anyMatch(s))),
  ]);
  const totals = t[0] || { orders: 0, sales: 0, vat: 0, deliveryFees: 0, discounts: 0, revenue: 0 };
  delete totals._id;
  res.json({
    range: { from: s.range.from, to: s.range.to },
    ...totals,
    averageOrderValue: totals.orders ? Math.round((totals.revenue / totals.orders) * 100) / 100 : 0,
    byPaymentMethod: byMethod,
    byType,
    bySource,
    orderStatuses: Object.fromEntries(statuses.map((x) => [x._id, x.count])),
  });
});

exports.daily = asyncHandler(async (req, res) => {
  res.json({ days: await Order.aggregate(R.daily(R.paidMatch(scope(req)))) });
});

exports.topItems = asyncHandler(async (req, res) => {
  const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 10));
  res.json({ items: await Order.aggregate(R.topItems(R.paidMatch(scope(req)), limit)) });
});

exports.branches = asyncHandler(async (req, res) => {
  const s = scope(req);
  delete s.branch; // comparison across all branches
  const rows = await Order.aggregate(R.groupBy(R.paidMatch(s), "branch"));
  const names = await nameMap(Branch, rows.map((r) => r._id), "name code");
  res.json({ branches: rows.map((r) => ({ branch: names.get(String(r._id)) || { _id: r._id }, orders: r.orders, revenue: r.revenue })) });
});

exports.staff = asyncHandler(async (req, res) => {
  const rows = await Order.aggregate(R.byStaff(R.paidMatch(scope(req))));
  const names = await nameMap(User, rows.map((r) => r._id), "name workerType role");
  res.json({ staff: rows.map((r) => ({ user: names.get(String(r._id)) || { _id: r._id }, orders: r.orders, revenue: r.revenue })) });
});

exports.riders = asyncHandler(async (req, res) => {
  const rows = await Order.aggregate(R.riders(scope(req)));
  const names = await nameMap(User, rows.map((r) => r._id), "name phone");
  res.json({
    riders: rows.map((r) => ({ rider: names.get(String(r._id)) || { _id: r._id }, deliveries: r.deliveries, cashCollected: r.cashCollected, cashNotRemitted: r.cashNotRemitted })),
  });
});
