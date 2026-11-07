const User = require("../models/User");
const Branch = require("../models/Branch");
const { asyncHandler, AppError, normalizePhone, isValidNgPhone } = require("../utils/helpers");

// Which roles each creator may create
const CAN_CREATE = {
  super_admin: ["branch_manager", "worker", "rider", "super_admin"],
  branch_manager: ["worker", "rider"],
};

exports.createStaff = asyncHandler(async (req, res) => {
  const { name, phone, email, password, role, workerType, branch, vehicle } = req.body;
  if (!CAN_CREATE[req.user.role].includes(role)) {
    throw new AppError(`You cannot create a ${role}`, 403);
  }
  const normalized = normalizePhone(phone);
  if (!isValidNgPhone(normalized)) throw new AppError("Enter a valid Nigerian phone number");

  // Managers can only add staff to their own branch
  const branchId = req.user.role === "branch_manager" ? req.user.branch : branch;
  if (role !== "super_admin") {
    if (!branchId) throw new AppError("Branch is required");
    if (!(await Branch.exists({ _id: branchId }))) throw new AppError("Branch not found", 404);
  }

  const user = await User.create({
    name, phone: normalized, email, password, role,
    workerType: role === "worker" ? workerType : undefined,
    branch: role === "super_admin" ? undefined : branchId,
    rider: role === "rider" ? { vehicle } : undefined,
  });

  if (role === "branch_manager") await Branch.findByIdAndUpdate(branchId, { manager: user._id });
  res.status(201).json({ user });
});

exports.listUsers = asyncHandler(async (req, res) => {
  const filter = {};
  if (req.user.role === "branch_manager") {
    filter.branch = req.user.branch;
    filter.role = { $in: ["worker", "rider"] };
  } else {
    if (req.query.role) filter.role = req.query.role;
    if (req.query.branch) filter.branch = req.query.branch;
  }
  const users = await User.find(filter).populate("branch", "name code").sort("-createdAt");
  res.json({ count: users.length, users });
});

exports.updateUser = asyncHandler(async (req, res) => {
  const target = await User.findById(req.params.id);
  if (!target) throw new AppError("User not found", 404);

  if (req.user.role === "branch_manager") {
    const ok = String(target.branch) === String(req.user.branch) && ["worker", "rider"].includes(target.role);
    if (!ok) throw new AppError("You can only manage workers and riders in your branch", 403);
  }

  // Never allow role/password changes through this endpoint
  const allowed = ["name", "email", "status", "workerType"];
  allowed.forEach((k) => req.body[k] !== undefined && (target[k] = req.body[k]));
  if (req.user.role === "super_admin" && req.body.branch) target.branch = req.body.branch;
  await target.save();
  res.json({ user: target });
});
