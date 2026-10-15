const mongoose = require("mongoose");

const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  service: { type: String, required: true, trim: true, maxlength: 160 },
  date: { type: String, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  message: { type: String, default: "", maxlength: 1000 },
  status: { type: String, enum: ["Pending", "Approved", "Rescheduled", "Cancelled", "Completed"], default: "Pending" },
  bookingId: { type: String, unique: true, required: true },
  verificationToken: { type: String, unique: true, sparse: true },
  checkedInAt: { type: Date, default: null },
  checkedInBy: { type: mongoose.Schema.Types.ObjectId, ref: "User", default: null }
}, { timestamps: true });

schema.index({ providerId: 1, date: 1, startTime: 1, status: 1 });
schema.index({ verificationToken: 1 }, { unique: true, sparse: true });
module.exports = mongoose.model("Appointment", schema);
