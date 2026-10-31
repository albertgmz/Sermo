import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";

// The parts of `device-icons.ts` that the test drives: which files of a matomo-icons checkout are
// vendored and how, and the text of the generated files.

export const MATOMO_ICONS = {
  repository: "https://github.com/matomo-org/matomo-icons",
  commit: "fb96bd3a8edc74f196b736d7050f02a01afd24cf",
};

export const GROUPS = ["os", "devices"] as const;
export type Group = (typeof GROUPS)[number];

export interface PlannedIcon {
  group: Group;
  /** The detector's code (`UBT`) or device type (`feature_phone`): the file's name. */
  code: string;
  /** The file read: the SVG source, or the PNG that matomo-icons made of any other source. */
  from: string;
  /** The vendored file's name. */
  file: string;
  /** Converted to WebP; else an SVG made ready for the web (`webSvg`). */
  convert: boolean;
  /** Where matomo-icons says the picture came from (its `.source` note), if it says. */
  source: string | null;
}

// Files beside the icons that are no icons: the notes of where an icon came from, open work, the
// licence and the read-me of a group.
const NOT_ICONS = /\.(?:source|sources|todo)$|^LICENSE$|\.md$/;

function sourceNote(dir: string, name: string): string | null {
  for (const suffix of [".source", ".sources"]) {
    const path = join(dir, name + suffix);
    if (existsSync(path)) return readFileSync(path, "utf8").trim().split("\n")[0] ?? null;
  }
  return null;
}

/**
 * Every icon of the vendored groups, sorted. An SVG source stays SVG (a link is followed); for any
 * other source (PNG, JPEG, GIF, ICO) the PNG that matomo-icons made of it in `dist` is taken: it is
 * trimmed, square and 48 pixels wide, enough for a 16 pixel icon on a 3x screen.
 */
export function planIcons(checkout: string): PlannedIcon[] {
  const plan: PlannedIcon[] = [];
  for (const group of GROUPS) {
    const dir = join(checkout, "src", group);
    const seen = new Set<string>();
    for (const name of readdirSync(dir).sort()) {
      if (NOT_ICONS.test(name)) continue;
      const dot = name.indexOf(".");
      const code = name.slice(0, dot);
      if (seen.has(code)) throw new Error(`Two source files for ${group}/${code}.`);
      seen.add(code);
      const svg = name.endsWith(".svg");
      plan.push({
        group,
        code,
        from: svg ? realpathSync(join(dir, name)) : join(checkout, "dist", group, `${code}.png`),
        file: `${code}.${svg ? "svg" : "webp"}`,
        convert: !svg,
        source: sourceNote(dir, name),
      });
    }
  }
  return plan;
}

/**
 * The icons of the vendored groups that matomo-icons lists as dark monochrome glyphs (nearly
 * invisible on a dark background), as `group/code`.
 */
export function monochromeKeys(checkout: string): string[] {
  const list = JSON.parse(
    readFileSync(join(checkout, "dist", "dark-monochrome-icons.json"), "utf8"),
  ) as string[];
  return list
    .filter((path) => GROUPS.some((group) => path.startsWith(`${group}/`)))
    .map((path) => path.replace(/\.[^./]+$/, ""))
    .sort();
}

const identifier = (icon: PlannedIcon) => `${icon.group}_${icon.code}`;

function table(plan: PlannedIcon[], group: Group, name: string): string {
  const rows = plan
    .filter((icon) => icon.group === group)
    .map((icon) => `  ${icon.code}: ${identifier(icon)},\n`)
    .join("");
  return `export const ${name} = {\n${rows}};\n`;
}

/**
 * An SVG file as the web app serves it: hidden from assistive technology (it is a CSS picture; the
 * button around it has the name), with no empty title, no properties that only the drawing
 * programs read (`enable-background`, `-inkscape-*`), and a generic font after a named one.
 */
