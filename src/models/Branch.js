const mongoose = require("mongoose");

const zoneSchema = new mongoose.Schema({
  name: { type: String, required: true }, // e.g. "Bodija", "Ring Road"
  fee: { type: Number, required: true, min: 0 }, // naira
  estimatedMinutes: { type: Number, default: 40 },
});

const hoursSchema = new mongoose.Schema(
  {
    day: { type: Number, min: 0, max: 6 }, // 0 = Sunday
    open: String, // "08:00"
    close: String, // "22:00"
    closed: { type: Boolean, default: false },
  },
  { _id: false }
);

const branchSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, unique: true, uppercase: true }, // used in order numbers
    address: { type: String, required: true },
    city: String,
    state: String,
    phone: String,
    manager: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    deliveryZones: [zoneSchema],
    openingHours: [hoursSchema],
    acceptsDelivery: { type: Boolean, default: true },
    acceptsDineIn: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

module.exports = mongoose.model("Branch", branchSchema);
