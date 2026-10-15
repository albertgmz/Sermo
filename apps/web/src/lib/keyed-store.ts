import { useSyncExternalStore } from "react";

// What the browser knows about things the server drew and the visitor then changed, kept outside
// the components that show them: a row of a long list is unmounted when it scrolls away and drawn
// again from the markup the server made, so a change held in the row's own state would be lost.
// One value per key; `use` reads it in a component (the server and the first browser render see
// nothing, so they agree).
export function createKeyedStore<T>() {
  const values = new Map<string, T>();
  const listeners = new Set<() => void>();
  const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  };
  const get = (key: string) => values.get(key);
  return {
    get,
    set(key: string, value: T | undefined) {
      if (value === undefined) values.delete(key);
      else values.set(key, value);
      for (const listener of [...listeners]) listener();
    },
    // Empties the store without telling the components (it may happen while one is rendering);
    // `announce` tells them.
    reset() {
      values.clear();
    },
    announce() {
      for (const listener of [...listeners]) listener();
    },
    clear() {
      values.clear();
      for (const listener of [...listeners]) listener();
    },
    use(key: string): T | undefined {
      // biome-ignore lint/correctness/useHookAtTopLevel: a hook handed out by the store, called by components
      return useSyncExternalStore(
        subscribe,
        () => get(key),
        () => undefined,
      );
    },
  };
}
