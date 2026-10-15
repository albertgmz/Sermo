// A function that remembers the arguments of each call, for tests of code that calls back.
export function recorded<A extends unknown[], R>(fn: (...args: A) => R) {
  const calls: A[] = [];
  return Object.assign(
    (...args: A): R => {
      calls.push(args);
      return fn(...args);
    },
    { calls },
  );
}
