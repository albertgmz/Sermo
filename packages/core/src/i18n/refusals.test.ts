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

// A refusal's text is written inside the constructor, or in the constant or `message` variable
// declared just before it. One built any other way is not seen here.
const ROOTS = [join(import.meta.dir, ".."), join(import.meta.dir, "../../../api/src")];
const FORMS = [
  String.raw`new\s+(?:Validation|Forbidden|NotFound|Conflict|Unauthenticated|RateLimited)Error\(`,
  String.raw`\b(?:const|let)\s+(?:message|${NAMED.join("|")})\s*=`,
  String.raw`\b(?:invalid|refuse)\(`,
  String.raw`\b(?:uploadRefusal|errorBody)\(\s*"\w+",`,
];
const CONSTRUCTOR = new RegExp(`(?:${FORMS.join("|")})\\s*(["\`])`, "g");

// The text starting at the quote at `at`, with each `${...}` as `{}`, or null when more follows it
// than the end of the argument (a concatenation).
function textAt(source: string, at: number): string | null {
  const quote = source[at];
  let text = "";
  let index = at + 1;
  while (index < source.length && source[index] !== quote) {
    if (source[index] === "\\") {
      text += quote === '"' ? JSON.parse(`"${source.slice(index, index + 2)}"`) : source[index + 1];
      index += 2;
    } else if (quote === "`" && source.startsWith("${", index)) {
      let depth = 0;
      index++;
      do {
        if (source[index] === "{") depth++;
        if (source[index] === "}") depth--;
        index++;
      } while (depth > 0);
      text += "{}";
    } else text += source[index++];
  }
  return /^\s*[,);]/.test(source.slice(index + 1)) ? text : null;
}

function sourceRefusals(): Map<string, string> {
  const found = new Map<string, string>();
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
      for (const match of source.matchAll(CONSTRUCTOR)) {
        const text = textAt(source, match.index + match[0].length - 1);
        if (text !== null) found.set(text, name);
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
