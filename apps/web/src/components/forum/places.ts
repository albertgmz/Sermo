// The place of a `TabSwitch`: the values the address gives the parameters it owns, in order, as
// one string. The server reads it from the page's query and the browser from an address, so the two
// agree on what is on screen.

export type Query = Record<string, string | string[] | undefined>;

export function placeOfSearch(search: string, params: readonly string[]) {
  const query = new URLSearchParams(search);
  return JSON.stringify(params.map((name) => query.getAll(name)));
}

export function placeOfQuery(query: Query, params: readonly string[]) {
  return JSON.stringify(
    params.map((name) => {
      const value = query[name];
      return value === undefined ? [] : Array.isArray(value) ? value : [value];
    }),
  );
}

// The page's query from a search string, as `searchParams` gives it to a page: what a loader for a
// switch reads the place it is asked for from.
export function queryOfSearch(search: string): Query {
  const query: Query = {};
  for (const [name, value] of new URLSearchParams(search)) {
    const held = query[name];
    query[name] =
      held === undefined
        ? value
        : Array.isArray(held)
          ? [...held, value]
          : [held, value];
  }
  return query;
}

// The address a switch writes for a press: the one pressed, with the parameters other switches on
// the screen own kept as the address has them now (a link drawn before another switch moved does
// not take that one back).
export function pushedSearch(
  pressed: string,
  current: string,
  others: readonly (readonly string[])[],
) {
  const next = new URLSearchParams(pressed);
  const now = new URLSearchParams(current);
  for (const params of others)
    for (const name of params) {
      next.delete(name);
      for (const value of now.getAll(name)) next.append(name, value);
    }
  const text = next.toString();
  return text ? `?${text}` : "";
}
