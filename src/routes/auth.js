const router = require("express").Router();
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");

router.post("/register", async (req, res) => {
  try {
    const { name, email, password, department } = req.body;
    if (!name || !email || !password) return res.status(400).json({ message: "Name, email and password are required." });
    if (password.length < 8) return res.status(400).json({ message: "Password must contain at least 8 characters." });
    const normalizedEmail = String(email).trim().toLowerCase();
    if (await User.findOne({ email: normalizedEmail })) return res.status(409).json({ message: "An account with this email already exists." });
    const user = await User.create({
      name: String(name).trim(), email: normalizedEmail,
      passwordHash: await bcrypt.hash(password, 12),
      department: department || "General",
      role: "student"
    });
    req.session.user = { id: user._id.toString(), name: user.name, email: user.email, role: user.role, department: user.department };
    res.status(201).json({ message: "Account created successfully.", user: req.session.user });
  } catch (e) { res.status(500).json({ message: "Could not register account." }); }
});
router.post("/login", async (req, res) => {
  try {
    const user = await User.findOne({ email: String(req.body.email || "").trim().toLowerCase() });
    if (!user || !(await bcrypt.compare(req.body.password || "", user.passwordHash))) return res.status(401).json({ message: "Invalid email or password." });
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ message: "Could not start session." });
      req.session.user = { id: user._id.toString(), name: user.name, email: user.email, role: user.role, department: user.department };
      res.json({ message: "Login successful.", user: req.session.user });
    });
  } catch (e) { res.status(500).json({ message: "Could not log in." }); }
});
router.post("/logout", (req, res) => req.session.destroy(() => res.json({ message: "Logged out." })));
router.get("/me", (req, res) => res.json({ user: req.session.user || null }));
router.get("/faculty", async (req, res) => {
  const users = await User.find({ role: "faculty" }).select("name email department");
  res.json(users);
});
// Development helper: create the first admin only if no admin exists. Set ADMIN_SETUP_KEY in .env.
router.post("/setup-admin", async (req, res) => {
  try {
    if (!process.env.ADMIN_SETUP_KEY || req.body.setupKey !== process.env.ADMIN_SETUP_KEY) return res.status(403).json({ message: "Admin setup is disabled or key is incorrect." });
    if (await User.exists({ role: "admin" })) return res.status(409).json({ message: "An admin account already exists." });
    const { name, email, password } = req.body;
    if (!name || !email || !password || password.length < 8) return res.status(400).json({ message: "Provide name, email and a password of at least 8 characters." });
    const user = await User.create({ name, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 12), role: "admin" });
    res.status(201).json({ message: "Admin created. Log in using these credentials." });
  } catch (e) { res.status(500).json({ message: "Could not create admin." }); }
});
module.exports = router;
