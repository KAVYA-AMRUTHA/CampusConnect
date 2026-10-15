const router = require("express").Router();
const bcrypt = require("bcryptjs");
const User = require("../models/User");
const { requireAdmin } = require("../middleware/auth");

router.get("/faculty", requireAdmin, async (req, res) => {
  res.json(await User.find({ role: "faculty" }).select("name email department").sort({ name: 1 }));
});
router.post("/faculty", requireAdmin, async (req, res) => {
  try {
    const { name, email, password, department } = req.body;
    if (!name || !email || !password || password.length < 8) return res.status(400).json({ message: "Name, email and password (8+ characters) are required." });
    const user = await User.create({ name, email: email.toLowerCase(), passwordHash: await bcrypt.hash(password, 12), role: "faculty", department: department || "General" });
    res.status(201).json({ message: "Faculty account created.", faculty: { id: user._id, name: user.name, email: user.email, department: user.department } });
  } catch (e) { if (e.code === 11000) return res.status(409).json({ message: "Email already exists." }); res.status(500).json({ message: "Could not create faculty account." }); }
});
module.exports = router;
