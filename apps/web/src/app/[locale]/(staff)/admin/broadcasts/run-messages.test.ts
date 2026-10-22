import { expect, test } from "bun:test";
import { createTranslator } from "use-intl";
import en from "../../../../../../messages/en/admin-communication.json";
import es from "../../../../../../messages/es/admin-communication.json";

// Every text of the message and alert pages, rendered for both kinds: "alerta" is feminine and
// "alert" takes "an", so an article left outside the kind's select reads wrong.
function rendered(locale: "en" | "es", catalogue: typeof en) {
  const t = createTranslator({
    locale,
    messages: { adminCommunication: catalogue },
    namespace: "adminCommunication.broadcasts",
  });
  const texts: string[] = [];
  const walk = (node: unknown, path: string[]) => {
    if (typeof node === "string") {
      const names = [...node.matchAll(/\{(\w+)/g)].map(
        (match) => match[1] as string,
      );
      const values = Object.fromEntries(names.map((name) => [name, "X"]));
      for (const kind of ["message", "alert"])
        texts.push(t(path.join(".") as never, { ...values, kind } as never));
      return;
    }
    for (const [key, value] of Object.entries(node as object))
      walk(value, [...path, key]);
  };
  walk(catalogue.broadcasts, []);
  return texts;
}

test("the Spanish texts give 'alerta' its feminine article", () => {
  const texts = rendered("es", es as typeof en);
  expect(texts.some((text) => /\bla alerta\b/i.test(text))).toBe(true);
  expect(
    texts.filter((text) => /\b(el|un|del|al) alerta\b/i.test(text)),
  ).toEqual([]);
});

test("the English texts say 'an alert'", () => {
  expect(
    rendered("en", en).filter((text) => /\ba alert\b/i.test(text)),
  ).toEqual([]);
});
