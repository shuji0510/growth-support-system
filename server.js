const express = require("express");
const path = require("path");
const { initDb } = require("./db/init");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

app.use("/api/users", require("./routes/users"));
app.use("/api/records", require("./routes/records"));
app.use("/api/plans", require("./routes/plans"));
app.use("/api/attendance", require("./routes/attendance"));
app.use("/api/wages", require("./routes/wages"));
app.use("/api/skills", require("./routes/skills"));
app.use("/api/dashboard", require("./routes/dashboard"));

app.get("/{*splat}", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

initDb().then(() => {
  app.listen(PORT, () => {
    console.log(`Growth Support System running at http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error("Failed to initialize database:", err);
  process.exit(1);
});
