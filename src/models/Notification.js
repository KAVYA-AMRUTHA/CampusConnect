const mongoose = require("mongoose");
const schema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  appointmentId: { type: mongoose.Schema.Types.ObjectId, ref: "Appointment" },
  message: { type: String, required: true },
  deliveryStatus: { type: String, enum: ["Displayed", "Pending", "Failed"], default: "Displayed" }
}, { timestamps: true });
module.exports = mongoose.model("Notification", schema);
