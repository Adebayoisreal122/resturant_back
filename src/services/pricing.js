// Pure pricing logic. The client never sends prices: only item ids, options and quantities.
const { AppError } = require("../utils/helpers");

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * requested: [{ menuItem, quantity, variant?, addOns?: [name], note? }]
 * menuById:  Map<string, MenuItem doc/object>
 * Returns order lines with server-calculated prices.
 *
 * Price rules:
 *  - Item with variants: the chosen variant's price is the full unit price.
 *  - Item without variants: basePrice, or the branch's priceOverride if set.
 *  - Item with branchAvailability rules is sold only where a rule says available.
 */
function buildLines(requested, menuById, branchId) {
  if (!Array.isArray(requested) || requested.length === 0) {
    throw new AppError("Order must contain at least one item");
  }
  if (requested.length > 50) throw new AppError("Too many items in one order");

  return requested.map((r) => {
    const item = menuById.get(String(r.menuItem));
    if (!item || item.isActive === false) throw new AppError(`Menu item not found: ${r.menuItem}`, 404);

    const qty = Number(r.quantity);
    if (!Number.isInteger(qty) || qty < 1 || qty > 50) {
      throw new AppError(`Invalid quantity for ${item.name}`);
    }

    let unitPrice = item.basePrice;
    if (item.branchAvailability && item.branchAvailability.length) {
      const rule = item.branchAvailability.find((b) => String(b.branch) === String(branchId));
      if (!rule || !rule.isAvailable) throw new AppError(`${item.name} is not available at this branch`);
      if (rule.priceOverride !== undefined && rule.priceOverride !== null) unitPrice = rule.priceOverride;
    }

    let variantName;
    if (item.variants && item.variants.length) {
      const v = item.variants.find((x) => x.name === r.variant);
      if (!v) throw new AppError(`Please choose an option for ${item.name}`);
      unitPrice = v.price;
      variantName = v.name;
    }

    const wanted = Array.isArray(r.addOns) ? r.addOns : [];
    if (wanted.length > 10) throw new AppError(`Too many add-ons for ${item.name}`);
    const addOns = wanted.map((name) => {
      const a = (item.addOns || []).find((x) => x.name === name);
      if (!a) throw new AppError(`Add-on "${name}" is not available for ${item.name}`);
      return { name: a.name, price: a.price };
    });
    const addOnTotal = addOns.reduce((sum, a) => sum + a.price, 0);

    return {
      menuItem: item._id,
      name: item.name,
      unitPrice,
      variant: variantName,
      addOns,
      quantity: qty,
      note: r.note ? String(r.note).slice(0, 200) : undefined,
      lineTotal: round2((unitPrice + addOnTotal) * qty),
    };
  });
}

/**
 * vatMode: "exclusive" (VAT added on top), "inclusive" (prices already include VAT), "none".
 * VAT is applied to food subtotal only, not the delivery fee.
 */
function computeTotals({ lines, vatRate = 0.075, vatMode = "exclusive", deliveryFee = 0, discount = 0 }) {
  const subtotal = round2(lines.reduce((s, l) => s + l.lineTotal, 0));
  const discounted = Math.max(0, round2(subtotal - discount));

  let vat = 0;
  let total;
  if (vatMode === "exclusive") {
    vat = round2(discounted * vatRate);
    total = round2(discounted + vat + deliveryFee);
  } else if (vatMode === "inclusive") {
    vat = round2(discounted - discounted / (1 + vatRate));
    total = round2(discounted + deliveryFee);
  } else {
    total = round2(discounted + deliveryFee);
  }
  return { subtotal, vat, deliveryFee, discount, total };
}

module.exports = { buildLines, computeTotals, round2 };
