const mongoose = require("mongoose");

// Records a rider handing over the cash they collected on pay-on-delivery orders
const schema = new mongoose.Schema(
  {
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true, index: true },
    rider: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    receivedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    orders: [{ type: mongoose.Schema.Types.ObjectId, ref: "Order" }],
    expected: { type: Number, required: true },
    received: { type: Number, required: true },
    variance: { type: Number, required: true }, // received minus expected (negative = rider is short)
    note: String,
  },
  { timestamps: true }
);

module.exports = mongoose.model("RiderRemittance", schema);
