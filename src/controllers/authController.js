const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { asyncHandler, AppError, normalizePhone, isValidNgPhone } = require("../utils/helpers");

const signTokens = (user) => ({
  accessToken: jwt.sign({ sub: user._id, role: user.role }, process.env.JWT_ACCESS_SECRET, {
    expiresIn: process.env.JWT_ACCESS_EXPIRES || "15m",
  }),
  refreshToken: jwt.sign({ sub: user._id }, process.env.JWT_REFRESH_SECRET, {
    expiresIn: process.env.JWT_REFRESH_EXPIRES || "30d",
  }),
});

const issue = async (user, res, status = 200) => {
  const tokens = signTokens(user);
  user.refreshTokenHash = await bcrypt.hash(tokens.refreshToken, 10);
  await user.save();
  res.status(status).json({ user, ...tokens });
};

// Public sign-up is for customers only. Staff are created by admins/managers.
exports.register = asyncHandler(async (req, res) => {
  const { name, phone, email, password } = req.body;
  const normalized = normalizePhone(phone);
  if (!name || !password) throw new AppError("Name and password are required");
  if (!isValidNgPhone(normalized)) throw new AppError("Enter a valid Nigerian phone number");
  if (password.length < 8) throw new AppError("Password must be at least 8 characters");

  const user = await User.create({ name, phone: normalized, email, password, role: "customer" });
  await issue(user, res, 201);
});

exports.login = asyncHandler(async (req, res) => {
  const { phone, password } = req.body;
  const user = await User.findOne({ phone: normalizePhone(phone) }).select("+password +refreshTokenHash");
  if (!user || !(await user.matchPassword(password || ""))) {
    throw new AppError("Incorrect phone number or password", 401);
  }
  if (user.status !== "active") throw new AppError("This account is suspended", 403);
  await issue(user, res);
});

exports.refresh = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  if (!refreshToken) throw new AppError("Refresh token required", 401);

  let payload;
  try {
    payload = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET);
  } catch {
    throw new AppError("Invalid refresh token", 401);
  }
  const user = await User.findById(payload.sub).select("+refreshTokenHash");
  if (!user || !user.refreshTokenHash || !(await bcrypt.compare(refreshToken, user.refreshTokenHash))) {
    throw new AppError("Invalid refresh token", 401);
  }
  await issue(user, res); // rotates the refresh token
});

exports.logout = asyncHandler(async (req, res) => {
  req.user.refreshTokenHash = undefined;
  await req.user.save();
  res.json({ message: "Logged out" });
});

exports.me = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user._id).populate("branch", "name code");
  res.json({ user });
});
