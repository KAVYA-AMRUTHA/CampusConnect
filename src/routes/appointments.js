const router = require("express").Router();
const mongoose = require("mongoose");
const crypto = require("crypto");
const Appointment = require("../models/Appointment");
const Availability = require("../models/Availability");
const Notification = require("../models/Notification");
const User = require("../models/User");
const { sendEmail, appointmentEmail } = require("../services/emailService");
const { requireAuth } = require("../middleware/auth");

const getId = value => value ? String(value._id || value.id || value) : "";
const role = req => req.session.user?.role;
const isAdmin = req => role(req) === "admin";
const isFaculty = req => role(req) === "faculty";
const isStudent = req => role(req) === "student";
function requireStaff(req, res, next) {
  if (!req.session.user) return res.status(401).json({ message: "Please log in first." });
  if (!["admin", "faculty"].includes(role(req))) return res.status(403).json({ message: "Faculty/admin access required." });
  next();
}
async function ensureToken(appointment) {
  if (!appointment.verificationToken) {
    appointment.verificationToken = crypto.randomBytes(32).toString("hex");
    await appointment.save();
  }
  return appointment;
}
async function notifyStudent(appointment, message) {
  try {
    await Notification.create({ userId: appointment.userId, appointmentId: appointment._id, message, deliveryStatus: "Displayed" });
  } catch (error) {
    console.error("Notification creation failed:", error.message);
  }
}

async function emailAppointmentStudent(appointment, message, subjectPrefix) {
  try {
    const student = await User.findById(getId(appointment.userId)).select("name email");
    const faculty = await User.findById(getId(appointment.providerId)).select("name department");
    if (!student?.email) {
      console.warn("Appointment email skipped: student email not found.");
      return;
    }
    await appointmentEmail({
      to: student.email,
      studentName: student.name,
      facultyName: faculty?.name || "Faculty",
      department: faculty?.department || "",
      bookingId: appointment.bookingId,
      date: appointment.date,
      startTime: appointment.startTime,
      endTime: appointment.endTime,
      service: appointment.service,
      status: appointment.status,
      message,
      subjectPrefix
    });
  } catch (error) {
    console.error("Could not prepare appointment email:", error.message);
  }
}
function appointmentPayload(appointment) {
  return {
    bookingId: appointment.bookingId,
    studentName: appointment.userId?.name || "Student",
    facultyName: appointment.providerId?.name || "Faculty",
    department: appointment.providerId?.department || "",
    date: appointment.date,
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    service: appointment.service,
    status: appointment.status,
    checkedInAt: appointment.checkedInAt || null,
    alreadyCheckedIn: Boolean(appointment.checkedInAt)
  };
}

/* Students book an available slot; the atomic claim prevents two users taking it. */
router.post("/", requireAuth, async (req, res) => {
  let claimedSlot;
  try {
    if (!isStudent(req)) return res.status(403).json({ message: "Only students can book appointments." });
    const { slotId, service, message } = req.body;
    if (!slotId || !mongoose.isValidObjectId(slotId) || !String(service || "").trim())
      return res.status(400).json({ message: "Choose an available slot and enter the appointment purpose." });
    claimedSlot = await Availability.findOneAndUpdate(
      { _id: slotId, isAvailable: true },
      { $set: { isAvailable: false } },
      { new: true }
    );
    if (!claimedSlot) return res.status(409).json({ message: "This slot has just been booked. Please choose another." });
    const bookingId = "FAC-" + new mongoose.Types.ObjectId().toString().slice(-8).toUpperCase();
    const appointment = await Appointment.create({
      userId: req.session.user.id, providerId: claimedSlot.providerId,
      service: String(service).trim(), date: claimedSlot.date,
      startTime: claimedSlot.startTime, endTime: claimedSlot.endTime,
      message: String(message || "").trim(), status: "Pending", bookingId,
      verificationToken: crypto.randomBytes(32).toString("hex")
    });
    await notifyStudent(appointment, `Booking ${bookingId} submitted. Status: Pending.`);
    await emailAppointmentStudent(appointment, `Your appointment request has been received and is awaiting faculty approval.`, "Appointment request received");
    return res.status(201).json({ message: "Appointment booked successfully.", appointment });
  } catch (error) {
    if (claimedSlot) await Availability.updateOne({ _id: claimedSlot._id }, { $set: { isAvailable: true } }).catch(() => {});
    if (error.code === 11000) return res.status(409).json({ message: "Could not generate a unique booking. Please try again." });
    console.error("Booking failed:", error);
    return res.status(500).json({ message: "Booking failed. Please try again." });
  }
});

