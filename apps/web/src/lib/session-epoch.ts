// What the tab remembers for a visitor (changes they made, polled counts, the end of the list they
// are reading) belongs to that visitor. The tab outlives a sign-out and a sign-in, which are
// redirects, so the stores are emptied the moment the page is drawn for someone else, and a call
// that was in flight for the earlier visitor writes nothing when it answers.
type Store = { reset: () => void; announce: () => void };

let epoch = 0;
let viewer: number | null | undefined;
const stores = new Set<Store>();

export const currentEpoch = () => epoch;

// Who the page is drawn for: null for a guest, and before the page has said.
export const currentViewer = () => viewer ?? null;

export function registerStore(store: Store) {
  stores.add(store);
}

// Called while the page is drawn for `viewerId`: the first time just notes who it is; a different
// one empties every store (silently, so that it can happen during a render) and starts a new epoch.
export function enterViewer(viewerId: number | null) {
  if (viewer === viewerId) return false;
  const first = viewer === undefined;
  viewer = viewerId;
  if (first) return false;
  epoch += 1;
  for (const store of stores) store.reset();
  return true;
}

// Tells what shows the stores that they were emptied.
export function announceViewerChange() {
  for (const store of stores) store.announce();
}
