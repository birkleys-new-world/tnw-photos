// Client-side thumbnail generation + ingestion helpers (runs in the browser).

export const PHOTO_EXTS = [
  "jpg", "jpeg", "png", "webp", "gif", "heic", "heif", "avif", "bmp",
  "tif", "tiff",
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

// Draw |img| (ImageBitmap or HTMLImageElement) into a canvas, applying EXIF
// orientation (1-8) so rotated photos display upright. Returns the canvas.
function makeOrientedCanvas(img: { width: number; height: number }, orientation: number, max: number): HTMLCanvasElement {
  const iw = img.width, ih = img.height;
  const scale = Math.min(1, max / Math.max(iw, ih));
  const sw = Math.max(1, Math.round(iw * scale));
  const sh = Math.max(1, Math.round(ih * scale));
  const swapped = orientation >= 5 && orientation <= 8;
  const cw = swapped ? sh : sw;
  const ch = swapped ? sw : sh;

  const canvas = document.createElement("canvas");
  canvas.width = cw;
  canvas.height = ch;
  const ctx = canvas.getContext("2d")!;
  ctx.save();
  ctx.translate(cw / 2, ch / 2);
  switch (orientation) {
    case 2: ctx.scale(-1, 1); break;
    case 3: ctx.rotate(Math.PI); break;
    case 4: ctx.scale(1, -1); break;
    case 5: ctx.rotate(-Math.PI / 2); ctx.scale(-1, 1); break;
    case 6: ctx.rotate(Math.PI / 2); break;
    case 7: ctx.rotate(Math.PI / 2); ctx.scale(-1, 1); break;
    case 8: ctx.rotate(-Math.PI / 2); break;
    default: break; // 1
  }
  ctx.drawImage(img as CanvasImageSource, -sw / 2, -sh / 2, sw, sh);
  ctx.restore();
  return canvas;
}

function toThumb(canvas: HTMLCanvasElement): { dataUrl: string; width: number; height: number } {
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.8), width: canvas.width, height: canvas.height };
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

// Scan a buffer for the first embedded JPEG (FFD8...FFD9).
function scanEmbeddedJpeg(buf: ArrayBuffer): ArrayBuffer | null {
  const dv = new DataView(buf);
  const bytes = new Uint8Array(buf);
  const len = bytes.length;
  for (let i = 0; i < len - 1; i++) {
    if (dv.getUint16(i) === 0xffd8) {
      for (let j = i + 2; j < len - 1; j++) {
        if (dv.getUint16(j) === 0xffd9) return buf.slice(i, j + 2);
      }
      break;
    }
  }
  return null;
}

async function readOrientation(buf: ArrayBuffer): Promise<number> {
  try {
    const exifr = await import("exifr");
    const o = await (exifr as any).orientation(buf);
    return typeof o === "number" && o >= 1 && o <= 8 ? o : 1;
  } catch {
    return 1;
  }
}

async function extractRawPreview(file: File, max: number): Promise<{ dataUrl: string; width: number; height: number } | null> {
  const buf = await file.arrayBuffer();
  const exifr = await import("exifr");
  // 1) proper embedded preview via exifr (largest up to maxres)
  try {
    const preview = await (exifr as any).preview(buf, { maxres: 2000 });
    if (preview && preview.file) {
      const orient = await readOrientation(preview.file);
      const img = await loadImageFromBytes(preview.file);
      return toThumb(makeOrientedCanvas(img, orient, max));
    }
  } catch (_) { /* fall through */ }
  // 2) byte-scan fallback: first embedded JPEG in the file
  try {
    const jpeg = scanEmbeddedJpeg(buf);
    if (jpeg) {
      const orient = await readOrientation(jpeg);
      const img = await loadImageFromBytes(jpeg);
      return toThumb(makeOrientedCanvas(img, orient, max));
    }
  } catch (_) { /* fall through */ }
  return null;
}

function placeholderThumb(name: string): { dataUrl: string; width: number; height: number } {
  const c = document.createElement("canvas");
  c.width = 480; c.height = 480;
  const ctx = c.getContext("2d")!;
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

export function makeThumb(file: File, max = 1000): Promise<{ dataUrl: string; width: number; height: number }> {
  if (isRaw(file.name)) {
    return extractRawPreview(file, max).then((r) => (r ? r : placeholderThumb(file.name)));
  }

  // Browser-decodable: let createImageBitmap apply EXIF orientation natively,
  // then draw at target size. Fall back to Image() + manual orientation.
  return (async () => {
    try {
      const bmp = await createImageBitmap(file, { imageOrientation: "from-image" } as ImageBitmapOptions);
      return toThumb(makeOrientedCanvas(bmp, 1, max));
    } catch (_) {
      const buf = await file.arrayBuffer();
      const orient = await readOrientation(buf);
      const img = await loadImageFromBytes(buf);
      return toThumb(makeOrientedCanvas(img, orient, max));
    }
  })();
}

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
