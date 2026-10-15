
const http = require("http");
const { google } = require("googleapis");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const REDIRECT_URI = "http://localhost:3000/oauth2callback";

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error("ERROR: GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET is missing.");
  process.exit(1);
}

const oauth2Client = new google.auth.OAuth2(
  CLIENT_ID,
  CLIENT_SECRET,
  REDIRECT_URI
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: "offline",
  prompt: "consent",
  scope: ["https://www.googleapis.com/auth/gmail.send"]
});

const server = http.createServer(async (req, res) => {
  const requestUrl = new URL(req.url, REDIRECT_URI);

  if (requestUrl.pathname !== "/oauth2callback") {
    res.writeHead(404);
    return res.end("Not found");
  }

  const error = requestUrl.searchParams.get("error");
  const code = requestUrl.searchParams.get("code");

  if (error || !code) {
    res.writeHead(400);
    res.end("Authorization failed. Check the VS Code terminal.");
    console.error("Authorization error:", error || "No code returned");
    server.close();
    return;
  }

  try {
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.refresh_token) {
      throw new Error(
        "No refresh token received. Revoke previous access and authorize again."
      );
    }

    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(
      "<h2>CampusConnect authorization successful!</h2><p>You can close this tab and return to VS Code.</p>"
    );

    console.log("\nAuthorization successful!");
    console.log("Copy the refresh token into Render environment variables.");
    console.log("\nGOOGLE_REFRESH_TOKEN=");
    console.log(tokens.refresh_token);
    console.log("\nKeep this token secret.");
  } catch (err) {
    res.writeHead(500);
    res.end("Token generation failed. Check VS Code terminal.");
    console.error("Token error:", err.message);
  } finally {
    server.close();
  }
});

server.listen(3000, "127.0.0.1", () => {
  console.log("\nOpen this Google authorization URL in your browser:\n");
  console.log(authUrl);
  console.log("\nWaiting for authorization at http://localhost:3000 ...");
});
