// The first value of a search parameter, or "".
export const one = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value) ?? "";
