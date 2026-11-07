const mongoose = require("mongoose");

const ORDER_STATUS = [
  "pending", "confirmed", "preparing", "ready",
  "out_for_delivery", "delivered", "completed", "cancelled", "refunded",
];

const itemSchema = new mongoose.Schema(
  {
    menuItem: { type: mongoose.Schema.Types.ObjectId, ref: "MenuItem", required: true },
    name: String, // snapshot, so later menu edits don't rewrite history
    unitPrice: Number,
    variant: String,
    addOns: [{ name: String, price: Number }],
    quantity: { type: Number, required: true, min: 1 },
    note: String,
    lineTotal: Number,
  },
  { _id: false }
);

const orderSchema = new mongoose.Schema(
  {
    orderNumber: { type: String, unique: true }, // e.g. IKD-20261022-0007
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    customer: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // optional for walk-ins
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // cashier for POS orders
    source: { type: String, enum: ["online", "pos"], default: "online" },
    type: { type: String, enum: ["dine_in", "takeaway", "delivery"], required: true },
    tableNumber: String,
    items: { type: [itemSchema], validate: (v) => v.length > 0 },
    subtotal: Number,
    vat: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    discount: { type: Number, default: 0 },
    total: Number,
    status: { type: String, enum: ORDER_STATUS, default: "pending", index: true },
    statusHistory: [{ status: String, by: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, at: { type: Date, default: Date.now } }],
    payment: {
      method: { type: String, enum: ["cash", "transfer", "pos_terminal", "card_online", "pay_on_delivery"] },
      status: { type: String, enum: ["unpaid", "paid", "failed", "refunded"], default: "unpaid" },
      reference: String, // the reference that was actually paid (or the latest attempt)
      references: [String], // every Paystack attempt, so a late payment on an old tab is still matched
      paidAt: Date,
      recordedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" }, // staff who took the payment
      refundedAt: Date,
      refundReference: String,
      refundNote: String,
    },
    delivery: {
      address: String,
      zone: String,
      phone: String,
      rider: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
      cashCollected: Number,
      cashRemitted: { type: Boolean, default: false }, // rider handed the cash to the branch
      remittance: { type: mongoose.Schema.Types.ObjectId, ref: "RiderRemittance" },
    },
    cancelReason: String,
    cancelledBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    shift: { type: mongoose.Schema.Types.ObjectId, ref: "Shift" }, // wired up when shifts are built
  },
  { timestamps: true }
);

orderSchema.index({ branch: 1, createdAt: -1 });
orderSchema.index({ "payment.references": 1 });
orderSchema.index({ shift: 1 });

module.exports = mongoose.model("Order", orderSchema);
module.exports.ORDER_STATUS = ORDER_STATUS;
