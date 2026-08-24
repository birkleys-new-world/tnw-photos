// create-bucket.js — create the default GCS bucket for Firebase Storage (needs billing linked).
const fs = require("fs");
const https = require("https");
const cfgPath = process.env.HOME + "/.config/configstore/firebase-tools.json";
const refresh = JSON.parse(fs.readFileSync(cfgPath, "utf8")).tokens.refresh_token;
const CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";
const PROJ = "tnw-photos-180063";
const BUCKET = PROJ + ".appspot.com";

function req(o, b) {
  return new Promise((res, rej) => {
    const r = https.request(o, (rr) => { let d = ""; rr.on("data", (c) => (d += c)); rr.on("end", () => { let j = null; try { j = JSON.parse(d); } catch (_) {} res({ code: rr.statusCode, body: j || d }); }); });
    r.on("error", rej); if (b) r.write(b); r.end();
  });
}
(async () => {
  const body = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }).toString();
  const tok = await new Promise((res, rej) => { const r = https.request({ hostname: "oauth2.googleapis.com", path: "/token", method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" } }, (rr) => { let d = ""; rr.on("data", (c) => (d += c)); rr.on("end", () => res(JSON.parse(d).access_token)); }); r.on("error", rej); r.write(body); r.end(); });
  const H = { Authorization: "Bearer " + tok, "Content-Type": "application/json" };
  const ins = await req({ hostname: "storage.googleapis.com", path: "/storage/v1/b?project=" + PROJ, method: "POST", headers: H }, JSON.stringify({ name: BUCKET, location: "US", storageClass: "STANDARD" }));
  console.log("insert bucket", ins.code, JSON.stringify(ins.body).slice(0, 250));
  if (ins.code >= 300) return;
  // probe upload + delete
  const probe = Buffer.from("tnw-probe");
  const up = await req({ hostname: BUCKET + ".storage.googleapis.com", path: "/tnw-probe.txt", method: "POST", headers: { Authorization: "Bearer " + tok, "Content-Type": "text/plain", "Content-Length": probe.length, "x-goog-upload-protocol": "simple" } }, probe);
  console.log("upload probe", up.code);
  const del = await req({ hostname: BUCKET + ".storage.googleapis.com", path: "/tnw-probe.txt", method: "DELETE", headers: { Authorization: "Bearer " + tok } });
  console.log("delete probe", del.code);
})().catch((e) => console.log("ERR", e.message));
