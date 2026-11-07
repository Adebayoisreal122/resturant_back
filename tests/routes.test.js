// Route-level checks that do not need MongoDB: the User lookup is stubbed.
const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const jwt = require("jsonwebtoken");

process.env.JWT_ACCESS_SECRET = "test-access";
process.env.JWT_REFRESH_SECRET = "test-refresh";
process.env.NODE_ENV = "test";

const User = require("../src/models/User");
const users = {
  customer: { _id: "c1", role: "customer", status: "active", phone: "+2348012345678" },
  rider: { _id: "r1", role: "rider", status: "active" },
  worker: { _id: "w1", role: "worker", status: "active", branch: "b1" },
};
User.findById = async (id) => Object.values(users).find((u) => u._id === id);
const app = require("../src/app");

let server, port;
test.before(() => new Promise((r) => { server = http.createServer(app).listen(0, () => { port = server.address().port; r(); }); }));
test.after(() => server.close());

const call = (method, path, who, body) =>
  new Promise((resolve) => {
    const headers = { "Content-Type": "application/json" };
    if (who) headers.Authorization = "Bearer " + jwt.sign({ sub: users[who]._id }, process.env.JWT_ACCESS_SECRET);
    const req = http.request({ port, path, method, headers }, (res) => {
      let d = ""; res.on("data", (c) => (d += c)); res.on("end", () => resolve({ status: res.statusCode, body: d ? JSON.parse(d) : {} }));
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });

test("orders require login", async () => {
  assert.equal((await call("GET", "/api/orders")).status, 401);
  assert.equal((await call("POST", "/api/orders")).status, 401);
});
test("riders cannot create orders; customers cannot use staff endpoints", async () => {
  assert.equal((await call("POST", "/api/orders", "rider", {})).status, 403);
  assert.equal((await call("GET", "/api/riders/available", "customer")).status, 403);
  assert.equal((await call("PATCH", "/api/orders/x/rider", "customer", {})).status, 403);
  assert.equal((await call("POST", "/api/orders/x/payment", "rider", {})).status, 403);
});
test("only riders can toggle rider status", async () => {
  assert.equal((await call("PATCH", "/api/riders/me/status", "worker", { isOnline: true })).status, 403);
});
test("order validation happens before touching the database", async () => {
  assert.equal((await call("POST", "/api/orders", "customer", { type: "banquet" })).status, 400);
  const dine = await call("POST", "/api/orders", "customer", { type: "dine_in", branch: "x" });
  assert.equal(dine.status, 400);
  assert.match(dine.body.message, /taken at the restaurant/);
  const nobranch = await call("POST", "/api/orders", "customer", { type: "takeaway", branch: "nope" });
  assert.match(nobranch.body.message, /Choose a branch/);
});
test("invalid order id returns 404, not a crash", async () => {
  assert.equal((await call("GET", "/api/orders/not-an-id", "customer")).status, 404);
});