router.get("/mine", requireAuth, async (req, res) => {
  if (!isStudent(req)) return res.status(403).json({ message: "Student access required." });
  const items = await Appointment.find({ userId: req.session.user.id })
    .populate("providerId", "name department").sort({ createdAt: -1 });
  for (const item of items) await ensureToken(item);
  res.json(items);
});

router.get("/", requireStaff, async (req, res) => {
  const filter = isFaculty(req) ? { providerId: req.session.user.id } : {};
  const items = await Appointment.find(filter)
    .populate("userId", "name email").populate("providerId", "name department")
    .sort({ date: 1, startTime: 1 });
  for (const item of items) await ensureToken(item);
  res.json(items);
});

router.patch("/:id/status", requireStaff, async (req, res) => {
  const allowed = ["Pending", "Approved", "Cancelled", "Completed"];
  if (!allowed.includes(req.body.status)) return res.status(400).json({ message: "Invalid appointment status." });
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(400).json({ message: "Invalid appointment ID." });
  const filter = { _id: req.params.id };
  if (isFaculty(req)) filter.providerId = req.session.user.id;
  const appointment = await Appointment.findOne(filter);
  if (!appointment) return res.status(404).json({ message: "Appointment not found or not assigned to you." });
  if (["Cancelled", "Completed"].includes(appointment.status) && req.body.status !== appointment.status)
    return res.status(409).json({ message: "This appointment is already closed." });
  const oldStatus = appointment.status;
  appointment.status = req.body.status;
  await appointment.save();
  if (req.body.status === "Cancelled" && oldStatus !== "Cancelled") {
    await Availability.updateOne({
      providerId: appointment.providerId, date: appointment.date,
      startTime: appointment.startTime, endTime: appointment.endTime, isAvailable: false
    }, { $set: { isAvailable: true } });
  }
  await notifyStudent(appointment, `Booking ${appointment.bookingId} status updated to ${appointment.status}.`);
  const statusMessages = {
    Approved: "Your appointment has been approved.",
    Cancelled: "Your appointment has been cancelled.",
    Completed: "Your appointment has been marked as completed.",
    Pending: "Your appointment status has been updated."
  };
  await emailAppointmentStudent(appointment, statusMessages[appointment.status] || `Your appointment status is now ${appointment.status}.`, `Appointment ${appointment.status.toLowerCase()}`);
  res.json({ message: "Appointment status updated.", appointment });
});

router.patch("/:id/reschedule", requireStaff, async (req, res) => {
  let nextSlot;
  try {
    if (!mongoose.isValidObjectId(req.params.id) || !mongoose.isValidObjectId(req.body.slotId))
      return res.status(400).json({ message: "Invalid appointment or slot ID." });
    const filter = { _id: req.params.id };
    if (isFaculty(req)) filter.providerId = req.session.user.id;
    const appointment = await Appointment.findOne(filter);
    if (!appointment) return res.status(404).json({ message: "Appointment not found or not assigned to you." });
    if (["Cancelled", "Completed"].includes(appointment.status)) return res.status(409).json({ message: "This appointment cannot be rescheduled." });
    const slotFilter = { _id: req.body.slotId, isAvailable: true };
    if (isFaculty(req)) slotFilter.providerId = req.session.user.id;
    nextSlot = await Availability.findOneAndUpdate(slotFilter, { $set: { isAvailable: false } }, { new: true });
    if (!nextSlot) return res.status(409).json({ message: "The new slot is no longer available." });
    if (String(nextSlot.providerId) === String(appointment.providerId) && nextSlot.date === appointment.date && nextSlot.startTime === appointment.startTime) {
      await Availability.updateOne({ _id: nextSlot._id }, { $set: { isAvailable: true } });
      return res.status(400).json({ message: "Choose a different slot." });
    }
    const old = { providerId: appointment.providerId, date: appointment.date, startTime: appointment.startTime, endTime: appointment.endTime };
    appointment.providerId = nextSlot.providerId; appointment.date = nextSlot.date;
    appointment.startTime = nextSlot.startTime; appointment.endTime = nextSlot.endTime;
    appointment.status = "Rescheduled";
    await appointment.save();
    await Availability.updateOne({ ...old, isAvailable: false }, { $set: { isAvailable: true } });
    await notifyStudent(appointment, `Booking ${appointment.bookingId} was rescheduled.`);
    await emailAppointmentStudent(appointment, "Your appointment has been rescheduled. Please review the updated date and time below.", "Appointment rescheduled");
    res.json({ message: "Appointment rescheduled.", appointment });
  } catch (error) {
    if (nextSlot) await Availability.updateOne({ _id: nextSlot._id }, { $set: { isAvailable: true } }).catch(() => {});
    console.error("Reschedule failed:", error);
    res.status(500).json({ message: "Could not reschedule appointment." });
  }
});

