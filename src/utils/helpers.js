// Wraps async route handlers so errors reach the error middleware
exports.asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);

exports.AppError = class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
};

// Normalise Nigerian numbers: 0801..., 801..., 234801..., +234801... -> +234801...
exports.normalizePhone = (input = "") => {
  let p = String(input).replace(/[\s\-()]/g, "");
  if (p.startsWith("+234")) return p;
  if (p.startsWith("234")) return "+" + p;
  if (p.startsWith("0")) return "+234" + p.slice(1);
  if (/^[789]\d{9}$/.test(p)) return "+234" + p;
  return p;
};

exports.isValidNgPhone = (p) => /^\+234[789]\d{9}$/.test(p);

exports.slugify = (s) =>
  s.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
