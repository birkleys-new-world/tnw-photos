"use client";

import { useEffect, useRef, useState } from "react";
import {
  getDb,
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  updateDoc,
  setDoc,
  serverTimestamp,
} from "@/lib/firebase";
import { uploadFullRes, deleteFullRes } from "@/lib/storage";
import { isConfigured } from "@/lib/firebase";
import type { Gallery, Photo, Vote } from "@/lib/types";

type Choice = "want_edit" | "pass" | "send_raw" | "want_full";

// Aggregate which photoIds friends want, per gallery.
function wantedPhotoIds(votes: Vote[], mode: string): Set<string> {
  const set = new Set<string>();
  for (const v of votes) {
    if (mode === "raw") {
      if (v.choice === "want_edit" || v.choice === "send_raw") set.add(v.photoId);
    } else {
      if (v.choice === "want_full") set.add(v.photoId);
    }
  }
  return set;
}

export default function SyncPage() {
  const [ready, setReady] = useState(false);
  const [galleries, setGalleries] = useState<Gallery[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [error, setError] = useState<string | null>(null);
  const [fsa, setFsa] = useState<boolean>(typeof window !== "undefined" && "showDirectoryPicker" in window);
  const dirHandle = useRef<any>(null);

  useEffect(() => {
    if (!isConfigured()) { setReady(false); return; }
    (async () => {
      const db = getDb();
      const snap = await getDocs(collection(db, "galleries"));
      const list = snap.docs.map((d) => d.data() as Gallery);
      list.sort((a, b) => b.createdAt - a.createdAt);
      setGalleries(list);
      setReady(true);
    })().catch((e) => setError(String(e.message || e)));
  }, []);

  async function pickFolder() {
    setError(null);
    try {
      // @ts-ignore File System Access API
      const handle = await window.showDirectoryPicker();
      dirHandle.current = handle;
      setStatus("Folder selected. Now pick a gallery below and click Sync.");
    } catch (e: any) {
      if (e.name === "AbortError") return;
      setError(String(e.message || e));
    }
  }

  async function sync(g: Gallery) {
    setStatus("Syncing " + g.name + "…");
    setError(null);
    try {
      const db = getDb();
      // 1. pull all votes for this gallery
      const vSnap = await getDocs(query(collection(db, "votes"), where("galleryId", "==", g.id)));
      const votes = vSnap.docs.map((d) => d.data() as Vote);
      const wanted = wantedPhotoIds(votes, g.mode);

      // 2. read local folder, build name->file map
      const handle = dirHandle.current;
      if (!handle) { setError("Pick the folder first."); return; }
      const files = new Map<string, File>();
      // @ts-ignore
      for await (const [name, entry] of handle.entries()) {
        if (entry.kind === "file") {
          const f = await entry.getFile();
          files.set(name, f);
        }
      }

      // 3. for each wanted photo, find local file, upload full-res
      let uploaded = 0;
      const readyIds: string[] = [];
      for (const pid of wanted) {
        // find the photo record to get its original filename
        const pDoc = await getDoc(doc(db, "galleries", g.id, "photos", pid));
        if (!pDoc.exists()) continue;
        const p = pDoc.data() as Photo;
        const f = files.get(p.name);
        if (!f) { setStatus((s) => s + ` (missing locally: ${p.name})`); continue; }
        await uploadFullRes(g.token, pid, f);
        readyIds.push(pid);
        uploaded++;
        setStatus("Uploaded " + uploaded + "/" + wanted.size);
      }

      // 4. write metadata sidecar back to the folder
      const meta = {
        galleryId: g.id,
        token: g.token,
        syncedAt: Date.now(),
        ranks: {} as Record<string, number>,
        flags: {} as Record<string, boolean>,
      };
      const pSnap = await getDocs(collection(db, "galleries", g.id, "photos"));
      pSnap.docs.forEach((d) => {
        const p = d.data() as Photo;
        meta.ranks[p.name] = p.rank;
        meta.flags[p.name] = p.flagged;
      });
      // @ts-ignore
      const metaHandle = await handle.getFileHandle(".tnw-meta.json").catch(() => handle.getFileHandle(".tnw-meta.json", { create: true }));
      // @ts-ignore
      const w = await metaHandle.createWritable();
      await w.write(JSON.stringify(meta, null, 2));
      await w.close();

      // 5. mark gallery ready
      await updateDoc(doc(db, "galleries", g.id), { ready: readyIds, syncedAt: Date.now() });
      setGalleries((gs) => gs.map((x) => (x.id === g.id ? { ...x, ready: readyIds, syncedAt: Date.now() } : x)));
      setStatus(`Done. Uploaded ${uploaded} full-res; metadata written to folder.`);
    } catch (e: any) {
      setError(String(e.message || e));
    }
  }

  async function purge(g: Gallery) {
    setStatus("Deleting full-res from Storage…");
    try {
      const db = getDb();
      for (const pid of g.ready || []) {
        await deleteFullRes(g.token, pid).catch(() => {});
      }
      await updateDoc(doc(db, "galleries", g.id), { ready: [] });
      setGalleries((gs) => gs.map((x) => (x.id === g.id ? { ...x, ready: [] } : x)));
      setStatus("Full-res purged from Storage. Thumbnails remain.");
    } catch (e: any) {
      setError(String(e.message || e));
    }
  }

  if (!isConfigured()) {
    return <main className="p-8">Firebase not configured — add the Web API Key to .env.local.</main>;
  }
  if (!ready) return <main className="p-8">Loading…</main>;

  if (!fsa) {
    return (
      <main className="mx-auto max-w-xl p-8">
        <h1 className="text-xl font-semibold mb-3">Sync (owner)</h1>
        <p className="text-sm text-amber-300">
          This page needs the File System Access API, available in <b>Chrome or Edge</b> (desktop).
          Open this site there to plug in your folder. Friends don&apos;t need this — they just use the
          share link.
        </p>
      </main>
    );
  }

  const active = galleries.find((g) => g.id === activeId);

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-semibold">Sync · owner</h1>
        <button onClick={pickFolder} className="rounded bg-neutral-700 px-3 py-2 text-sm">
          Pick folder…
        </button>
      </header>

      {error && <div className="mb-4 rounded bg-red-900/40 px-3 py-2 text-sm text-red-200">{error}</div>}
      {status && <div className="mb-4 rounded bg-sky-900/40 px-3 py-2 text-sm text-sky-200">{status}</div>}

      <p className="mb-4 text-xs text-neutral-500">
        Pick the same folder you ingested. Sync reads friend votes, uploads only the requested full-res to
        Storage, writes a <code>.tnw-meta.json</code> sidecar back to the folder, then your friends can
        download. Run <b>Purge</b> after they&apos;ve grabbed theirs to delete the full-res.
      </p>

      <div className="space-y-2">
        {galleries.map((g) => (
          <div key={g.id} className="rounded-lg bg-panel p-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-medium">{g.name}</div>
                <div className="text-xs text-neutral-400">
                  {g.photoCount} photos · {g.mode} · {(g.ready || []).length} full-res ready
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => { setActiveId(g.id); sync(g); }}
                  className="rounded bg-sky-700 px-3 py-1 text-sm text-sky-50"
                >
                  Sync
                </button>
                <button
                  onClick={() => { setActiveId(g.id); purge(g); }}
                  className="rounded bg-red-800 px-3 py-1 text-sm text-red-100"
                >
                  Purge
                </button>
              </div>
            </div>
            {active && active.id === g.id && (active.ready || []).length > 0 && (
              <div className="mt-2 text-xs text-emerald-400">
                Friends can download at /s/{g.token} (full-res links now live).
              </div>
            )}
          </div>
        ))}
      </div>
    </main>
  );
}