export function webSvg(text: string): string {
  return text
    .replace(/<svg\b(?![^>]*\baria-hidden=)/, '<svg aria-hidden="true"')
    .replace(/<title>\s*<\/title>|<title\s*\/>/g, "")
    .replace(/(?:enable-background|-inkscape-[\w-]+):[^;"]*;?/g, "")
    .replace(/font-family:([^;"]*)/g, (whole, names: string) =>
      /\b(?:serif|sans-serif|monospace|cursive|fantasy|system-ui)\s*$/.test(names)
        ? whole
        : `font-family:${names},sans-serif`,
    )
    .replace(/\sstyle="\s*"/g, "");
}

export interface PictureStats {
  /** How much of the square the picture covers, 0 to 1. */
  alpha: number;
  /** The brightness of what it covers, 0 (black) to 1 (white). */
  luminance: number;
}

/** The coverage and brightness of a picture, from its RGBA pixels. */
export function pictureStats(pixels: Uint8Array): PictureStats {
  let alpha = 0;
  let light = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const a = (pixels[i + 3] ?? 0) / 255;
    const [r = 0, g = 0, b = 0] = pixels.subarray(i, i + 3);
    alpha += a;
    light += (a * (0.2126 * r + 0.7152 * g + 0.0722 * b)) / 255;
  }
  const count = pixels.length / 4;
  return { alpha: count ? alpha / count : 0, luminance: alpha ? light / alpha : 0 };
}

// A glyph covers well under this part of its square; a darker logo than `DARK` is hard to see on
// a dark page.
const GLYPH_MAX_ALPHA = 0.6;
const DARK = 0.3;

/**
 * How each icon is drawn besides its own colours, as `group/code`. `masks`: the dark glyphs of one
 * colour that matomo-icons lists, drawn in the colour of the text (a picture that fills most of its
 * square, such as an app icon, is no glyph and stays as it is). `halos`: the other dark pictures,
 * which get a light edge on the dark theme.
 */
export function iconLooks(
  stats: Map<string, PictureStats>,
  monochrome: string[],
): { masks: string[]; halos: string[] } {
  const listed = new Set(monochrome);
  const masks: string[] = [];
  const halos: string[] = [];
  for (const [key, { alpha, luminance }] of [...stats].sort(([a], [b]) => a.localeCompare(b))) {
    if (alpha === 0) continue;
    if (listed.has(key) && alpha < GLYPH_MAX_ALPHA) masks.push(key);
    else if (luminance < DARK) halos.push(key);
  }
  return { masks, halos };
}

/**
 * The icon of each family of systems that the detector names after one of its systems: the
 * `Android` family takes the icon of `AND` (Android). A family named after no system (`Unix`)
 * gets none.
 */
export function familyIconCodes(
  families: Record<string, string[]>,
  systems: Record<string, string>,
  files: Set<string>,
): [string, string][] {
  const codeOf = new Map(Object.entries(systems).map(([code, name]) => [name, code]));
  return Object.keys(families)
    .flatMap((family): [string, string][] => {
      const code = codeOf.get(family);
      return code && files.has(code) ? [[family, code]] : [];
    })
    .sort(([a], [b]) => a.localeCompare(b));
}

// A key as the formatter writes it: quoted only when it is no plain name.
const property = (key: string) => (/^[A-Za-z_$][\w$]*$/.test(key) ? key : `"${key}"`);
const list = (keys: string[]) => keys.map((key) => `  "${key}",\n`).join("");

/** The module that names every vendored file, keyed by code, for `src/lib/device-icons.ts`. */
export function generatedModule(
  plan: PlannedIcon[],
  extras: { masks: string[]; halos: string[]; families: [string, string][] },
  commit: string,
): string {
  // In the order of their paths, as the formatter sorts them.
  const imports = [...plan]
    .sort((a, b) => a.group.localeCompare(b.group))
    .map(
      (icon) =>
        `import ${identifier(icon)} from "../../assets/device-icons/${icon.group}/${icon.file}";\n`,
    )
    .join("");
  const families = extras.families
    .map(([family, code]) => `  ${property(family)}: "${code}",\n`)
    .join("");
  return [
    `// Made by scripts/device-icons.ts from matomo-icons ${commit}. Do not edit: run the script.\n`,
    "\n",
    imports,
    "\n",
    "// The device types and the systems that have an icon, keyed by the detector's name or code.\n",
    table(plan, "devices", "DEVICE_ICON_FILES"),
    "\n",
    table(plan, "os", "OS_ICON_FILES"),
    "\n",
    "// The system whose icon a family of systems takes: the one the detector names it after.\n",
    `export const FAMILY_ICON_CODES: Record<string, keyof typeof OS_ICON_FILES> = {\n${families}};\n`,
    "\n",
    "// Dark glyphs of one colour, drawn in the colour of the text (`group/code`).\n",
    `export const MONOCHROME_ICONS: ReadonlySet<string> = new Set([\n${list(extras.masks)}]);\n`,
    "\n",
    "// Other dark pictures, which get a light edge on the dark theme (`group/code`).\n",
    `export const DARK_ICONS: ReadonlySet<string> = new Set([\n${list(extras.halos)}]);\n`,
  ].join("");
}

/** The list of every vendored file and the place its picture came from. */
export function attributionText(plan: PlannedIcon[], commit: string): string {
  const rows = plan
    .map((icon) => `| \`${icon.group}/${icon.file}\` | ${icon.source ?? "-"} |\n`)
    .join("");
  return [
    "# Sources of the device icons\n",
    "\n",
    `Made by \`scripts/device-icons.ts\` from matomo-icons ${commit}. Do not edit: run the script.\n`,
    "The source of an icon is the `.source` file of matomo-icons, where it has one. The `devices`\n",
    "icons have no `.source` file: see `README.md` for their licence.\n",
    "\n",
    "| File | Source |\n",
    "| --- | --- |\n",
    rows,
  ].join("");
}
