const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");
const rateLimit = require("express-rate-limit");
const routes = require("./routes");
const { notFound, errorHandler } = require("./middleware/error");

const app = express();

// Set TRUST_PROXY=1 when the API runs behind Nginx, Render, Railway etc., so rate limits see real client addresses
if (process.env.TRUST_PROXY) app.set("trust proxy", Number(process.env.TRUST_PROXY) || true);

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

// Brute-force protection on login. Only FAILED attempts count, so a whole restaurant logging in at shift
// change (one shared Wi-Fi address) is never locked out, and many customers behind one mobile-network address are fine.
const { normalizePhone } = require("./utils/helpers");
const tooMany = { message: "Too many failed attempts. Please wait 15 minutes and try again." };
app.use(
  "/api/auth/login",
  // 1) one account: 10 wrong passwords per 15 minutes
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, message: tooMany, keyGenerator: (req) => "phone:" + normalizePhone(req.body?.phone || "") }),
  // 2) one address: 100 wrong attempts per 15 minutes (someone guessing across many accounts)
  rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, skipSuccessfulRequests: true, message: tooMany })
);

app.get("/health", (req, res) => res.json({ ok: true }));
app.use("/api", routes);

app.use(notFound);
app.use(errorHandler);

module.exports = app;
