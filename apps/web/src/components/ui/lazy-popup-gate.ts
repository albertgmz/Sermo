// The loading half of `LazyPopup`, without React so it can be tested without a browser: the code of
// a popup is fetched once per loader, and an opening that arrives before it does is kept.

export type Loader<C> = () => Promise<{ default: C }>;

const pending = new WeakMap<Loader<unknown>, Promise<unknown>>();
const settled = new WeakMap<Loader<unknown>, unknown>();

// Fetches the code unless it is already on its way. A failure is forgotten, so the next gesture
// asks again.
export function fetchCode<C>(load: Loader<C>): Promise<unknown> {
  let promise = pending.get(load);
  if (!promise) {
    promise = load().then(
      (module) => {
        settled.set(load, module.default);
      },
      (error) => {
        pending.delete(load);
        throw error;
      },
    );
    pending.set(load, promise);
  }
  return promise;
}

// The popup, once its code has arrived.
export const loadedCode = <C>(load: Loader<C>) =>
  settled.get(load) as C | undefined;

// One trigger's wish to open. `show` runs when the code is there and the wish still stands (at once
// when it already is); `fail` runs when the code cannot be fetched.
export function createOpener<C>(
  load: Loader<C>,
  show: () => void,
  fail: () => void,
) {
  let wanted = false;
  return {
    warm() {
      fetchCode(load).catch(() => {});
    },
    open() {
      wanted = true;
      if (settled.has(load)) {
        show();
        return;
      }
      fetchCode(load).then(
        () => {
          if (wanted) show();
        },
        () => {
          wanted = false;
          fail();
        },
      );
    },
    cancel() {
      wanted = false;
    },
  };
}
