"use client";

import { useEffect, useRef, useState } from "react";
import {
  getDb,
  collection,
  doc,
  setDoc,
  updateDoc,
  getDocs,
  query,
  where,
  serverTimestamp,
  increment,
} from "@/lib/firebase";
import { isConfigured } from "@/lib/firebase";
import { makeThumb, photoId, newToken, isPhoto } from "@/lib/thumb";
import type { Gallery, Photo } from "@/lib/types";

// (photo-type detection now lives in lib/thumb.ts — isPhoto() handles 40+ formats incl. RAW)

export default function OwnerPage() {
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isConfigured()) {
      setReady(false);
      return;
    }
    (async () => {
      const db = getDb();
      const snap = await getDocs(collection(db, "galleries"));
      const list = snap.docs.map((d) => d.data() as Gallery);
      list.sort((a, b) => b.createdAt - a.createdAt);
      setGalleries(list);
      setReady(true);
    })().catch((e) => setError(String(e.message || e)));
  }, []);

  async function ingestFolder() {
    if (!fileRef.current) return;
    const files = Array.from(fileRef.current.files || []).filter((f) => isPhoto(f.name));
    if (!files.length) {
      setError("No image files found in that selection.");
      return;
    }
    setBusy(`Thumbnailing ${files.length} photos…`);
    setError(null);
    try {
      const db = getDb();
      const galleryId = "g-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const token = newToken();
      const gallery: Gallery = {
        id: galleryId,
        token,
        name: fileRef.current.files?.[0]?.webkitRelativePath?.split("/")[0] || "Untitled folder",
        createdAt: Date.now(),
        photoCount: files.length,
        mode: "raw",
      };
      await setDoc(doc(db, "galleries", galleryId), { ...gallery, _created: serverTimestamp() });

      const built: Photo[] = [];
      for (let i = 0; i < files.length; i++) {
        const f = files[i];
        setBusy(`Thumbnailing ${i + 1}/${files.length}…`);
        const { dataUrl, width, height } = await makeThumb(f, 480);
        const id = photoId(galleryId, f.name);
        const photo: Photo = {
          id,
          galleryId,
          name: f.name,
          thumbUrl: dataUrl,
          rank: 0,
          flagged: false,
          width,
          height,
          bytes: f.size,
        };
        await setDoc(doc(db, "galleries", galleryId, "photos", id), photo);
        built.push(photo);
      }
      setBusy(null);
      setGalleries((g) => [gallery, ...g]);
      setActiveId(galleryId);
      setPhotos(built);
    } catch (e: any) {
      setBusy(null);
      setError(String(e.message || e));
    }
  }

  async function loadGallery(id: string) {
    setActiveId(id);
    setBusy("Loading…");
    const db = getDb();
    const snap = await getDocs(collection(db, "galleries", id, "photos"));
    const list = snap.docs.map((d) => d.data() as Photo);
    list.sort((a, b) => a.name.localeCompare(b.name));
    setPhotos(list);
    setBusy(null);
  }

  async function rank(p: Photo, value: number) {
    const db = getDb();
    await updateDoc(doc(db, "galleries", p.galleryId, "photos", p.id), { rank: value });
    setPhotos((ps) => ps.map((x) => (x.id === p.id ? { ...x, rank: value } : x)));
  }
  async function toggleFlag(p: Photo) {
    const db = getDb();
    const next = !p.flagged;
    await updateDoc(doc(db, "galleries", p.galleryId, "photos", p.id), { flagged: next });
    setPhotos((ps) => ps.map((x) => (x.id === p.id ? { ...x, flagged: next } : x)));
  }

  if (!isConfigured()) {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-2xl font-semibold mb-4">TNW Photos — setup needed</h1>
            <p className="text-amber-300">
              Firebase isn&apos;t configured yet. Paste your Web API Key into <code>.env.local</code>{" "}
              (copy from <code>.env.example</code>) and redeploy. The key is only visible in the Firebase
              console UI — it can&apos;t be read programmatically.
            </p>
      </main>
    );
  }

  if (!ready) return <main className="p-8">Loading…</main>;

  const active = galleries.find((g) => g.id === activeId);

  return (
    <main className="mx-auto max-w-5xl p-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">TNW Photos</h1>
        <span className="text-sm text-neutral-400">{galleries.length} galleries</span>
      </header>

      {error && <div className="mb-4 rounded bg-red-900/40 px-3 py-2 text-sm text-red-200">{error}</div>}
      {busy && <div className="mb-4 rounded bg-sky-900/40 px-3 py-2 text-sm text-sky-200">{busy}</div>}

      <section className="mb-8 rounded-lg bg-panel p-4">
        <h2 className="font-medium mb-3">Ingest a folder</h2>
        <input
          ref={fileRef}
          type="file"
          /* @ts-expect-error non-standard but widely supported */
          webkitdirectory=""
          directory=""
          multiple
          className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-neutral-700 file:px-3 file:py-2 file:text-neutral-100"
          onChange={() => fileRef.current?.files && ingestFolder()}
        />
        <p className="mt-2 text-xs text-neutral-500">
          Thumbnails are generated in your browser and only the tiny JPEGs are uploaded. Full-res stays on
          your machine (Phase 2 companion syncs it on demand).
        </p>
      </section>

      <section className="grid grid-cols-[200px_1fr] gap-6">
        <aside className="space-y-2">
          {galleries.map((g) => (
            <button
              key={g.id}
              onClick={() => loadGallery(g.id)}
              className={
                "block w-full rounded px-3 py-2 text-left text-sm " +
                (g.id === activeId ? "bg-neutral-700" : "bg-panel hover:bg-neutral-800")
              }
            >
              <div className="truncate font-medium">{g.name}</div>
              <div className="text-xs text-neutral-400">
                {g.photoCount} photos · {g.mode}
              </div>
              <div className="mt-1 truncate text-xs text-sky-400">/s/{g.token}</div>
            </button>
          ))}
        </aside>

        <div>
          {active && (
            <div className="mb-3 flex items-center gap-3 text-sm">
              <span className="font-medium">{active.name}</span>
              <a
                className="rounded bg-sky-700 px-3 py-1 text-sky-50"
                href={`/s/${active.token}`}
                target="_blank"
                rel="noreferrer"
              >
                Open share link ↗
              </a>
              <button
                className="rounded bg-neutral-700 px-3 py-1"
                onClick={() => navigator.clipboard.writeText(`${location.origin}/s/${active.token}`)}
              >
                Copy link
              </button>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {photos.map((p) => (
              <div key={p.id} className="overflow-hidden rounded-lg bg-panel">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={p.thumbUrl} alt={p.name} className="aspect-square w-full object-cover" />
                <div className="p-2">
                  <div className="truncate text-xs text-neutral-400" title={p.name}>
                    {p.name}
                  </div>
                  <div className="stars mt-1 flex gap-0.5">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        onClick={() => rank(p, n)}
                        className={n <= p.rank ? "text-amber-400" : "text-neutral-600"}
                        aria-label={`Rate ${n}`}
                      >
                        ★
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={() => toggleFlag(p)}
                    className={
                      "mt-1 w-full rounded px-2 py-1 text-xs " +
                      (p.flagged ? "bg-amber-700 text-amber-50" : "bg-neutral-800 text-neutral-300")
                    }
                  >
                    {p.flagged ? "Flagged" : "Flag"}
                  </button>
                </div>
              </div>
            ))}
          </div>
          {!active && (
            <p className="text-sm text-neutral-500">Select a gallery on the left, or ingest a folder above.</p>
          )}
        </div>
      </section>
    </main>
  );
}
