function requireAuth(req, res, next) {
  if (!req.session.user) return res.status(401).json({ message: "Please log in first." });
  next();
}
function requireAdmin(req, res, next) {
  if (!req.session.user) return res.status(401).json({ message: "Please log in first." });
  if (!["admin", "faculty"].includes(req.session.user.role)) return res.status(403).json({ message: "Faculty/admin access required." });
  next();
}
module.exports = { requireAuth, requireAdmin };
