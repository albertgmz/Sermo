// The characters a TrueType or OpenType font draws, read from its `cmap` table: the Unicode
// subtables of format 4 (the Basic Multilingual Plane) and 12 (every plane). Only what the card
// needs to know which characters it can draw without a font from elsewhere.
export function codePointsOf(font: Uint8Array): Set<number> {
  const view = new DataView(font.buffer, font.byteOffset, font.byteLength);
  const tables = view.getUint16(4);
  let cmap = -1;
  for (let index = 0; index < tables; index++) {
    const record = 12 + index * 16;
    if (view.getUint32(record) === 0x636d6170) {
      cmap = view.getUint32(record + 8);
      break;
    }
  }
  const covered = new Set<number>();
  if (cmap < 0) return covered;
  const subtables = view.getUint16(cmap + 2);
  for (let index = 0; index < subtables; index++) {
    const record = cmap + 4 + index * 8;
    const platform = view.getUint16(record);
    const encoding = view.getUint16(record + 2);
    // Unicode, or Windows with Unicode BMP (1) or full repertoire (10).
    if (
      !(
        platform === 0 ||
        (platform === 3 && (encoding === 1 || encoding === 10))
      )
    )
      continue;
    const table = cmap + view.getUint32(record + 4);
    const format = view.getUint16(table);
    if (format === 4) readFormat4(view, table, covered);
    else if (format === 12) readFormat12(view, table, covered);
  }
  return covered;
}

function readFormat4(view: DataView, table: number, covered: Set<number>) {
  const segments = view.getUint16(table + 6) / 2;
  const ends = table + 14;
  const starts = ends + segments * 2 + 2;
  const deltas = starts + segments * 2;
  const offsets = deltas + segments * 2;
  for (let segment = 0; segment < segments; segment++) {
    const end = view.getUint16(ends + segment * 2);
    const start = view.getUint16(starts + segment * 2);
    const delta = view.getUint16(deltas + segment * 2);
    const offsetAt = offsets + segment * 2;
    const offset = view.getUint16(offsetAt);
    for (let code = start; code <= end && code !== 0xffff; code++) {
      const glyph =
        offset === 0
          ? (code + delta) & 0xffff
          : glyphAt(view, offsetAt + offset + (code - start) * 2, delta);
      if (glyph !== 0) covered.add(code);
    }
  }
}

function glyphAt(view: DataView, at: number, delta: number) {
  const glyph = view.getUint16(at);
  return glyph === 0 ? 0 : (glyph + delta) & 0xffff;
}

function readFormat12(view: DataView, table: number, covered: Set<number>) {
  const groups = view.getUint32(table + 12);
  for (let group = 0; group < groups; group++) {
    const record = table + 16 + group * 12;
    const start = view.getUint32(record);
    const end = view.getUint32(record + 4);
    const first = view.getUint32(record + 8);
    for (let code = start; code <= end; code++) {
      if (first + (code - start) !== 0) covered.add(code);
    }
  }
}
