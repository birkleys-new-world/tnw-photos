// provision.js — fully-REST Firebase project provisioning (no gcloud, no CLI python).
// Mints an access token from the existing Firebase CLI login, then builds the project.
const fs = require("fs");
const https = require("https");
const crypto = require("crypto");

const CONFIG_PATHS = [
  process.env.APPDATA + "/configstore/firebase-tools.json",
  (process.env.HOME || process.env.USERPROFILE) + "/.config/configstore/firebase-tools.json",
  "C:/Users/" + (process.env.USERNAME || "birkl") + "/.config/configstore/firebase-tools.json",
];
const cfgPath = CONFIG_PATHS.find((p) => p && fs.existsSync(p));
if (!cfgPath) { console.error("NO_CONFIGSTORE"); process.exit(1); }
const refresh = JSON.parse(fs.readFileSync(cfgPath, "utf8")).tokens.refresh_token;
const CLIENT_ID = "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com";
const CLIENT_SECRET = "j9iVZfS8kkCEFUPaAeJV0sAi";

function req(opts, body, depth = 0) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, (res) => {
      let d = "";
      res.on("data", (c) => (d += c));
      res.on("end", () => {
        let json = null;
        try { json = JSON.parse(d); } catch (_) {}
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(json);
        else if (res.statusCode === 429 && depth < 3) {
          const wait = (res.headers["retry-after"] || 2) * 1000;
          setTimeout(() => req(opts, body, depth + 1).then(resolve, reject), wait);
        } else reject(new Error("HTTP " + res.statusCode + " " + (json && JSON.stringify(json).slice(0, 400))));
      });
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}
const post = (url, token, obj) => req({
  hostname: new URL(url).hostname, path: new URL(url).pathname + new URL(url).search,
  method: "POST", headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
}, JSON.stringify(obj));
const get = (url, token) => req({
  hostname: new URL(url).hostname, path: new URL(url).pathname + new URL(url).search,
  method: "GET", headers: { Authorization: "Bearer " + token },
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function pollOp(name, token) {
  // Generic LRO poll for both Cloud Resource Manager and Firebase operations
  for (let i = 0; i < 40; i++) {
    await sleep(2000);
    let url;
    if (name.startsWith("operations/")) url = "https://cloudresourcemanager.googleapis.com/v1/" + name;
    else url = "https://firebase.googleapis.com/v1beta1/operations/" + name.replace(/^operations\//, "");
    try {
      const op = await get(url, token);
      if (op.done) return op;
    } catch (e) { /* keep polling */ }
  }
  throw new Error("operation poll timeout: " + name);
}

(async () => {
  // 1. mint token
  const tokBody = new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh, grant_type: "refresh_token" }).toString();
  const tok = await new Promise((res, rej) => {
    const r = https.request({ hostname: "oauth2.googleapis.com", path: "/token", method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": Buffer.byteLength(tokBody) } },
      (rr) => { let d = ""; rr.on("data", (c) => (d += c)); rr.on("end", () => { const m = d.match(/"access_token"\s*:\s*"([^"]+)"/); m ? res(m[1]) : rej(new Error("NO_TOKEN " + d.slice(0, 300))); }); });
    r.on("error", rej); r.write(tokBody); r.end();
  });
  console.log("[1] access token minted, len=" + tok.length);

  const rand = crypto.randomBytes(3).toString("hex");
  const PROJ = "tnw-photos-" + rand;
  console.log("[2] projectId candidate: " + PROJ);

  // 2. create GCP project
  try {
    const p = await post("https://cloudresourcemanager.googleapis.com/v1/projects", tok, { projectId: PROJ, name: "TNW Photos" });
    if (p.name && p.name.startsWith("operations/")) await pollOp(p.name, tok);
    console.log("[3] GCP project created: " + PROJ);
  } catch (e) { console.error("[3] create project FAILED: " + e.message); process.exit(1); }

  await sleep(3000);

  // 4. attach Firebase
  try {
    const f = await post("https://firebase.googleapis.com/v1beta1/projects/" + PROJ + ":addFirebase", tok, {});
    if (f.name && f.name.startsWith("operations/")) await pollOp(f.name.replace(/^operations\//, ""), tok);
    console.log("[4] Firebase attached");
  } catch (e) { console.error("[4] addFirebase FAILED: " + e.message); process.exit(1); }

  // 5. create web app
  let APPID = null;
  try {
    const w = await post("https://firebase.googleapis.com/v1beta1/projects/" + PROJ + "/webApps", tok, { displayName: "TNW Photos Web" });
    let op = w;
    if (w.name && w.name.startsWith("operations/")) op = await pollOp(w.name.replace(/^operations\//, ""), tok);
    // op.response.name => projects/.../webApps/APPID
    APPID = (op.response && op.response.name ? op.response.name : (w.response && w.response.name)).split("/webApps/")[1];
    console.log("[5] webApp created: " + APPID);
  } catch (e) { console.error("[5] create webApp FAILED: " + e.message); process.exit(1); }

  // 6. enable APIs
  try {
    await post("https://serviceusage.googleapis.com/v1/projects/" + PROJ + "/services:batchEnable", tok,
      { serviceIds: ["firestore.googleapis.com", "identitytoolkit.googleapis.com"] });
    console.log("[6] APIs batchEnable submitted");
  } catch (e) { console.error("[6] enable APIs FAILED: " + e.message); }

  await sleep(25000); // let APIs settle

  // 7. create Firestore DB
  try {
    const db = await post("https://firestore.googleapis.com/v1/projects/" + PROJ + "/databases?databaseId=(default)", tok,
      { type: "FIRESTORE_NATIVE", locationId: "nam5" });
    console.log("[7] Firestore DB: " + (db.name || JSON.stringify(db)));
  } catch (e) { console.error("[7] create Firestore FAILED: " + e.message); }

  // 8. read web app config (apiKey redacted — user must paste)
  try {
    const cfg = await get("https://firebase.googleapis.com/v1beta1/projects/" + PROJ + "/webApps/" + APPID + "/config", tok);
    console.log("[8] webApp config: " + JSON.stringify(cfg));
  } catch (e) { console.error("[8] get config FAILED: " + e.message); }

  fs.writeFileSync(".firebase-projid", PROJ + "\n" + APPID);
  console.log("DONE proj=" + PROJ + " app=" + APPID);
})().catch((e) => { console.error("FATAL " + e.message); process.exit(1); });
