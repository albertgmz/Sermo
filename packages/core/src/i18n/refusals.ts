import IntlMessageFormat from "intl-messageformat";
import type { Language } from "./index";
import es from "./refusals.es.json";

/**
 * The words of the refusals the services throw. Services write their refusal in English; a client
 * that reads Spanish gets it from this catalogue, found by the English text. A text with `{name}`
 * stands for a refusal that names a number or an item: the Spanish side is an ICU message that
 * receives what the English text held there. A refusal the catalogue does not hold stays English.
 */
const catalogues: Record<Language, Record<string, string>> = { en: {}, es };

type Pattern = { regex: RegExp; names: string[]; format: IntlMessageFormat };
const patterns = new Map<Language, Pattern[]>();

function patternsOf(language: Language): Pattern[] {
  const held = patterns.get(language);
  if (held) return held;
  const built = Object.entries(catalogues[language])
    .filter(([english]) => /\{\w+\}/.test(english))
    .map(([english, translated]) => {
      const names: string[] = [];
      const source = english
        .replace(/[.*+?^$()|[\]\\]/g, "\\$&")
        .replace(/\{(\w+)\}/g, (_, name: string) => {
          names.push(name);
          return "(.*?)";
        });
      return {
        regex: new RegExp(`^${source}$`, "s"),
        names,
        format: new IntlMessageFormat(translated, language),
      };
    });
  patterns.set(language, built);
  return built;
}

export function translateRefusal(language: Language, message: string): string {
  const exact = catalogues[language][message];
  if (exact !== undefined) return exact;
  for (const { regex, names, format } of patternsOf(language)) {
    const found = regex.exec(message);
    if (!found) continue;
    const values: Record<string, string | number> = {};
    names.forEach((name, index) => {
      const text = found[index + 1] ?? "";
      values[name] = /^-?\d+$/.test(text) ? Number(text) : text;
    });
    return String(format.format(values));
  }
  return message;
}
