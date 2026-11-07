// Aggregation pipelines for reports. Kept free of database calls so they can be tested.
//
// "Revenue" = orders that are PAID and not cancelled/refunded, dated by when the order was placed.
// It includes VAT and delivery fees; "sales" is the food subtotal before VAT.

const paidMatch = ({ branch, range }) => ({
  ...(branch ? { branch } : {}),
  createdAt: { $gte: range.start, $lte: range.end },
  status: { $nin: ["cancelled", "refunded"] },
  "payment.status": "paid",
});

const anyMatch = ({ branch, range }) => ({
  ...(branch ? { branch } : {}),
  createdAt: { $gte: range.start, $lte: range.end },
});

const totals = (m) => [
  { $match: m },
  { $group: { _id: null, orders: { $sum: 1 }, sales: { $sum: "$subtotal" }, vat: { $sum: "$vat" }, deliveryFees: { $sum: "$deliveryFee" }, discounts: { $sum: "$discount" }, revenue: { $sum: "$total" } } },
];

const groupBy = (m, field) => [
  { $match: m },
  { $group: { _id: `$${field}`, orders: { $sum: 1 }, revenue: { $sum: "$total" } } },
  { $sort: { revenue: -1 } },
];

const daily = (m) => [
  { $match: m },
  { $group: { _id: { $dateToString: { format: "%Y-%m-%d", date: "$createdAt", timezone: "Africa/Lagos" } }, orders: { $sum: 1 }, revenue: { $sum: "$total" } } },
  { $sort: { _id: 1 } },
];

const topItems = (m, limit = 10) => [
  { $match: m },
  { $unwind: "$items" },
  { $group: { _id: "$items.name", quantity: { $sum: "$items.quantity" }, sales: { $sum: "$items.lineTotal" } } },
  { $sort: { quantity: -1, sales: -1 } },
  { $limit: limit },
];

const statusCounts = (m) => [{ $match: m }, { $group: { _id: "$status", count: { $sum: 1 } } }];

// Who recorded the payments
const byStaff = (m) => [
  { $match: { ...m, "payment.recordedBy": { $exists: true, $ne: null } } },
  { $group: { _id: "$payment.recordedBy", orders: { $sum: 1 }, revenue: { $sum: "$total" } } },
  { $sort: { revenue: -1 } },
];

const riders = ({ branch, range }) => [
  { $match: { ...(branch ? { branch } : {}), type: "delivery", status: "delivered", createdAt: { $gte: range.start, $lte: range.end } } },
  {
    $group: {
      _id: "$delivery.rider",
      deliveries: { $sum: 1 },
      cashCollected: { $sum: { $cond: [{ $eq: ["$payment.method", "pay_on_delivery"] }, "$total", 0] } },
      cashNotRemitted: {
        $sum: { $cond: [{ $and: [{ $eq: ["$payment.method", "pay_on_delivery"] }, { $ne: ["$delivery.cashRemitted", true] }] }, "$total", 0] },
      },
    },
  },
  { $sort: { deliveries: -1 } },
];

module.exports = { paidMatch, anyMatch, totals, groupBy, daily, topItems, statusCounts, byStaff, riders };
