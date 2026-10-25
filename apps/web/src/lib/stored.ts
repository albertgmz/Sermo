// A value the browser keeps (`localStorage`, `sessionStorage`), or null when there is none or the
// storage cannot be read (a private window, blocked site data).
export function readStored(storage: () => Storage, key: string) {
  try {
    return storage().getItem(key);
  } catch {
    return null;
  }
}
