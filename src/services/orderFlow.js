// Pure rules for order status changes.
const STAFF_ROLES = ["super_admin", "branch_manager", "worker"];

const PICKUP_FLOW = {
  pending: "confirmed",
  confirmed: "preparing",
  preparing: "ready",
  ready: "completed",
};
const FORWARD = {
  delivery: {
    pending: "confirmed",
    confirmed: "preparing",
    preparing: "ready",
    ready: "out_for_delivery",
    out_for_delivery: "delivered",
  },
  takeaway: PICKUP_FLOW,
  dine_in: PICKUP_FLOW,
};

const CANCELLABLE = ["pending", "confirmed", "preparing"];

const fail = (message, status = 400) => ({ ok: false, message, status });

function nextStatus(order) {
  return FORWARD[order.type]?.[order.status] || null;
}

function checkTransition({ order, to, user }) {
  const isStaff = STAFF_ROLES.includes(user.role);
  const isAssignedRider =
    user.role === "rider" && order.delivery?.rider && String(order.delivery.rider) === String(user._id);

  if (to === "cancelled") {
    if (!CANCELLABLE.includes(order.status)) return fail(`An order that is ${order.status} can no longer be cancelled`, 409);
    if (user.role === "customer") {
      if (order.status !== "pending") return fail("This order is already being handled. Please call the restaurant to cancel.", 409);
      return { ok: true };
    }
    return isStaff ? { ok: true } : fail("You cannot cancel this order", 403);
  }

  const expected = nextStatus(order);
  if (!expected || expected !== to) {
    return fail(`Cannot move an order from "${order.status}" to "${to}"`, 409);
  }

  if (to === "out_for_delivery" || to === "delivered") {
    const managerLevel = ["super_admin", "branch_manager"].includes(user.role);
    if (!isAssignedRider && !managerLevel) return fail("Only the assigned rider can do this", 403);
    if (to === "out_for_delivery" && !order.delivery?.rider) return fail("Assign a rider first", 409);
  } else if (!isStaff) {
    return fail("You cannot update this order", 403);
  }

  if (to === "confirmed" && order.payment?.method === "card_online" && order.payment.status !== "paid") {
    return fail("Waiting for the customer's card payment", 409);
  }
  if (to === "completed" && order.payment?.status !== "paid") {
    return fail("Record the payment before completing this order", 409);
  }
  if (to === "delivered" && order.payment?.status !== "paid" && order.payment?.method !== "pay_on_delivery") {
    return fail("This order has not been paid", 409);
  }
  return { ok: true };
}

module.exports = { checkTransition, nextStatus, CANCELLABLE, STAFF_ROLES };
