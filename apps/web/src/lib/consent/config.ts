import type { CookieConsentConfig } from "vanilla-cookieconsent";
import {
  CATEGORIES,
  type Category,
  CONSENT_COOKIE,
  INVENTORY,
  OPTIONAL_CATEGORIES,
} from "./inventory";

// The words of the banner in one language: `messages/<locale>/cookies.json`, `banner` part.
export type ConsentTexts = {
  title: string;
  description: string;
  policyLink: string;
  acceptAll: string;
  rejectAll: string;
  choose: string;
  preferencesTitle: string;
  preferencesIntro: string;
  savePreferences: string;
  closeLabel: string;
  revisionMessage: string;
  alwaysOn: string;
  moreInformation: string;
  categories: Record<Category, { title: string; description: string }>;
};

const literal = (text: string) => text.replace(/\W/g, String.raw`\$&`);

// The cookies a category owns, as the library clears them when the category is withdrawn (and on
// each visit while it is off). A name ending in `*` in the inventory is a prefix.
function cookiesOf(category: Category) {
  return INVENTORY.filter(
    (item) => item.category === category && item.storage === "cookie",
  ).flatMap((item) =>
    item.names.map((name) => ({
      name: name.endsWith("*")
        ? new RegExp(`^${literal(name.slice(0, -1))}`)
        : name,
    })),
  );
}

// The library's configuration. Opt-in: nothing optional is on before a choice; the three buttons
// weigh the same; the cookie carries the policy version as `revision`, so a new version asks
// again. Analytics reloads the page when withdrawn, which stops a script already running.
export function consentConfig(
  texts: Record<string, ConsentTexts>,
  locale: string,
  version: number,
): CookieConsentConfig {
  const categories: NonNullable<CookieConsentConfig["categories"]> = {
    necessary: { enabled: true, readOnly: true },
  };
  for (const category of OPTIONAL_CATEGORIES) {
    const cookies = cookiesOf(category);
    categories[category] = {
      enabled: false,
      ...(cookies.length > 0 && {
        autoClear: { cookies, reloadPage: category === "analytics" },
      }),
    };
  }
  return {
    mode: "opt-in",
    revision: version,
    disablePageInteraction: false,
    hideFromBots: false,
    cookie: { name: CONSENT_COOKIE, expiresAfterDays: 182, sameSite: "Lax" },
    guiOptions: {
      consentModal: {
        layout: "cloud inline",
        position: "bottom center",
        equalWeightButtons: true,
        flipButtons: false,
      },
      preferencesModal: {
        layout: "box",
        equalWeightButtons: true,
        flipButtons: false,
      },
    },
    categories,
    language: {
      default: locale,
      translations: Object.fromEntries(
        Object.entries(texts).map(([code, text]) => [code, translation(text)]),
      ),
    },
  };
}

function translation(text: ConsentTexts) {
  return {
    consentModal: {
      title: text.title,
      description: `${text.description} {{revisionMessage}}<br><a href="/cookies">${text.policyLink}</a>`,
      revisionMessage: text.revisionMessage,
      acceptAllBtn: text.acceptAll,
      acceptNecessaryBtn: text.rejectAll,
      showPreferencesBtn: text.choose,
    },
    preferencesModal: {
      title: text.preferencesTitle,
      acceptAllBtn: text.acceptAll,
      acceptNecessaryBtn: text.rejectAll,
      savePreferencesBtn: text.savePreferences,
      closeIconLabel: text.closeLabel,
      serviceCounterLabel: "",
      sections: [
        {
          title: text.preferencesTitle,
          description: `${text.preferencesIntro} <a href="/cookies">${text.policyLink}</a>`,
        },
        ...CATEGORIES.map((category) => ({
          title: text.categories[category].title,
          description: text.categories[category].description,
          linkedCategory: category,
        })),
      ],
    },
  };
}
