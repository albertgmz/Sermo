import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import IntlMessageFormat from "intl-messageformat";
import { translateRefusal } from "./refusals";
import es from "./refusals.es.json";

test("a refusal is found by its English text, with the numbers it names", () => {
  expect(translateRefusal("es", "You do not have permission to do that.")).toBe(
    "No tienes permiso para hacer eso.",
  );
  expect(translateRefusal("es", "You have reached your limit of 1 warning in 24 hours.")).toBe(
    "Has alcanzado tu límite de 1 advertencia en 24 horas.",
  );
  expect(translateRefusal("es", "You have reached your limit of 5 warnings in 24 hours.")).toBe(
    "Has alcanzado tu límite de 5 advertencias en 24 horas.",
  );
});

test("English and an unknown refusal stay as written", () => {
  expect(translateRefusal("en", "You do not have permission to do that.")).toBe(
    "You do not have permission to do that.",
  );
  expect(translateRefusal("es", "Something nobody wrote a phrase for.")).toBe(
    "Something nobody wrote a phrase for.",
  );
});

const NAMED = [
  "KEY_REFUSED",
  "CONTENT_CLOSED",
  "CLOSED",
  "REORGANIZING",
  "TOO_COMPLEX",
  "APPROVAL_PENDING_MESSAGE",
  "ACCEPTANCE_REQUIRED_MESSAGE",
];

// A refusal's text is a string literal in one of these places: the arguments of an error
// constructor or of a helper that makes one, a `message:` property (an issue shown under a form
// field), the declaration of a constant or `message` variable, and the message argument of a Zod
// check in the contracts. Every literal of such a place that reads as a sentence (it holds a
// space) must have a Spanish text, so a ternary or a second argument is seen as well.
const ROOTS = [join(import.meta.dir, ".."), join(import.meta.dir, "../../../api/src")];
const CALLS = String.raw`(?:new\s+(?:Validation|Forbidden|NotFound|Conflict|Unauthenticated|RateLimited)Error|\b(?:invalid|refuse|uploadRefusal|errorBody))\(`;
const ZOD_CALLS = String.raw`\.(?:regex|min|max|length|refine|superRefine|url|email|startsWith|endsWith|includes)\(`;
const ASSIGNED = String.raw`\b(?:const|let)\s+(?:message|${NAMED.join("|")})\s*=`;
const MESSAGE_KEY = String.raw`\bmessage:\s*(?=["\`])`;

// Every string literal from `from` to the end of the parenthesis it sits in (or, for an assignment
// or a property, to the end of the statement or entry), each `${...}` as `{}`.
function literalsFrom(source: string, from: number, closer: RegExp): string[] {
  const found: string[] = [];
  let depth = 0;
  let index = from;
  while (index < source.length) {
    const char = source[index] as string;
    if (char === '"' || char === "'" || char === "`") {
      let text = "";
      index++;
      while (index < source.length && source[index] !== char) {
        if (source[index] === "\\") {
          text += source[index + 1];
          index += 2;
        } else if (char === "`" && source.startsWith("${", index)) {
          let braces = 0;
          index++;
          do {
            if (source[index] === "{") braces++;
            if (source[index] === "}") braces--;
            index++;
          } while (braces > 0);
          text += "{}";
        } else text += source[index++];
      }
      index++;
      found.push(text);
      continue;
    }
    // A regular expression literal: skip it whole, its quotes and parentheses are not code.
    if (char === "/" && /[(,=:]\s*$/.test(source.slice(Math.max(0, index - 6), index))) {
      let inClass = false;
      index++;
      while (index < source.length && (inClass || source[index] !== "/")) {
        if (source[index] === "\\") index++;
        else if (source[index] === "[") inClass = true;
        else if (source[index] === "]") inClass = false;
        index++;
      }
      index++;
      continue;
    }
    if ("([{".includes(char)) depth++;
    if (")]}".includes(char)) {
      if (depth === 0) break;
      depth--;
    }
    if (depth === 0 && closer.test(char)) break;
    index++;
  }
  return found;
}

function sourceRefusals(): Map<string, string> {
  const found = new Map<string, string>();
  const forms: [RegExp, RegExp, (name: string) => boolean][] = [
    [new RegExp(CALLS, "g"), /$^/, () => true],
    [new RegExp(ZOD_CALLS, "g"), /$^/, (name) => name.startsWith("contracts/")],
    [new RegExp(ASSIGNED, "g"), /;/, () => true],
    // Better Auth's own answers (`APIError` bodies) are not the services' refusals.
    [new RegExp(MESSAGE_KEY, "g"), /,/, (name) => !name.startsWith("modules/auth/")],
  ];
  for (const root of ROOTS)
    for (const name of readdirSync(root, { recursive: true, encoding: "utf8" })) {
      // Registration refusals are Better Auth's own answers, not the services'.
      if (
        !name.endsWith(".ts") ||
        name.endsWith(".test.ts") ||
        name.includes("node_modules") ||
        name.endsWith("auth/registration.ts")
      )
        continue;
      const source = readFileSync(join(root, name), "utf8");
      for (const [pattern, closer, applies] of forms) {
        if (!applies(name)) continue;
        for (const match of source.matchAll(pattern))
          for (const text of literalsFrom(source, match.index + match[0].length, closer))
            if (/\s/.test(text.trim()) && /[a-z]/i.test(text) && !/^SELECT /.test(text))
              found.set(text, name);
      }
    }
  return found;
}

test("every refusal written in the source has a Spanish text", () => {
  const held = new Set(Object.keys(es).map((english) => english.replace(/\{\w+\}/g, "{}")));
  const missing = [...sourceRefusals()].filter(([text]) => !held.has(text));
  expect(missing.map(([text, file]) => `${file}: ${text}`)).toEqual([]);
});

test("a Spanish text with names asks only for what the English text names", () => {
  for (const [english, spanish] of Object.entries(es)) {
    const values = Object.fromEntries(
      [...english.matchAll(/\{(\w+)\}/g)].map((found) => [found[1], 2]),
    );
    if (Object.keys(values).length === 0) continue;
    expect(() => new IntlMessageFormat(spanish, "es").format(values), english).not.toThrow();
  }
});

test("the messages Zod writes for bad input are translated", () => {
  expect(translateRefusal("es", "Too small: expected string to have >=1 characters")).toBe(
    "Demasiado corto: se esperan al menos 1 carácter",
  );
  expect(translateRefusal("es", "Invalid input: expected string, received undefined")).toBe(
    "Valor no válido: se esperaba texto y se recibió nada",
  );
  expect(translateRefusal("es", 'Unrecognized key: "extra"')).toBe("Campo no reconocido: «extra»");
});
