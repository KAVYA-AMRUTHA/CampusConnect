# CampusConnect Gmail email notifications

This upgrade adds Gmail SMTP email for booking submission, approval, cancellation, rescheduling, completion, and QR check-in. Existing in-app notifications remain unchanged. Email failures are logged and do not undo a booking/status change.

## Install
1. Back up your project files.
2. Copy these files into the existing project preserving paths:
   - `src/services/emailService.js` (new)
   - `src/routes/appointments.js` (replace)
   - `package.json` (replace only if you want to use the included dependency list; otherwise run `npm install nodemailer`)
   - `public/index.html` and `public/app.js` are included unchanged from the current analytics build for a complete, consistent archive.
3. Run `npm install nodemailer` in the project terminal.
4. Configure the following in the existing `.env` file:
   ```
   EMAIL_USER=yourgmail@gmail.com
   EMAIL_APP_PASSWORD=your_16_character_google_app_password
   EMAIL_FROM=CampusConnect <yourgmail@gmail.com>
   ```
5. Restart the server with `npm run dev`.
6. Log in to the app and send a test email by running this in the browser console while logged in:
   ```
   fetch('/api/appointments/email-test',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'same-origin'})
     .then(r=>r.json()).then(console.log)
   ```
   The server should report that a test email was sent. Check inbox and spam.

## Create a Gmail App Password
- Enable 2-Step Verification on the Gmail/Google account.
- Open Google Account settings and find App passwords.
- Create one for CampusConnect and copy the generated 16-character password.
- Use the app password, NOT your regular Gmail password.
- Do not commit `.env` or share the app password.

If Google does not offer App passwords for the account, use another SMTP provider or Google Workspace SMTP configuration. This code uses Gmail SMTP and requires internet access.

## Email behavior
- Booking created: email student that the request is Pending.
- Status changed: email student on approval, cancellation, or completion.
- Rescheduled: email student the updated slot details.
- QR check-in: email student that arrival was recorded.
- In-app MongoDB notifications continue to be created separately.
