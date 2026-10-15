
require("dotenv").config();

const express = require("express");
const session = require("express-session");
const MongoStore = require("connect-mongo");
const mongoose = require("mongoose");
const path = require("path");

const authRoutes = require("./src/routes/auth");
const appointmentRoutes = require("./src/routes/appointments");
const availabilityRoutes = require("./src/routes/availability");
const adminRoutes = require("./src/routes/admin");

const app = express();

app.set("trust proxy", 1);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const mongoUri = process.env.MONGODB_URI;

app.use(
  session({
    name: "campusconnect.sid",
    secret: process.env.SESSION_SECRET || "development-secret-change-me",
    resave: false,
    saveUninitialized: false,
    store: mongoUri
      ? MongoStore.create({
          mongoUrl: mongoUri,
          collectionName: "sessions",
          ttl: 60 * 60 * 8,
        })
      : undefined,
    cookie: {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 1000 * 60 * 60 * 8,
    },
  })
);

app.use(express.static(path.join(__dirname, "public")));

app.use("/api/auth", authRoutes);
app.use("/api/appointments", appointmentRoutes);
app.use("/api/availability", availabilityRoutes);
app.use("/api/admin", adminRoutes);

app.get("/api/health", (req, res) => {
  res.json({
    ok: true,
    database:
      mongoose.connection.readyState === 1
        ? "connected"
        : "disconnected",
  });
});

app.get("*", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "index.html"));
});

const PORT = process.env.PORT || 3000;

async function startServer() {
  try {
    if (!mongoUri) {
      throw new Error("MONGODB_URI is missing from environment variables.");
    }

    await mongoose.connect(mongoUri);
    console.log("Connected to MongoDB");

    await require("./src/models/Availability").createIndexes();
    await require("./src/models/Appointment").createIndexes();

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`CampusConnect running on port ${PORT}`);
    });
  } catch (err) {
    console.error("Application startup failed:", err.message);
    process.exit(1);
  }
}

startServer();
