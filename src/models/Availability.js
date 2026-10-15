const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  providerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  date: { type: String, required: true },
  startTime: { type: String, required: true },
  endTime: { type: String, required: true },
  isAvailable: { type: Boolean, default: true }
}, { timestamps: true });
schema.index({ providerId: 1, date: 1, startTime: 1 }, { unique: true });
module.exports = mongoose.model("Availability", schema);
