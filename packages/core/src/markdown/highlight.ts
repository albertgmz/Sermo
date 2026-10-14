// The package's own types pull the DOM library into every program that reads them
// (`/// <reference lib="dom" />`), so it is loaded with `require`, which TypeScript does not
// resolve, and typed with the little this file uses.
interface Language {
  aliases?: string[];
}
interface Hljs {
  registerLanguage(name: string, definition: unknown): void;
  getLanguage(name: string): Language | undefined;
  highlight(
    code: string,
    options: { language: string; ignoreIllegals?: boolean },
  ): { value: string; language?: string };
}
const hljs = require("highlight.js/lib/core") as Hljs;
const load = (name: string): unknown => require(`highlight.js/lib/languages/${name}`);

const languages = Object.fromEntries(
  [
    "bash",
    "c",
    "cpp",
    "csharp",
    "css",
    "diff",
    "go",
    "java",
    "javascript",
    "json",
    "kotlin",
    "markdown",
    "php",
    "python",
    "ruby",
    "rust",
    "sql",
    "swift",
    "typescript",
    "xml",
    "yaml",
  ].map((name) => [name, load(name)]),
);
for (const [name, definition] of Object.entries(languages)) hljs.registerLanguage(name, definition);
/** The registered name behind each language object, whichever alias was asked for. */
const registeredName = new Map(
  Object.keys(languages).map((name) => [hljs.getLanguage(name), name] as const),
);

const DISPLAY_NAMES: Record<string, string> = {
  bash: "Bash",
  c: "C",
  cpp: "C++",
  csharp: "C#",
  css: "CSS",
  diff: "Diff",
  go: "Go",
  java: "Java",
  javascript: "JavaScript",
  json: "JSON",
  kotlin: "Kotlin",
  markdown: "Markdown",
  php: "PHP",
  python: "Python",
  ruby: "Ruby",
  rust: "Rust",
  sql: "SQL",
  swift: "Swift",
  typescript: "TypeScript",
  xml: "XML",
  yaml: "YAML",
};

/**
 * Highlights `code` as `requested` (a language name or alias). Returns the HTML (only `hljs-*`
 * spans around escaped text), the language's display name and its id, or null when the language is
 * not registered.
 */
export function highlightCode(
  code: string,
  requested: string,
): { html: string; name: string; id: string } | null {
  const language = hljs.getLanguage(requested.toLowerCase());
  if (!language) return null;
  try {
    const result = hljs.highlight(code, {
      language: requested.toLowerCase(),
      ignoreIllegals: true,
    });
    const id = registeredName.get(language) ?? requested;
    const name = requested.toLowerCase() === "html" ? "HTML" : (DISPLAY_NAMES[id] ?? id);
    return { html: result.value, name, id };
  } catch {
    return null;
  }
}
