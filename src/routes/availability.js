
const router = require("express").Router();
const mongoose = require("mongoose");
const Availability = require("../models/Availability");
const User = require("../models/User");
const { requireAuth } = require("../middleware/auth");

function getUserId(req) {
  return req.session?.user?.id || req.session?.user?._id;
}

function isAdmin(req) {
  return req.session?.user?.role === "admin";
}

function isFaculty(req) {
  return req.session?.user?.role === "faculty";
}

function requireStaff(req, res, next) {
  if (!req.session?.user) {
    return res.status(401).json({ message: "Please log in first." });
  }

  if (!["admin", "faculty"].includes(req.session.user.role)) {
    return res.status(403).json({
      message: "Only administrators and faculty can manage availability."
    });
  }

  next();
}

// List available slots.
// Students can see all available slots.
// Faculty can optionally filter slots by their own account.
router.get("/", async (req, res) => {
  try {
    const { date, providerId } = req.query;
    const filter = { isAvailable: true };

    if (date) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ message: "Invalid date format." });
      }
      filter.date = date;
    }

    if (providerId) {
      if (!mongoose.Types.ObjectId.isValid(providerId)) {
        return res.status(400).json({ message: "Invalid faculty ID." });
      }
      filter.providerId = providerId;
    }

    const slots = await Availability.find(filter)
      .populate("providerId", "name department")
      .sort({ date: 1, startTime: 1 });

    res.json(slots);
  } catch (error) {
    console.error("List availability error:", error);
    res.status(500).json({ message: "Could not load availability." });
  }
});

// Create a slot.
// Admins can create a slot for a selected faculty member.
// Faculty can create slots only for themselves.
router.post("/", requireAuth, requireStaff, async (req, res) => {
  try {
    const { date, startTime, endTime } = req.body;
    let { providerId } = req.body;

    if (!date || !startTime || !endTime) {
      return res.status(400).json({
        message: "Date, start time and end time are required."
      });
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ message: "Invalid date format." });
    }

    if (!/^\d{2}:\d{2}$/.test(startTime) ||
        !/^\d{2}:\d{2}$/.test(endTime)) {
      return res.status(400).json({
        message: "Use valid 24-hour start and end times."
      });
    }

    if (startTime >= endTime) {
      return res.status(400).json({
        message: "End time must be later than start time."
      });
    }

    const today = new Date();
    const localToday = new Date(
      today.getTime() - today.getTimezoneOffset() * 60000
    ).toISOString().slice(0, 10);

    if (date < localToday) {
      return res.status(400).json({
        message: "Availability cannot be created for a past date."
      });
    }

    // Never trust a faculty-supplied providerId.
    if (isFaculty(req)) {
      providerId = getUserId(req);
    }

    if (!providerId || !mongoose.Types.ObjectId.isValid(providerId)) {
      return res.status(400).json({
        message: "Choose a valid faculty member."
      });
    }

    const provider = await User.findById(providerId);

    if (!provider || provider.role !== "faculty") {
      return res.status(400).json({
        message: "Select a valid faculty account."
      });
    }

    // Reject every overlapping time interval for the same faculty/date.
    // Existing interval: existing.startTime < new.endTime
    // and existing.endTime > new.startTime.
    const overlapping = await Availability.findOne({
      providerId,
      date,
      startTime: { $lt: endTime },
      endTime: { $gt: startTime }
    });

    if (overlapping) {
      return res.status(409).json({
        message: "This time overlaps with an existing slot. Choose another time."
      });
    }

    const slot = await Availability.create({
      date,
      startTime,
      endTime,
      providerId,
      isAvailable: true
    });

    res.status(201).json({
      message: "Availability slot added.",
      slot
    });
  } catch (error) {
    console.error("Create availability error:", error);

    if (error.code === 11000) {
      return res.status(409).json({
        message: "A slot already exists for this faculty member and start time."
      });
    }

    res.status(500).json({ message: "Could not create slot." });
  }
});

// Remove an unbooked slot.
// Faculty may remove only their own unbooked slots.
router.delete("/:id", requireAuth, requireStaff, async (req, res) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ message: "Invalid slot ID." });
    }

    const slot = await Availability.findById(req.params.id);

    if (!slot) {
      return res.status(404).json({ message: "Slot not found." });
    }

    if (isFaculty(req) &&
        String(slot.providerId) !== String(getUserId(req))) {
      return res.status(403).json({
        message: "You can manage only your own availability."
      });
    }

    if (!slot.isAvailable) {
      return res.status(409).json({
        message: "Booked slots cannot be removed. Cancel or reschedule the appointment first."
      });
    }

    await slot.deleteOne();

    res.json({ message: "Availability slot removed." });
  } catch (error) {
    console.error("Delete availability error:", error);
    res.status(500).json({ message: "Could not remove the slot." });
  }
});

module.exports = router;
