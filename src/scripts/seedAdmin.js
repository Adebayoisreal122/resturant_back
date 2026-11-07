require("dotenv").config();
const mongoose = require("mongoose");
const User = require("../models/User");
const { normalizePhone } = require("../utils/helpers");

(async () => {
  await mongoose.connect(process.env.MONGO_URI);
  const phone = normalizePhone(process.env.ADMIN_PHONE);
  if (await User.exists({ phone })) {
    console.log("Super admin already exists");
  } else {
    await User.create({
      name: process.env.ADMIN_NAME || "Super Admin",
      phone,
      password: process.env.ADMIN_PASSWORD,
      role: "super_admin",
    });
    console.log(`Super admin created: ${phone}`);
  }
  await mongoose.disconnect();
})();
