const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { asyncHandler, AppError } = require("../utils/helpers");

// Verifies the access token and attaches req.user
exports.protect = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) throw new AppError("Not authenticated", 401);

  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
  } catch {
    throw new AppError("Session expired, please log in again", 401);
  }

  const user = await User.findById(payload.sub);
  if (!user || user.status !== "active") throw new AppError("Account unavailable", 401);
  req.user = user;
  next();
});

// Allow only the listed roles
exports.authorize = (...roles) => (req, res, next) => {
  if (!roles.includes(req.user.role)) {
    return next(new AppError("You do not have permission to do this", 403));
  }
  next();
};

// Managers/workers can only touch their own branch. Super admin can touch any.
// Looks for branch id in req.params.branchId, req.body.branch or req.query.branch.
exports.sameBranchOrAdmin = (req, res, next) => {
  if (req.user.role === "super_admin") return next();
  const target = req.params.branchId || req.body.branch || req.query.branch;
  if (!target || String(target) !== String(req.user.branch)) {
    return next(new AppError("You can only manage your own branch", 403));
  }
  next();
};

// Attaches req.user if a valid token is present, but never blocks the request
exports.optionalAuth = async (req, res, next) => {
  try {
    const header = req.headers.authorization || "";
    if (header.startsWith("Bearer ")) {
      const payload = jwt.verify(header.slice(7), process.env.JWT_ACCESS_SECRET);
      const user = await User.findById(payload.sub);
      if (user && user.status === "active") req.user = user;
    }
  } catch {
    /* ignore invalid token on public routes */
  }
  next();
};
