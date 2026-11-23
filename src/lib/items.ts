import { collection, deleteDoc, doc, limit, onSnapshot, orderBy, query, setDoc } from 'firebase/firestore';
import { firebase } from './firebase';
import type { SavedItem } from '../types';

/** "My things": text-only records (names, doses, expiry dates). Photos are never stored. */
export function watchItems(uid: string, cb: (items: SavedItem[]) => void) {
  const q = query(collection(firebase().db, 'users', uid, 'items'), orderBy('savedAt', 'desc'), limit(50));
  return onSnapshot(
    q,
    (snap) => cb(snap.docs.map((d) => d.data() as SavedItem)),
    (e) => console.warn('Saved items unavailable', e),
  );
}

export async function saveItem(uid: string, item: SavedItem) {
  await setDoc(doc(firebase().db, 'users', uid, 'items', item.id), item);
}

export async function removeItem(uid: string, id: string) {
  await deleteDoc(doc(firebase().db, 'users', uid, 'items', id));
}
