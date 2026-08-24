// deploy-storage-rules.js — publish storage.rules to the bucket via REST.
const fs = require("fs");
const https = require("https");
const cfgPath = process.env.HOME + "/.config/configstore/firebase-tools.json";
const refresh = JSON.parse(fs.readFileSync(cfgPath, "utf8")).tokens.refresh_token;
const CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";
const PROJ = "tnw-photos-180063";
const source = fs.readFileSync("storage.rules", "utf8");

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
  // storage rules live under the firebaserules service too, but the resource is a "release"
  // for STORAGE. The ruleset content type must declare service firebase.storage.
  const rs = await req({ hostname: "firebaserules.googleapis.com", path: `/v1/projects/${PROJ}/rulesets`, method: "POST", headers: H }, JSON.stringify({ source: { files: [{ name: "storage.rules", content: source }] } }));
  console.log("ruleset:", rs.code, JSON.stringify(rs.body).slice(0, 200));
  const name = rs.body.name;
  // release for storage (resource id is the bucket style; use releases/storage)
  const rel = await req({ hostname: "firebaserules.googleapis.com", path: `/v1/projects/${PROJ}/releases/storage`, method: "PATCH", headers: H }, JSON.stringify({ name: `projects/${PROJ}/releases/storage`, rulesetName: name }));
  console.log("release:", rel.code, JSON.stringify(rel.body).slice(0, 200));
})().catch((e) => console.log("ERR", e.message));
