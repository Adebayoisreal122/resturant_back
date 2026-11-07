const Branch = require("../models/Branch");
const { asyncHandler, AppError } = require("../utils/helpers");

exports.listBranches = asyncHandler(async (req, res) => {
  const filter = req.user?.role === "super_admin" ? {} : { isActive: true };
  const branches = await Branch.find(filter).populate("manager", "name phone").sort("name");
  res.json({ count: branches.length, branches });
});

exports.getBranch = asyncHandler(async (req, res) => {
  const branch = await Branch.findById(req.params.id).populate("manager", "name phone");
  if (!branch) throw new AppError("Branch not found", 404);
  res.json({ branch });
});

exports.createBranch = asyncHandler(async (req, res) => {
  const branch = await Branch.create(req.body);
  res.status(201).json({ branch });
});

exports.updateBranch = asyncHandler(async (req, res) => {
  // Managers may update only operational fields of their own branch
  const body = { ...req.body };
  if (req.user.role === "branch_manager") {
    if (String(req.params.id) !== String(req.user.branch)) throw new AppError("Not your branch", 403);
    ["code", "manager", "isActive"].forEach((k) => delete body[k]);
  }
  const branch = await Branch.findByIdAndUpdate(req.params.id, body, { new: true, runValidators: true });
  if (!branch) throw new AppError("Branch not found", 404);
  res.json({ branch });
});

exports.deactivateBranch = asyncHandler(async (req, res) => {
  const branch = await Branch.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!branch) throw new AppError("Branch not found", 404);
  res.json({ branch });
});
