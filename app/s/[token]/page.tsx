"use client";

import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import {
  getDb,
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  serverTimestamp,
} from "@/lib/firebase";
import { isConfigured } from "@/lib/firebase";
import { newGuestId } from "@/lib/thumb";
import { fullResUrl } from "@/lib/storage";
import type { Gallery, Photo } from "@/lib/types";
import { APP_VERSION } from "@/lib/version";

type Choice = "want_edit" | "pass" | "send_raw" | "want_full";

export default function SwipePage() {
  const params = useParams<{ token: string }>();
  const token = params?.token;

  const [state, setState] = useState<"loading" | "missing" | "ready" | "done">("loading");
  const [gallery, setGallery] = useState<Gallery | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [idx, setIdx] = useState(0);
  const [decided, setDecided] = useState<Record<string, Choice>>({});
  const [guestId, setGuestId] = useState<string>("");
  const [status, setStatus] = useState<string>("");
  const cardRef = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    let gid = localStorage.getItem("tnw-guest");
    if (!gid) {
      gid = newGuestId();
      localStorage.setItem("tnw-guest", gid);
    }
    setGuestId(gid);

    if (!isConfigured() || !token) {
      setState("missing");
      return;
    }
    (async () => {
      const db = getDb();
      // find gallery by token
      const snap = await getDocs(collection(db, "galleries"));
      const found = snap.docs.map((d) => d.data() as Gallery).find((g) => g.token === token);
      if (!found) {
        setState("missing");
        return;
      }
      const ps = await getDocs(collection(db, "galleries", found.id, "photos"));
      const list = ps.docs.map((d) => d.data() as Photo);
      list.sort((a, b) => a.name.localeCompare(b.name));
      setGallery(found);
      setPhotos(list);
      setState("ready");
    })().catch(() => setState("missing"));
  }, [token]);

  async function downloadFullRes(p: Photo) {
    if (!gallery) return;
    try {
      setStatus("Preparing your download…");
      const url = await fullResUrl(gallery.token, p.id);
      const a = document.createElement("a");
      a.href = url;
      a.download = p.name;
      a.click();
      setStatus("Download started.");
    } catch {
      setStatus("Full-res not available yet — owner hasn't synced this photo.");
    }
  }

  async function vote(choice: Choice) {
    const p = photos[idx];
    if (!p || !gallery) return;
    setDecided((d) => ({ ...d, [p.id]: choice }));
    try {
      const db = getDb();
      await addDoc(collection(db, "votes"), {
        galleryId: gallery.id,
        photoId: p.id,
        guestId,
        choice,
        ts: Date.now(),
      });
    } catch {
      /* best-effort; could be offline */
    }
    next();
  }

  function next() {
    if (idx + 1 >= photos.length) setState("done");
    else setIdx((i) => i + 1);
  }

  // swipe handling
  function onStart(e: React.PointerEvent) {
    start.current = { x: e.clientX, y: e.clientY };
  }
  function onEnd(e: React.PointerEvent) {
    if (!start.current) return;
    const dx = e.clientX - start.current.x;
    const dy = e.clientY - start.current.y;
    start.current = null;
    const horiz = Math.abs(dx) > Math.abs(dy);
    if (Math.max(Math.abs(dx), Math.abs(dy)) < 60) return;
    if (gallery?.mode === "edited") {
      // only horizontal matters: right = want full, left = pass
      vote(dx > 0 ? "want_full" : "pass");
    } else {
      if (horiz) vote(dx > 0 ? "want_edit" : "pass");
      else if (dy < 0) vote("send_raw");
    }
  }

  if (state === "loading") return <main className="p-8">Loading…</main>;
  if (state === "missing")
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold mb-2">Link not found</h1>
        <p className="text-sm text-neutral-400">
          This share link doesn&apos;t exist. Ask the owner to re-send it.
        </p>
      </main>
    );

  if (state === "done")
    return (
      <main className="mx-auto max-w-md p-8 text-center">
        <h1 className="text-xl font-semibold mb-2">All done 🎉</h1>
        <p className="text-sm text-neutral-400">
          You reviewed {photos.length} photos. The owner will prepare your downloads next time they plug in.
        </p>
      </main>
    );

  const p = photos[idx];
  if (!p) return <main className="p-8">No photos here.</main>;
  const isRaw = gallery?.mode === "raw";

  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col p-4">
      <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
        <span>v{APP_VERSION} · {gallery?.name}</span>
        <span>
          {idx + 1} / {photos.length}
        </span>
      </div>

      <div
        ref={cardRef}
        onPointerDown={onStart}
        onPointerUp={onEnd}
        className="relative flex flex-1 select-none items-center justify-center overflow-hidden rounded-2xl bg-panel"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={p.thumbUrl} alt={p.name} className="max-h-full max-w-full object-contain" draggable={false} />
        <div className="pointer-events-none absolute bottom-0 w-full bg-gradient-to-t from-black/70 to-transparent p-3">
          <div className="text-sm">{p.name}</div>
        </div>
        {decided[p.id] && (
          <div className="absolute right-3 top-3 rounded bg-black/60 px-2 py-1 text-xs">
            {decided[p.id]}
          </div>
        )}
      </div>

      {(gallery?.ready || []).includes(p.id) && (
        <div className="mt-3 flex items-center justify-between rounded-lg bg-emerald-900/40 px-3 py-2">
          <span className="text-xs text-emerald-200">Full-res ready</span>
          <button
            onClick={() => downloadFullRes(p)}
            className="rounded bg-emerald-700 px-3 py-1 text-sm text-emerald-50"
          >
            Download full-res ↓
          </button>
        </div>
      )}

      <div className="mt-4 grid grid-cols-3 gap-2">
        {isRaw ? (
          <>
            <button
              onClick={() => vote("pass")}
              className="rounded-lg bg-neutral-800 py-3 text-lg"
              aria-label="Pass (left)"
            >
              ← Pass
            </button>
            <button
              onClick={() => vote("send_raw")}
              className="rounded-lg bg-emerald-700 py-3 text-lg"
              aria-label="Send raw (up)"
            >
              ↑ Raw
            </button>
            <button
              onClick={() => vote("want_edit")}
              className="rounded-lg bg-sky-700 py-3 text-lg"
              aria-label="Want edit (right)"
            >
              Edit →
            </button>
          </>
        ) : (
          <>
            <button onClick={() => vote("pass")} className="rounded-lg bg-neutral-800 py-3 text-lg">
              ← Pass
            </button>
            <div className="flex items-center justify-center text-xs text-neutral-500">swipe</div>
            <button onClick={() => vote("want_full")} className="rounded-lg bg-sky-700 py-3 text-lg">
              Full →
            </button>
          </>
        )}
      </div>
      <p className="mt-2 text-center text-xs text-neutral-600">
        {isRaw
          ? "Swipe left=pass, right=want edit, up=send me the raw"
          : "Swipe left=pass, right=I want full rez"}
      </p>
    </main>
  );
}
