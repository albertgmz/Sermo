// A stand-in for `idb` in the worker test bundle: Serwist keeps the age of each cached file in an
// IndexedDB database, which the test scope does not have. Only what its expiration code calls.
type Entry = { id: string; cacheName: string; url: string; timestamp: number };

const entries = new Map<string, Entry>();

function cursorAt(list: Entry[], index: number): unknown {
  if (index >= list.length) return null;
  return {
    value: list[index],
    delete: () => entries.delete(list[index].id),
    continue: async () => cursorAt(list, index + 1),
  };
}

const db = {
  transaction: () => ({
    store: {
      put: async (entry: Entry) => {
        entries.set(entry.id, entry);
      },
      index: () => ({
        // Newest first, as the index is read with the "prev" direction.
        openCursor: async () =>
          cursorAt(
            [...entries.values()].sort((a, b) => b.timestamp - a.timestamp),
            0,
          ),
      }),
    },
    done: Promise.resolve(),
  }),
  get: async (_store: string, id: string) => entries.get(id),
};

export async function openDB(
  _name: string,
  _version: number,
  options?: { upgrade?: (db: unknown) => void },
) {
  options?.upgrade?.({
    createObjectStore: () => ({ createIndex: () => {} }),
  });
  return db;
}

export async function deleteDB() {}