/* QR token verification reveals details only to the assigned faculty or an administrator. */
router.post("/verify", requireStaff, async (req, res) => {
  const token = String(req.body.token || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ message: "Invalid QR token." });
  const appointment = await Appointment.findOne({ verificationToken: token })
    .populate("userId", "name email").populate("providerId", "name department");
  if (!appointment) return res.status(404).json({ message: "This QR code is not recognized." });
  if (isFaculty(req) && getId(appointment.providerId) !== getId(req.session.user.id))
    return res.status(403).json({ message: "This appointment belongs to another faculty member." });
  const payload = appointmentPayload(appointment);
  const canCheckIn = ["Approved", "Rescheduled"].includes(appointment.status) &&
    appointment.date === new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" }) &&
    !appointment.checkedInAt;
  res.json({ ...payload, canCheckIn });
});

router.post("/check-in", requireStaff, async (req, res) => {
  const token = String(req.body.token || "").trim();
  if (!/^[a-f0-9]{64}$/i.test(token)) return res.status(400).json({ message: "Invalid QR token." });
  const appointment = await Appointment.findOne({ verificationToken: token })
    .populate("userId", "name email").populate("providerId", "name department");
  if (!appointment) return res.status(404).json({ message: "This QR code is not recognized." });
  if (isFaculty(req) && getId(appointment.providerId) !== getId(req.session.user.id))
    return res.status(403).json({ message: "This appointment belongs to another faculty member." });
  if (!["Approved", "Rescheduled"].includes(appointment.status))
    return res.status(409).json({ message: "Only approved appointments can be checked in." });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  if (appointment.date !== today) return res.status(409).json({ message: "Check-in is only available on the appointment date." });
  if (appointment.checkedInAt) return res.status(409).json({ message: "This student has already been checked in." });
  const updated = await Appointment.findOneAndUpdate(
    { _id: appointment._id, checkedInAt: null },
    { $set: { checkedInAt: new Date(), checkedInBy: req.session.user.id } },
    { new: true }
  ).populate("userId", "name email").populate("providerId", "name department");
  if (!updated) return res.status(409).json({ message: "This student has already been checked in." });
  await notifyStudent(updated, `You have been checked in for booking ${updated.bookingId}.`);
  await emailAppointmentStudent(updated, "Your arrival has been recorded by faculty.", "Appointment check-in confirmed");
  res.json({ ...appointmentPayload(updated), canCheckIn: false, message: "Student check-in recorded." });
});

router.post("/email-test", requireAuth, async (req, res) => {
  try {
    const user = await User.findById(req.session.user.id).select("name email");
    if (!user?.email) return res.status(400).json({ message: "Your account does not have an email address." });
    const result = await sendEmail({
      to: user.email,
      subject: "CampusConnect email test",
      text: `Hello ${user.name},\n\nYour CampusConnect email configuration is working.\n\nThis is a test message.`,
      html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:20px auto;padding:24px;border:1px solid #e2e8f0;border-radius:12px"><h2 style="color:#243b53">CampusConnect email test</h2><p>Hello ${String(user.name || "there").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))},</p><p>Your CampusConnect email configuration is working.</p></div>`
    });
    if (!result.sent) return res.status(503).json({ message: result.reason || "Email could not be sent. Check server configuration." });
    return res.json({ message: `Test email sent to ${user.email}. Check your inbox and spam folder.` });
  } catch (error) {
    console.error("Email test failed:", error.message);
    return res.status(500).json({ message: "Could not send test email." });
  }
});

router.get("/notifications", requireAuth, async (req, res) => {
  const items = await Notification.find({ userId: req.session.user.id }).sort({ createdAt: -1 }).limit(30);
  res.json(items);
});

module.exports = router;
