require("dotenv").config();
const http = require("http");
const app = require("./app");
const connectDB = require("./config/db");
const { init: initSocket } = require("./socket");

const PORT = process.env.PORT || 5000;

connectDB()
  .then(() => {
    const server = http.createServer(app);
    initSocket(server);
    server.listen(PORT, () => console.log(`API + sockets running on port ${PORT}`));
  })
  .catch((err) => {
    console.error("Failed to start:", err.message);
    process.exit(1);
  });
