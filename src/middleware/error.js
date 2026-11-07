exports.notFound = (req, res, next) => {
  res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` });
};

exports.errorHandler = (err, req, res, next) => {
  let status = err.status || 500;
  let message = err.message || "Server error";

  if (err.code === 11000) {
    status = 409;
    message = `${Object.keys(err.keyValue || {})[0] || "Value"} already exists`;
  }
  if (err.name === "ValidationError") {
    status = 400;
    message = Object.values(err.errors).map((e) => e.message).join(", ");
  }
  if (err.name === "CastError") {
    status = 400;
    message = "Invalid id";
  }
  if (status === 500) console.error(err);

  res.status(status).json({
    message,
    ...(process.env.NODE_ENV === "development" && status === 500 ? { stack: err.stack } : {}),
  });
};
