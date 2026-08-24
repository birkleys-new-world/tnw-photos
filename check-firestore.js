// check-firestore.js — mints a token and confirms the DB + APIs are live.
const fs = require("fs");
const https = require("https");
const cfgPath = process.env.APPDATA + "/configstore/firebase-tools.json";
const refresh = JSON.parse(fs.readFileSync(cfgPath, "utf8")).tokens.refresh_token;
const CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";
const PROJ = "tnw-photos-180063";

function get(url, token) {
  return new Promise((res, rej) => {
    const u = new URL(url);
    const r = https.request({ hostname: u.hostname, path: u.pathname + u.search, method: "GET", headers: { Authorization: "Bearer " + token } }, (rr) => {
      let d = ""; rr.on("data", (c) => (d += c)); rr.on("end", () => res({ code: rr.statusCode, body: d }));
    });
    r.on("error", rej); r.end();
  });
}
(async () => {
  const body = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }).toString();
  const tok = await new Promise((res, rej) => {
    const r = https.request({ hostname: "oauth2.googleapis.com", path: "/token", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } }, (rr) => { let d = ""; rr.on("data", (c) => (d += c)); rr.on("end", () => res(JSON.parse(d).access_token)); });
    r.on("error", rej); r.write(body); r.end();
  });
  const db = await get(`https://firestore.googleapis.com/v1/projects/${PROJ}/databases/(default)`, tok);
  console.log("Firestore DB:", db.code, db.body.slice(0, 120));
})().catch((e) => console.log("ERR", e.message));
