const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const ROLES = ["super_admin", "branch_manager", "worker", "customer", "rider"];
const WORKER_TYPES = ["cashier", "waiter", "kitchen"];

const addressSchema = new mongoose.Schema(
  { label: String, line: String, zone: String, landmark: String },
  { _id: true }
);

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    phone: { type: String, required: true, unique: true },
    email: { type: String, lowercase: true, trim: true, sparse: true, unique: true },
    password: { type: String, required: true, minlength: 8, select: false },
    role: { type: String, enum: ROLES, default: "customer", index: true },
    workerType: { type: String, enum: WORKER_TYPES }, // only for role=worker
    branch: { type: mongoose.Schema.Types.ObjectId, ref: "Branch", index: true },
    status: { type: String, enum: ["active", "suspended"], default: "active" },
    addresses: [addressSchema], // customers
    loyaltyPoints: { type: Number, default: 0 },
    rider: {
      vehicle: { type: String, enum: ["bike", "bicycle", "car", "foot"] },
      isOnline: { type: Boolean, default: false },
    },
    refreshTokenHash: { type: String, select: false },
  },
  { timestamps: true }
);

userSchema.pre("save", async function (next) {
  if (!this.isModified("password")) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.matchPassword = function (plain) {
  return bcrypt.compare(plain, this.password);
};

userSchema.set("toJSON", {
  transform: (_, ret) => {
    delete ret.password;
    delete ret.refreshTokenHash;
    return ret;
  },
});

module.exports = mongoose.model("User", userSchema);
module.exports.ROLES = ROLES;
