const router = require("express").Router();
const { protect, authorize, optionalAuth } = require("../middleware/auth");
const auth = require("../controllers/authController");
const users = require("../controllers/userController");
const branches = require("../controllers/branchController");
const menu = require("../controllers/menuController");
const orders = require("../controllers/orderController");
const riders = require("../controllers/riderController");
const pay = require("../controllers/paymentController");
const shifts = require("../controllers/shiftController");
const reports = require("../controllers/reportController");

const ADMIN = "super_admin";
const MGR = "branch_manager";

/* Auth */
router.post("/auth/register", auth.register);
router.post("/auth/login", auth.login);
router.post("/auth/refresh", auth.refresh);
router.post("/auth/logout", protect, auth.logout);
router.get("/auth/me", protect, auth.me);

/* Staff & users */
router.post("/users", protect, authorize(ADMIN, MGR), users.createStaff);
router.get("/users", protect, authorize(ADMIN, MGR), users.listUsers);
router.patch("/users/:id", protect, authorize(ADMIN, MGR), users.updateUser);

/* Branches */
router.get("/branches", optionalAuth, branches.listBranches);
router.get("/branches/:id", branches.getBranch);
router.post("/branches", protect, authorize(ADMIN), branches.createBranch);
router.patch("/branches/:id", protect, authorize(ADMIN, MGR), branches.updateBranch);
router.delete("/branches/:id", protect, authorize(ADMIN), branches.deactivateBranch);

/* Menu */
router.get("/categories", menu.listCategories);
router.post("/categories", protect, authorize(ADMIN), menu.createCategory);
router.patch("/categories/:id", protect, authorize(ADMIN), menu.updateCategory);

router.get("/menu", menu.listMenu);
router.get("/menu/:id", menu.getMenuItem);
router.post("/menu", protect, authorize(ADMIN), menu.createMenuItem);
router.patch("/menu/:id", protect, authorize(ADMIN), menu.updateMenuItem);
router.delete("/menu/:id", protect, authorize(ADMIN), menu.deleteMenuItem);
router.patch(
  "/menu/:id/branches/:branchId",
  protect, authorize(ADMIN, MGR),
  menu.setBranchAvailability
);

/* Orders */
const STAFF = [ADMIN, MGR, "worker"];
router.post("/orders", protect, authorize("customer", ...STAFF), orders.createOrder);
router.get("/orders", protect, orders.listOrders);
router.get("/orders/:id", protect, orders.getOrder);
router.patch("/orders/:id/status", protect, orders.updateStatus);
router.patch("/orders/:id/rider", protect, authorize(...STAFF), orders.assignRider);
router.post("/orders/:id/payment", protect, authorize(...STAFF), orders.recordPayment);

/* Riders */
router.get("/riders/available", protect, authorize(...STAFF), riders.available);
router.patch("/riders/me/status", protect, authorize("rider"), riders.setStatus);

router.get("/riders/me/cash", protect, authorize("rider"), riders.myCash);
router.get("/riders/cash", protect, authorize(ADMIN, MGR), riders.cashSummary);
router.get("/riders/remittances", protect, authorize(ADMIN, MGR), riders.remittances);
router.get("/riders/:id/cash", protect, authorize(ADMIN, MGR), riders.cashOutstanding);
router.post("/riders/:id/remit", protect, authorize(ADMIN, MGR), riders.remit);

/* Payments (Paystack). The webhook has no login: its signature is checked instead. */
router.post("/payments/paystack/initialize", protect, authorize("customer"), pay.initialize);
router.post("/payments/paystack/webhook", pay.webhook);
router.get("/payments/paystack/verify/:reference", protect, pay.verify);
router.post("/orders/:id/refund", protect, authorize(ADMIN, MGR), pay.refundOrder);

/* Shifts */
router.post("/shifts/open", protect, authorize("worker", MGR), shifts.open);
router.get("/shifts/current", protect, authorize("worker", MGR), shifts.current);
router.post("/shifts/close", protect, authorize("worker", MGR), shifts.close);
router.get("/shifts", protect, authorize(...STAFF), shifts.list);
router.get("/shifts/:id", protect, authorize(...STAFF), shifts.get);
router.patch("/shifts/:id/review", protect, authorize(ADMIN, MGR), shifts.review);

/* Reports */
router.get("/reports/summary", protect, authorize(ADMIN, MGR), reports.summary);
router.get("/reports/daily", protect, authorize(ADMIN, MGR), reports.daily);
router.get("/reports/top-items", protect, authorize(ADMIN, MGR), reports.topItems);
router.get("/reports/staff", protect, authorize(ADMIN, MGR), reports.staff);
router.get("/reports/riders", protect, authorize(ADMIN, MGR), reports.riders);
router.get("/reports/branches", protect, authorize(ADMIN), reports.branches);

module.exports = router;
