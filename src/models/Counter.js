const mongoose = require("mongoose");

// Atomic sequence per key, used for order numbers like IKD-20261022-0007
const counterSchema = new mongoose.Schema({
  _id: String,
  seq: { type: Number, default: 0 },
});

module.exports = mongoose.model("Counter", counterSchema);
