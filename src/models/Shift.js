const mongoose = require("mongoose");

const money = () => ({ cash: { type: Number, default: 0 }, transfer: { type: Number, default: 0 }, pos_terminal: { type: Number, default: 0 } });

const shiftSchema = new mongoose.Schema(
  {
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    cashier: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true }, // indexed below (unique while open)
    status: { type: String, enum: ["open", "closed"], default: "open", index: true },
    openedAt: { type: Date, default: Date.now },
    closedAt: Date,
    openingFloat: { type: Number, default: 0, min: 0 }, // cash in the drawer at the start
    declared: money(), // what the cashier says they hold at close (cash includes the float)
    expected: money(), // what the system calculates (cash includes the float)
    variance: money(), // declared minus expected
    hasVariance: { type: Boolean, default: false },
    ordersCount: { type: Number, default: 0 },
    totalSales: { type: Number, default: 0 },
    notes: String,
    reviewedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    reviewedAt: Date,
    reviewNote: String,
  },
  { timestamps: true }
);

// A person can have only one open shift at a time
shiftSchema.index({ cashier: 1 }, { unique: true, partialFilterExpression: { status: "open" } });

module.exports = mongoose.model("Shift", shiftSchema);
