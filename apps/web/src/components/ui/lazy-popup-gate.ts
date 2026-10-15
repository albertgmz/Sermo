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

// The pending opening of each kind (a press, a hover): only one at a time, so a second press
// elsewhere takes the place of the first instead of stacking a second popup under it.
const claimed = new Map<string, () => void>();

export type OpenerOptions = {
  // The popup is to be shown: the code is there and the wish still stands.
  show: () => void;
  // The code could not be fetched, even on the second try.
  fail: () => void;
  // The wish is waiting for the code (true) or no longer is (false).
  busy?: (busy: boolean) => void;
  // Which kind of opening this is; one pending opening per kind.
  slot?: string;
};

// One trigger's wish to open. `show` runs when the code is there and the wish still stands (at
// once when it already is). A fetch that fails is tried once more (a dropped request), and then
// `fail` runs. `cancel` withdraws the wish: a second press, Escape, the pointer leaving.
export function createOpener<C>(load: Loader<C>, options: OpenerOptions) {
  const { show, fail, busy, slot = "press" } = options;
  let wanted = false;
  const end = () => {
    wanted = false;
    if (claimed.get(slot) === cancel) claimed.delete(slot);
    busy?.(false);
  };
  function cancel() {
    if (wanted) end();
  }
  return {
    warm() {
      fetchCode(load).catch(() => {});
    },
    open() {
      if (settled.has(load)) {
        show();
        return;
      }
      if (wanted) return;
      claimed.get(slot)?.();
      claimed.set(slot, cancel);
      wanted = true;
      busy?.(true);
      const arrived = () => {
        if (!wanted) return;
        end();
        show();
      };
      fetchCode(load)
        .catch(() => fetchCode(load))
        .then(arrived, () => {
          if (!wanted) return;
          end();
          fail();
        });
    },
    cancel,
    get pending() {
      return wanted;
    },
  };
}
