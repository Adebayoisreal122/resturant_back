const Category = require("../models/Category");
const MenuItem = require("../models/MenuItem");
const Branch = require("../models/Branch");
const { asyncHandler, AppError, slugify } = require("../utils/helpers");

/* ---------- Categories ---------- */
exports.listCategories = asyncHandler(async (req, res) => {
  const categories = await Category.find({ isActive: true }).sort("sortOrder name");
  res.json({ categories });
});

exports.createCategory = asyncHandler(async (req, res) => {
  const category = await Category.create({ ...req.body, slug: slugify(req.body.name || "") });
  res.status(201).json({ category });
});

exports.updateCategory = asyncHandler(async (req, res) => {
  if (req.body.name) req.body.slug = slugify(req.body.name);
  const category = await Category.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!category) throw new AppError("Category not found", 404);
  res.json({ category });
});

/* ---------- Menu items ---------- */
// GET /api/menu?branch=<id>&category=<id>&q=jollof
// Returns only items available at that branch, with the branch's effective price.
exports.listMenu = asyncHandler(async (req, res) => {
  const { branch, category, q } = req.query;
  const filter = { isActive: true };
  if (category) filter.category = category;
  if (q) filter.$text = { $search: q };

  let items = await MenuItem.find(filter).populate("category", "name slug").lean();

  if (branch) {
    items = items
      .map((item) => {
        const rule = (item.branchAvailability || []).find((b) => String(b.branch) === String(branch));
        // No rule at all = available everywhere at base price
        if (!item.branchAvailability?.length) return { ...item, price: item.basePrice, isAvailable: true };
        if (!rule) return { ...item, price: item.basePrice, isAvailable: false };
        return { ...item, price: rule.priceOverride ?? item.basePrice, isAvailable: rule.isAvailable };
      })
      .filter((i) => i.isAvailable !== false || req.query.includeUnavailable === "true");
  }
  res.json({ count: items.length, items });
});

exports.getMenuItem = asyncHandler(async (req, res) => {
  const item = await MenuItem.findById(req.params.id).populate("category", "name slug");
  if (!item) throw new AppError("Item not found", 404);
  res.json({ item });
});

exports.createMenuItem = asyncHandler(async (req, res) => {
  const item = await MenuItem.create(req.body);
  res.status(201).json({ item });
});

exports.updateMenuItem = asyncHandler(async (req, res) => {
  const item = await MenuItem.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
  if (!item) throw new AppError("Item not found", 404);
  res.json({ item });
});

exports.deleteMenuItem = asyncHandler(async (req, res) => {
  // Soft delete so historical orders still reference the item
  const item = await MenuItem.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  if (!item) throw new AppError("Item not found", 404);
  res.json({ message: "Item removed from menu" });
});

// Toggle "sold out" for one branch (admin, or the manager of that branch)
exports.setBranchAvailability = asyncHandler(async (req, res) => {
  const { branchId } = req.params;
  const { isAvailable, priceOverride } = req.body;

  if (req.user.role === "branch_manager" && String(req.user.branch) !== String(branchId)) {
    throw new AppError("You can only manage your own branch", 403);
  }
  const item = await MenuItem.findById(req.params.id);
  if (!item) throw new AppError("Item not found", 404);

  // An item with no rules is available everywhere. Before adding the first rule,
  // seed every active branch as available so other branches keep selling it.
  if (!item.branchAvailability.length) {
    const branches = await Branch.find({ isActive: true }).select("_id");
    item.branchAvailability = branches.map((b) => ({ branch: b._id, isAvailable: true }));
  }

  const rule = item.branchAvailability.find((b) => String(b.branch) === String(branchId));
  if (rule) {
    if (isAvailable !== undefined) rule.isAvailable = isAvailable;
    if (priceOverride !== undefined) rule.priceOverride = priceOverride;
  } else {
    item.branchAvailability.push({ branch: branchId, isAvailable: isAvailable ?? true, priceOverride });
  }
  await item.save();
  res.json({ item });
});
