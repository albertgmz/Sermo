import { type Lookup, memberIdOf } from "./sermo/authors";

/** A page's lookup from a test's fake by member id: a guest author asks for member 0. */
export const byMemberId =
  <T>(view: (id: number) => T): Lookup<T> =>
  (ref) =>
    view(typeof ref === "number" ? ref : (memberIdOf(ref) ?? 0));
