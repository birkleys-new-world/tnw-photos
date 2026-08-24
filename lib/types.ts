// Data model for TNW Photos (Phase 1 — web).

// A "gallery" is one folder you ingest. It owns a share token.
export interface Gallery {
  id: string;
  token: string; // unguessable share slug
  name: string;
  createdAt: number;
  photoCount: number;
  // friend instructions shown on the swipe page
  mode: "raw" | "edited"; // raw: swipe up = send raw; edited: button = full rez
  // Phase 2: which full-res have been uploaded & are "ready" for friends
  ready: string[]; // photoIds with full-res in Storage
  syncedAt: number; // last owner sync timestamp
}

export interface Photo {
  id: string; // deterministic hash of galleryId + path
  galleryId: string;
  name: string;
  thumbUrl: string; // data URL (tiny) or uploaded URL
  rank: number; // 0..5, owner rating
  flagged: boolean; // owner flag
  width: number;
  height: number;
  bytes: number; // original size, for display
}

// One friend's swipe on one photo. Guest id is a localStorage uuid — no login.
export interface Vote {
  galleryId: string;
  photoId: string;
  guestId: string;
  // raw mode: "want_edit" | "pass" | "send_raw"
  // edited mode: "want_full" | "pass"
  choice: string;
  ts: number;
}

export type GuestChoice =
  | "want_edit"
  | "pass"
  | "send_raw"
  | "want_full";
