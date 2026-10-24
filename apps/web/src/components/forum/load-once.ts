// Calls `load` when asked, one load at a time, and hands what it gives to `done`. A load that fails
// (a connection that drops, a page opened before the site was updated and whose files are gone) is
// asked for again on the next call.
export function loader<T>(load: () => Promise<T>, done: (loaded: T) => void) {
  let asked = false;
  return () => {
    if (asked) return;
    asked = true;
    load().then(done, () => {
      asked = false;
    });
  };
}
