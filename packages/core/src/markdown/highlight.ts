import hljs from "highlight.js/lib/core";
import bash from "highlight.js/lib/languages/bash";
import c from "highlight.js/lib/languages/c";
import cpp from "highlight.js/lib/languages/cpp";
import csharp from "highlight.js/lib/languages/csharp";
import css from "highlight.js/lib/languages/css";
import diff from "highlight.js/lib/languages/diff";
import go from "highlight.js/lib/languages/go";
import java from "highlight.js/lib/languages/java";
import javascript from "highlight.js/lib/languages/javascript";
import json from "highlight.js/lib/languages/json";
import kotlin from "highlight.js/lib/languages/kotlin";
import markdown from "highlight.js/lib/languages/markdown";
import php from "highlight.js/lib/languages/php";
import python from "highlight.js/lib/languages/python";
import ruby from "highlight.js/lib/languages/ruby";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import swift from "highlight.js/lib/languages/swift";
import typescript from "highlight.js/lib/languages/typescript";
import xml from "highlight.js/lib/languages/xml";
import yaml from "highlight.js/lib/languages/yaml";

const languages = {
  bash,
  c,
  cpp,
  csharp,
  css,
  diff,
  go,
  java,
  javascript,
  json,
  kotlin,
  markdown,
  php,
  python,
  ruby,
  rust,
  sql,
  swift,
  typescript,
  xml,
  yaml,
};
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
