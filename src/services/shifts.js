// Pure shift maths. "Drawer" methods are the ones a cashier handles at the counter.
const { round2 } = require("./pricing");

const METHODS = ["cash", "transfer", "pos_terminal"];

// rows: [{ _id: "cash", total: 12000, count: 4 }, ...] from an aggregation over paid orders
function summarizeShift({ openingFloat = 0, rows = [] }) {
  const sales = { cash: 0, transfer: 0, pos_terminal: 0 };
  let ordersCount = 0;
  for (const r of rows) {
    if (METHODS.includes(r._id)) {
      sales[r._id] = round2(r.total);
      ordersCount += r.count;
    }
  }
  const expected = {
    cash: round2(openingFloat + sales.cash), // the float is still in the drawer
    transfer: sales.transfer,
    pos_terminal: sales.pos_terminal,
  };
  const totalSales = round2(sales.cash + sales.transfer + sales.pos_terminal);
  return { sales, expected, ordersCount, totalSales };
}

function computeVariance(declared = {}, expected) {
  const variance = {};
  let hasVariance = false;
  for (const m of METHODS) {
    const d = Number(declared[m] ?? 0);
    variance[m] = round2(d - expected[m]);
    if (variance[m] !== 0) hasVariance = true;
  }
  return { variance, hasVariance };
}

module.exports = { METHODS, summarizeShift, computeVariance };
