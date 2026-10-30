import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createTranslator } from "use-intl";
import { messagesFor } from "../src/i18n/messages";

// One name for one thing, in every language: the wording the audit settled (a few words that had
// two or three names, a verb that did not agree with several members).

const es = await messagesFor("es");
const en = await messagesFor("en");

test("a reaction alert's verb agrees with the number of members who gave it", () => {
  const t = createTranslator({
    locale: "es",
    messages: es,
    namespace: "notifications.notificationRow.texts",
  });
  const say = (count: number) =>
    t.rich("contentReaction", {
      actors: () => "kestrel y wren",
      count,
      kind: "post",
      named: "no",
      reaction: "",
      emoji: "",
      titled: "no",
      title: "",
    });
  expect(String(say(1))).toContain("dio a tu mensaje");
  expect(String(say(2))).toContain("dieron a tu mensaje");
  expect(String(say(5))).toContain("dieron a tu mensaje");
});

test("the automatic language choice says what it means", () => {
  expect(es.account.preferences.languageDefault).toBe(
    "Automático (idioma del sitio)",
  );
  expect(es.layout.languageSwitcher.system).toBe(
    "Automático (idioma del sitio)",
  );
  expect(en.account.preferences.languageDefault).toBe(
    "Automatic (site language)",
  );
  expect(en.layout.languageSwitcher.system).toBe("Automatic (site language)");
});

test("the tags placeholder offers tags a member of this forum would use", () => {
  expect(es.forum.threadTags.placeholder).toBe("#cuba #noticias");
  expect(en.forum.threadTags.placeholder).toBe("#news #cuba");
});

test("the account sidebar's second notifications link is the alerts page, not a second Notifications", () => {
  expect(es.account.layout.notifications).toBe("Alertas");
  expect(en.account.layout.notifications).toBe("Alerts");
  expect(es.account.navigation.notifications).not.toBe(
    es.account.layout.notifications,
  );
});

test("each concept has one name in Spanish", () => {
  // Private messages are direct messages everywhere.
  expect(es.members.profileHeader.message).toBe("Mensaje directo");
  expect(es.forum.memberActions.message).toBe("Mensaje directo");
  expect(es.moderation.message.metaTitle).toBe("Mensaje directo denunciado");
  // The profile stat is the reactions the member received, as in the postbit and the card.
  expect(es.members.profileHeader.reputationLabel).toBe("Reacciones");
  expect(en.members.profileHeader.reputationLabel).toBe("Reactions");
  // The monthly winner is "Miembro del mes" in the widget, its type and the page.
  expect(es.widgets.widgetArea.titles.monthStandings).toBe("Miembro del mes");
  expect(es.adminWidgets.types.monthStandings.name).toBe("Miembro del mes");
  expect(en.widgets.widgetArea.titles.monthStandings).toBe(
    "Member of the month",
  );
  expect(en.adminWidgets.types.monthStandings.name).toBe("Member of the month");
  // The online list is "Visitantes actuales", also in what a member is seen doing.
  expect(es.forum.activity.places.online).toBe(
    "Viendo los visitantes actuales",
  );
  expect(en.forum.activity.places.online).toBe("Viewing current visitors");
});

test("no message file calls a direct message a private message, in either language", () => {
  const roots = [
    join(import.meta.dir, "..", "messages"),
    join(
      import.meta.dir,
      "..",
      "..",
      "..",
      "packages",
      "core",
      "src",
      "i18n",
      "locales",
    ),
  ];
  const files = roots.flatMap((root) =>
    readdirSync(root, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map((entry) => join(entry.parentPath, entry.name)),
  );
  expect(files.length).toBeGreaterThan(70);
  for (const file of files)
    expect(readFileSync(file, "utf8"), file).not.toMatch(
      /mensajes? privados?|private messages?/i,
    );
});
