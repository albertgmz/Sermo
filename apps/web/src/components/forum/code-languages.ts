// The languages the code dialog offers: those the renderer highlights
// (packages/core/src/bbcode/highlight.ts; `code-languages.test.ts` holds the two together). The
// names are the ones the post view shows over the block. The common ones come first, as in
// XenForo; the rest follow in alphabetical order.
export type CodeLanguage = { id: string; name: string };

export const COMMON_LANGUAGES: CodeLanguage[] = [
  { id: "php", name: "PHP" },
  { id: "javascript", name: "JavaScript" },
  { id: "html", name: "HTML" },
  { id: "css", name: "CSS" },
  { id: "sql", name: "SQL" },
  { id: "python", name: "Python" },
  { id: "bash", name: "Bash" },
  { id: "json", name: "JSON" },
  { id: "c", name: "C" },
  { id: "cpp", name: "C++" },
];

export const OTHER_LANGUAGES: CodeLanguage[] = [
  { id: "csharp", name: "C#" },
  { id: "diff", name: "Diff" },
  { id: "go", name: "Go" },
  { id: "java", name: "Java" },
  { id: "kotlin", name: "Kotlin" },
  { id: "markdown", name: "Markdown" },
  { id: "ruby", name: "Ruby" },
  { id: "rust", name: "Rust" },
  { id: "swift", name: "Swift" },
  { id: "typescript", name: "TypeScript" },
  { id: "xml", name: "XML" },
  { id: "yaml", name: "YAML" },
];
