// A colour from the catalog is data an administrator typed, and it ends up in a style attribute
// or a stylesheet. Only #rrggbb is accepted; anything else is not applied.
const HEX = /^#[0-9a-f]{6}$/i;

export const isHexColor = (value: unknown): value is string =>
  typeof value === "string" && HEX.test(value);
