const nodemailer = require("nodemailer");

function getTransporter() {
  const user = process.env.EMAIL_USER;
  const pass = String(process.env.EMAIL_APP_PASSWORD || "").replace(/\s+/g, "");
  if (!user || !pass) return null;
  return nodemailer.createTransport({
    service: "gmail",
    auth: { user, pass }
  });
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[ch]));
}

async function sendEmail({ to, subject, text, html }) {
  const transporter = getTransporter();
  if (!transporter) {
    console.warn("Email not sent: EMAIL_USER or EMAIL_APP_PASSWORD is not configured.");
    return { sent: false, reason: "Email is not configured." };
  }
  if (!to) return { sent: false, reason: "Recipient email is missing." };
  try {
    await transporter.sendMail({
      from: process.env.EMAIL_FROM || process.env.EMAIL_USER,
      to,
      subject,
      text,
      html
    });
    return { sent: true };
  } catch (error) {
    console.error("Email delivery failed:", error.message);
    return { sent: false, reason: error.message };
  }
}

function appointmentEmail({ to, studentName, facultyName, department, bookingId, date, startTime, endTime, service, status, message, subjectPrefix = "CampusConnect appointment update" }) {
  const fields = [
    ["Booking ID", bookingId],
    ["Student", studentName],
    ["Faculty", facultyName],
    ["Department", department || "Not specified"],
    ["Date", date],
    ["Time", `${startTime}–${endTime}`],
    ["Purpose", service],
    ["Status", status]
  ];
  const text = `${message}\n\n${fields.map(([label, value]) => `${label}: ${value}`).join("\n")}\n\nCampusConnect — College Faculty Appointment Booking System`;
  const rows = fields.map(([label, value]) => `<tr><td style="padding:8px 12px;color:#64748b;border-bottom:1px solid #e2e8f0">${escapeHtml(label)}</td><td style="padding:8px 12px;font-weight:600;border-bottom:1px solid #e2e8f0">${escapeHtml(value)}</td></tr>`).join("");
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:Arial,sans-serif;color:#0f172a;padding:24px"><div style="max-width:620px;margin:auto;background:#fff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0"><div style="background:#243b53;color:#fff;padding:24px"><div style="font-size:12px;letter-spacing:2px;color:#cbd5e1">CAMPUSCONNECT</div><h1 style="font-size:22px;margin:10px 0 0">${escapeHtml(subjectPrefix)}</h1></div><div style="padding:24px"><p>${escapeHtml(message)}</p><table style="width:100%;border-collapse:collapse">${rows}</table><p style="font-size:12px;color:#64748b;margin-top:24px">This is an automated email from CampusConnect. Please do not reply directly to this message.</p></div></div></body></html>`;
  return sendEmail({ to, subject: `${subjectPrefix} · ${bookingId}`, text, html });
}

module.exports = { sendEmail, appointmentEmail };
