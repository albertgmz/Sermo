import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { extname, join, relative } from "node:path";
import ts from "typescript";
import { parseSource, visit } from "./lite-scan";

// The forum is language agnostic: every word a visitor reads comes from the message files of the
// web app or from the backend's localised text, and the routes, identifiers and stored values are
// English. This scan reads the strings, the JSX text and the identifiers of the code (not its
// comments) and fails on Spanish in them. A legitimate exception is listed in ALLOWED with its
// reason.

const REPO = join(import.meta.dir, "..", "..", "..");

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".tmp-run",
  "node_modules",
  "drizzle",
  "messages",
  "locales",
  "e2e",
  "tests",
  "testing",
]);
const CODE = new Set([".ts", ".tsx", ".js", ".mjs"]);
const IS_TEST = /\.test\.tsx?$|(?:^|\/)test-[^/]+\.ts$/;

// Words that are Spanish and nothing else in code: articles, prepositions, and the nouns and verbs
// a screen or an identifier of this forum could be written with.
const SPANISH_WORDS = new Set(
  (
    "novedades invitado invitada invitados invitadas usuario usuarios miembro miembros mensaje mensajes " +
    "hilo hilos foro foros tema temas buscar busqueda inicio cuenta entrar salir ahorro datos conexion " +
    "reintentar guardar enviar cancelar eliminar editar responder respuesta respuestas conversaciones " +
    "conversacion etiquetas etiqueta sesion contrasena correo nombre apellido fecha ayer nuevo nueva " +
    "nuevos nuevas cerrar abrir aceptar siguiente anterior publicar publicacion enlace archivo imagen " +
    "para con los las una unos unas por que este esta estos estas sobre desde hasta como pero todos " +
    "todas bienvenido bienvenida registrate regístrate hola gracias favor"
  ).split(" "),
);
// Short words that are also English or code ("con", "las") would flag too much on their own:
// these count only in a text of several words.
const WEAK_WORDS = new Set([
  "con",
  "los",
  "las",
  "una",
  "por",
  "que",
  "este",
  "esta",
  "como",
  "pero",
  "para",
]);
const ACCENTED = /[áéíóúñÁÉÍÓÚÑüÜ¿¡]/;

// path (from the repository root) -> why Spanish is fine there. Everything is matched by prefix.
const ALLOWED: Record<string, string> = {
  "apps/web/public/offline.html":
    "A static page the service worker serves with no connection: it cannot reach the message files, so it carries both languages itself.",
  "apps/web/src/lib/sermo/xenforo-addresses.ts":
    "The addresses of the XenForo forum this site replaced (`tema`, `foros`, `miembros`, `respuestas`, `conversaciones`, `novedades`): they are in search results and bookmarks and must keep redirecting.",
  "apps/web/src/lib/home-redirects.ts":
    "`/novedades`, this feed's old Spanish address, still redirects to `/whats-new`.",
  "packages/core/src/bbcode/adversarial-inputs.ts":
    "A fixture of unusual input for the BB code renderer (accents, an umlaut and an emoji); it is not Spanish text and no one reads it.",
  "scripts/fcuba-widgets-lib.ts":
    "Reads the widget templates exported from the XenForo forum, whose text is Spanish data (its title `Regístrate`, its `¿...?` punctuation); the result is stored content, not a screen.",
  "scripts/grant-manual-awards-lib.ts":
    "The reason written on awards granted for XenForo trophies; stored content of the site, in the site's language.",
};

function files(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory())
      return SKIPPED_DIRECTORIES.has(entry.name)
        ? []
        : files(join(directory, entry.name));
    return [join(directory, entry.name)];
  });
}

const fold = (word: string) => word.normalize("NFD").replace(/[̀-ͯ]/g, "");

// The words of a text or an identifier: split at anything that is not a letter and at camelCase.
function wordsOf(text: string, identifier: boolean): string[] {
  return (identifier ? text.replace(/([a-z])([A-Z])/g, "$1 $2") : text)
    .split(/[^\p{L}]+/u)
    .filter(Boolean)
    .map((word) => fold(word.toLowerCase()));
}

function spanishIn(text: string, identifier: boolean): string | undefined {
  const accent = ACCENTED.exec(text);
  if (accent) return accent[0];
  const words = wordsOf(text, identifier);
  return words.find(
    (word) =>
      SPANISH_WORDS.has(word) &&
      (!WEAK_WORDS.has(word) || (!identifier && words.length >= 3)),
  );
}

type Hit = { path: string; line: number; text: string; found: string };

function scan(path: string, source: string): Hit[] {
  const tree = parseSource(path, source);
  const hits: Hit[] = [];
  const add = (node: ts.Node, text: string, found: string) =>
    hits.push({
      path,
      line: tree.getLineAndCharacterOfPosition(node.getStart(tree)).line + 1,
      text: text.trim().slice(0, 80),
      found,
    });
  visit(tree, (node) => {
    // An import or export names a module, not a word anyone reads.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    let text: string | undefined;
    let identifier = false;
    if (ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node))
      text = node.text;
    else if (ts.isJsxText(node)) text = node.text;
    else if (ts.isIdentifier(node) || ts.isPrivateIdentifier(node)) {
      text = node.text;
      identifier = true;
    }
    if (text === undefined) return;
    const found = spanishIn(text, identifier);
    if (found) add(node, text, found);
  });
  return hits;
}

test("no Spanish is hard-coded in strings, JSX text or identifiers outside the message files", () => {
  const hits: Hit[] = [];
  for (const file of files(REPO)) {
    const path = relative(REPO, file).replaceAll("\\", "/");
    const isHtml = extname(path) === ".html";
    if (!CODE.has(extname(path)) && !isHtml) continue;
    if (IS_TEST.test(path)) continue;
    if (Object.keys(ALLOWED).some((prefix) => path.startsWith(prefix)))
      continue;
    const source = readFileSync(file, "utf8");
    if (isHtml) {
      const found = spanishIn(source.replace(/<[^>]*>/g, " "), false);
      if (found) hits.push({ path, line: 1, text: "", found });
      continue;
    }
    hits.push(...scan(path, source));
  }
  const report = hits.map(
    (hit) => `${hit.path}:${hit.line} "${hit.found}" in ${hit.text}`,
  );
  expect(report).toEqual([]);
});

test("every exception names a file that exists and says why", () => {
  for (const [path, reason] of Object.entries(ALLOWED)) {
    expect(reason.length).toBeGreaterThan(30);
    expect(() => readFileSync(join(REPO, path), "utf8"), path).not.toThrow();
  }
});
