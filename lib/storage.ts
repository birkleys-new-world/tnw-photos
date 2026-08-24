// Storage helpers (Firebase Storage web SDK). Full-res lives here, gated by
// the gallery share token: path galleries/{token}/{photoId}.
import {
  getStorage,
  ref,
  uploadBytes,
  getDownloadURL,
  deleteObject,
} from "firebase/storage";
import { getDb } from "./firebase";

let storage: ReturnType<typeof getStorage> | null = null;
export function getStg() {
  if (!storage) storage = getStorage();
  return storage;
}

export async function uploadFullRes(
  token: string,
  photoId: string,
  blob: Blob
): Promise<string> {
  const s = getStg();
  const r = ref(s, `galleries/${token}/${photoId}`);
  await uploadBytes(r, blob);
  return getDownloadURL(r);
}

export async function deleteFullRes(token: string, photoId: string) {
  const s = getStg();
  const r = ref(s, `galleries/${token}/${photoId}`);
  await deleteObject(r);
}

export async function fullResUrl(token: string, photoId: string): Promise<string> {
  const s = getStg();
  const r = ref(s, `galleries/${token}/${photoId}`);
  return getDownloadURL(r);
}
