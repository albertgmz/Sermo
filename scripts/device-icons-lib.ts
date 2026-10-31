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
  /** Converted to WebP; else copied as it is. */
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

/** The module that names every vendored file, keyed by code, for `src/lib/device-icons.ts`. */
export function generatedModule(plan: PlannedIcon[], monochrome: string[], commit: string): string {
  // In the order of their paths, as the formatter sorts them.
  const imports = [...plan]
    .sort((a, b) => a.group.localeCompare(b.group))
    .map(
      (icon) =>
        `import ${identifier(icon)} from "../../assets/device-icons/${icon.group}/${icon.file}";\n`,
    )
    .join("");
  const dark = monochrome.map((key) => `  "${key}",\n`).join("");
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
    "// Dark glyphs of one colour, which a dark theme inverts (`group/code`).\n",
    `export const MONOCHROME_ICONS: ReadonlySet<string> = new Set([\n${dark}]);\n`,
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
    "The source of each icon is the `.source` file of matomo-icons. The `devices` icons have no\n",
    "`.source` file: see `README.md` for their licence.\n",
    "\n",
    "| File | Source |\n",
    "| --- | --- |\n",
    rows,
  ].join("");
}
