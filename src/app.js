const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const routes = require("./routes");
const { notFound, errorHandler } = require("./middleware/error");

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL?.split(","), credentials: true }));
// Keep the raw body for the Paystack webhook: the signature is computed over the exact bytes
app.use(
  express.json({
    limit: "1mb",
    verify: (req, res, buf) => {
      if (req.originalUrl.startsWith("/api/payments/paystack/webhook")) req.rawBody = buf;
    },
  })
);
if (process.env.NODE_ENV !== "test") app.use(morgan("dev"));

// Brute-force protection on login/register
app.use(
  "/api/auth/login",
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, message: { message: "Too many attempts, try again later" } })
);

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
