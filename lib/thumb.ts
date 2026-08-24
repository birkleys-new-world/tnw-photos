// Client-side thumbnail generation + ingestion helpers (runs in the browser).

// Broad set of photo extensions we accept on ingest. Browser can only *decode*
// a subset (jpeg/png/webp/gif/avif + heic/heif on Safari); everything else
// (RAW, tiff, bmp) gets a real thumbnail from its EMBEDDED PREVIEW (Canon CR2
// and most RAWs embed a JPEG preview), decoded client-side — no raw codec needed.
export const PHOTO_EXTS = [
  "jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "avif", "bmp",
  "tif", "tiff",
  // RAW formats
  "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "dng", "raf",
  "rw2", "rwl", "orf", "pef", "srw", "raw", "mrw", "3fr", "fff", "dcr",
  "k25", "kdc", "x3f", "mdc", "mos", "erf", "iiq", "cap", "dcs", "drf",
  "mef", "ptx", "pxn",
];

const RAW_EXTS = new Set([
  "cr2", "cr3", "crw", "nef", "nrw", "arw", "srf", "sr2", "dng", "raf",
  "rw2", "rwl", "orf", "pef", "srw", "raw", "mrw", "3fr", "fff", "dcr",
  "k25", "kdc", "x3f", "mdc", "mos", "erf", "iiq", "cap", "dcs", "drf",
  "mef", "ptx", "pxn", "tif", "tiff", "bmp",
]);

export function extOf(name: string): string {
  const m = name.toLowerCase().match(/\.([a-z0-9]+)$/);
  return m ? m[1] : "";
}

export function isPhoto(name: string): boolean {
  return PHOTO_EXTS.includes(extOf(name));
}

export function isRaw(name: string): boolean {
  return RAW_EXTS.has(extOf(name));
}

function drawScaled(img: HTMLImageElement, max = 480): { dataUrl: string; width: number; height: number } {
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d");
  ctx.drawImage(img, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.7), width: w, height: h };
}

function loadImageFromBytes(bytes: ArrayBuffer): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes], { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode preview failed")); };
    img.src = url;
  });
}

// Scan a buffer for the first embedded JPEG (FFD8...FFD9). Many RAW files embed
// a full JPEG preview; CR2 also has a smaller IFD-based preview. Returns the JPEG
// bytes or null if none found.
function scanEmbeddedJpeg(buf: ArrayBuffer): ArrayBuffer | null {
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const len = bytes.length;
  for (let i = 0; i < len - 1; i++) {
    if (dv.getUint16(i) === 0xffd8) {
      // find the closing FF D9 from here
      for (let j = i + 2; j < len - 1; j++) {
        if (dv.getUint16(j) === 0xffd9) {
          return buf.slice(i, j + 2);
        }
      }
      // first FFD8 with no clean closing marker -> bail this start
      break;
    }
  }
  return null;
}

async function extractRawPreview(file: File): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const buf = await file.arrayBuffer();
  // 1) exifr: pulls the proper preview (largest embedded JPEG for most formats)
  try {
    const exifr = await import("exifr");
    const preview = await (exifr as any).preview(buf, { maxres: 1024 });
    if (preview && preview.file) {
      const img = await loadImageFromBytes(preview.file);
      return drawScaled(img, 480);
    }
  } catch (_) { /* fall through */ }
  // 2) byte-scan fallback: first embedded JPEG in the file
  try {
    const jpeg = scanEmbeddedJpeg(buf);
    if (jpeg) {
      const img = await loadImageFromBytes(jpeg);
      return drawScaled(img, 480);
    }
  } catch (_) { /* fall through */ }
  return null;
}

function placeholderThumb(name: string): { dataUrl: string; width: number; height: number } {
  const c = document.createElement("canvas");
  c.width = 480; c.height = 480;
  const ctx = c.getContext("2d");
  if (!ctx) return { dataUrl: "", width: 480, height: 480 };
  ctx.fillStyle = "#1c1c24"; ctx.fillRect(0, 0, 480, 480);
  ctx.fillStyle = "#34343f"; ctx.beginPath(); ctx.arc(240, 195, 72, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#5b5b6b"; ctx.font = "bold 38px sans-serif"; ctx.textAlign = "center";
  ctx.fillText("RAW", 240, 210);
  ctx.fillStyle = "#8a8a9a"; ctx.font = "22px sans-serif";
  ctx.fillText((extOf(name) || "file").toUpperCase(), 240, 300);
  ctx.fillStyle = "#56566a"; ctx.font = "15px sans-serif";
  ctx.fillText("preview unavailable", 240, 340);
  return { dataUrl: c.toDataURL("image/png"), width: 480, height: 480 };
}

export function makeThumb(file: File, max = 480): Promise<{ dataUrl: string; width: number; height: number }> {
  // RAW / undecodable: extract embedded preview JPEG, never just a placeholder.
  if (isRaw(file.name)) {
    return extractRawPreview(file).then((r) => (r ? r : placeholderThumb(file.name)));
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    let done = false;
    const finish = (result: { dataUrl: string; width: number; height: number }) => {
      if (done) return; done = true; URL.revokeObjectURL(url); resolve(result);
    };
    const fail = () => finish(placeholderThumb(file.name));
    img.onload = () => {
      try { finish(drawScaled(img, max)); } catch { fail(); }
    };
    img.onerror = () => fail();
    img.src = url;
  });
}

// Short stable id for a photo within a gallery.
export function photoId(galleryId: string, name: string): string {
  let h = 2166136261;
  const s = galleryId + "|" + name;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36);
}

export function newGuestId(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "g-" + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function newToken(len = 16): string {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}
