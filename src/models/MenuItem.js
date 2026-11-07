const mongoose = require("mongoose");

const optionSchema = new mongoose.Schema({
  name: { type: String, required: true }, // "Large", "Extra chicken", "Takeaway pack"
  price: { type: Number, required: true, min: 0 }, // variants: full price; add-ons: extra cost
});

const branchAvailabilitySchema = new mongoose.Schema(
  {
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", required: true },
    isAvailable: { type: Boolean, default: true },
    priceOverride: { type: Number, min: 0 }, // optional per-branch price
  },
  { _id: false }
);

const menuItemSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    description: String,
    category: { type: mongoose.Schema.Types.ObjectId, ref: "Category", required: true, index: true },
    image: String,
    basePrice: { type: Number, required: true, min: 0 },
    variants: [optionSchema], // portion sizes, etc.
    addOns: [optionSchema], // extras
    isCombo: { type: Boolean, default: false },
    prepMinutes: { type: Number, default: 15 },
    tags: [String], // "spicy", "vegetarian", "popular"
    // Empty array = available at every branch at basePrice
    branchAvailability: [branchAvailabilitySchema],
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

menuItemSchema.index({ name: "text", description: "text" });

module.exports = mongoose.model("MenuItem", menuItemSchema);
