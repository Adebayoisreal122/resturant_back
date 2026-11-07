const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");
const User = require("./models/User");

let io = null;

// Client connects with: io(API_URL, { auth: { token: accessToken } })
exports.init = (httpServer) => {
  io = new Server(httpServer, {
    cors: { origin: process.env.CLIENT_URL?.split(","), credentials: true },
  });

  io.use(async (socket, next) => {
    try {
      const payload = jwt.verify(socket.handshake.auth?.token || "", process.env.JWT_ACCESS_SECRET);
      const user = await User.findById(payload.sub);
      if (!user || user.status !== "active") return next(new Error("Unauthorized"));
      socket.user = user;
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    const u = socket.user;
    socket.join(`user:${u._id}`); // customers and riders get their own updates here
    if (u.role === "super_admin") socket.join("admins");
    else if (["branch_manager", "worker"].includes(u.role) && u.branch) socket.join(`branch:${u.branch}`);
  });
  return io;
};

// Safe no-op if sockets are not running (tests, scripts)
exports.emitOrder = (event, order) => {
  if (!io) return;
  const o = order.toJSON ? order.toJSON() : order;
  const branchId = o.branch?._id || o.branch;
  const customerId = o.customer?._id || o.customer;
  const riderId = o.delivery?.rider?._id || o.delivery?.rider;
  const rooms = ["admins", branchId && `branch:${branchId}`, customerId && `user:${customerId}`, riderId && `user:${riderId}`].filter(Boolean);
  io.to(rooms).emit(event, o);
};

exports.emitToUser = (userId, event, payload) => {
  if (io) io.to(`user:${userId}`).emit(event, payload);
};
