import type { CookieConsentConfig } from "vanilla-cookieconsent";
import { CONSENT_COOKIE_DAYS } from "./account";
import {
  CATEGORIES,
  type Category,
  CONSENT_COOKIE,
  INVENTORY,
  OPTIONAL_CATEGORIES,
  type OptionalCategory,
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
  // Said in both dialogs while the browser sends Global Privacy Control.
  gpcNotice: string;
  categories: Record<Category, { title: string; description: string }>;
};

const literal = (text: string) => text.replace(/\W/g, String.raw`\$&`);

// The domains a cookie may have been written for: this host and every parent with two or more
// labels (a tracker writes to `.example.com` when asked from `forum.example.com`), each with and
// without the leading dot. An address or a single label has no parent.
export function cookieDomains(hostname: string): string[] {
  const labels = hostname.split(".");
  const isAddress = /^[\d.]+$/.test(hostname) || hostname.includes(":");
  const hosts = [hostname];
  if (!isAddress)
    for (let at = 1; at < labels.length - 1; at += 1)
      hosts.push(labels.slice(at).join("."));
  return hosts.flatMap((host) => [host, `.${host}`]);
}

// The cookies a category owns, as the library clears them when the category is withdrawn (and on
// each visit while it is off). A name ending in `*` in the inventory is a prefix. Each is cleared
// where the library looks by default (this host) and on every domain of `cookieDomains`.
function cookiesOf(category: Category, hostname: string) {
  const domains = cookieDomains(hostname);
  return INVENTORY.filter(
    (item) => item.category === category && item.storage === "cookie",
  ).flatMap((item) =>
    item.names.flatMap((entry) => {
      const name = entry.endsWith("*")
        ? new RegExp(`^${literal(entry.slice(0, -1))}`)
        : entry;
      return [{ name }, ...domains.map((domain) => ({ name, domain }))];
    }),
  );
}

export type ConsentOptions = {
  // The banner is not shown to this visitor (the site asks in Europe only): the choices stay
  // reachable from the settings link, which show every category already on, as the site treats
  // a visitor who has chosen nothing.
  quiet?: boolean;
  // Categories left out: analytics when the site's only analytics runs without cookies.
  omit?: readonly OptionalCategory[];
  // Markup drawn before the words of both "Accept all" buttons (the cookie icon).
  acceptIcon?: string;
  // The browser sends Global Privacy Control: nothing optional is on before a choice, even for a
  // visitor the banner is not shown to, and both dialogs say so.
  gpc?: boolean;
};

// The library's configuration. Opt-in: nothing optional is on before a choice; the three buttons
// weigh the same; the cookie carries the policy version as `revision`, so a new version asks
// again. `hostname` is where the page is served, for the domains cookies are cleared on. A quiet
// visitor has every category on (opt-out), unless their browser sends Global Privacy Control.
export function consentConfig(
  texts: Record<string, ConsentTexts>,
  locale: string,
  version: number,
  hostname: string,
  {
    quiet = false,
    omit = [],
    acceptIcon = "",
    gpc = false,
  }: ConsentOptions = {},
): CookieConsentConfig {
  const allOn = quiet && !gpc;
  const categories: NonNullable<CookieConsentConfig["categories"]> = {
    necessary: { enabled: true, readOnly: true },
  };
  for (const category of OPTIONAL_CATEGORIES) {
    if (omit.includes(category)) continue;
    const cookies = cookiesOf(category, hostname);
    categories[category] = {
      enabled: allOn,
      ...(cookies.length > 0 && { autoClear: { cookies } }),
    };
  }
  return {
    mode: allOn ? "opt-out" : "opt-in",
    autoShow: !quiet,
    revision: version,
    disablePageInteraction: false,
    hideFromBots: false,
    cookie: {
      name: CONSENT_COOKIE,
      expiresAfterDays: CONSENT_COOKIE_DAYS,
      sameSite: "Lax",
    },
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
        Object.entries(texts).map(([code, text]) => [
          code,
          translation(text, omit, acceptIcon, gpc),
        ]),
      ),
    },
  };
}

function translation(
  text: ConsentTexts,
  omit: readonly OptionalCategory[],
  acceptIcon: string,
  gpc: boolean,
) {
  const acceptAll = `${acceptIcon}${text.acceptAll}`;
  const notice = gpc ? ` ${text.gpcNotice}` : "";
  return {
    consentModal: {
      title: text.title,
      description: `${text.description}${notice} {{revisionMessage}}<br><a href="/cookies">${text.policyLink}</a>`,
      revisionMessage: text.revisionMessage,
      acceptAllBtn: acceptAll,
      acceptNecessaryBtn: text.rejectAll,
      showPreferencesBtn: text.choose,
    },
    preferencesModal: {
      title: text.preferencesTitle,
      acceptAllBtn: acceptAll,
      acceptNecessaryBtn: text.rejectAll,
      savePreferencesBtn: text.savePreferences,
      closeIconLabel: text.closeLabel,
      serviceCounterLabel: "",
      sections: [
        {
          title: text.preferencesTitle,
          description: `${text.preferencesIntro}${notice} <a href="/cookies">${text.policyLink}</a>`,
        },
        ...CATEGORIES.filter(
          (category) => !(omit as readonly Category[]).includes(category),
        ).map((category) => ({
          title: text.categories[category].title,
          description: text.categories[category].description,
          linkedCategory: category,
        })),
      ],
    },
  };
}
