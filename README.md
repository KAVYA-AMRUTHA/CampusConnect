# CampusConnect — College Faculty Appointment Booking System

Full-stack lab activity based on the supplied Appointment Booking and Management System DOCX.

## Stack
- Frontend: HTML, CSS, JavaScript, Bootstrap 5
- Backend: Node.js, Express.js
- Database: MongoDB, Mongoose
- Authentication: Express sessions, bcrypt password hashing

## Requirements
Install Node.js LTS and MongoDB Community Server for Windows. Install MongoDB Compass during setup if offered.

## Setup
1. Start MongoDB service (`Win + R` -> `services.msc` -> MongoDB -> Start).
2. Open this project folder in VS Code.
3. In the VS Code terminal run:
   ```powershell
   npm install
   Copy-Item .env.example .env
   ```
4. Open `.env` and set a long random `SESSION_SECRET`. Keep the default local MongoDB URI unless you changed your setup.
5. Start the application:
   ```powershell
   npm run dev
   ```
6. Open `http://localhost:3000`.

## Create the first admin
For safe setup, first add this line to `.env`:
`ADMIN_SETUP_KEY=choose-a-temporary-setup-key`
Restart the server. Use a REST client to POST JSON to `http://localhost:3000/api/auth/setup-admin`:
```json
{
  "setupKey": "choose-a-temporary-setup-key",
  "name": "System Administrator",
  "email": "admin@college.edu",
  "password": "ChangeMe123"
}
```
Then log in on the website using that email/password. Remove `ADMIN_SETUP_KEY` from `.env` and restart after creating the admin.

## First demo flow
1. Log in as admin.
2. Create a faculty account from the admin dashboard.
3. Add faculty availability for a future date and time.
4. Log out and register a student account.
5. Book the available slot. A booking ID and Pending status will be displayed.
6. Log in as admin and approve, reschedule, complete or cancel the appointment.
7. Log in as the student to view status and notifications.

## MongoDB collections
- `users`: name, email, passwordHash, role, department
- `appointments`: userId, providerId, service, date, startTime, endTime, status, bookingId, message
- `availability`: providerId, date, startTime, endTime, isAvailable
- `notifications`: userId, appointmentId, message, deliveryStatus

## Notes
- Registration creates student accounts only. Admin creates faculty accounts.
- Availability slots are atomically claimed so simultaneous booking requests cannot both claim the same slot.
- This lab build uses local MongoDB. For deployment, configure HTTPS, secure cookies, rate limiting, stronger admin provisioning, and production secrets.
- The reschedule UI uses a simple numbered prompt to keep the lab build dependency-free; it can be upgraded to a modal/calendar UI later.
