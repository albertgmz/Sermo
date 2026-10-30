import type { CookieConsentConfig } from "vanilla-cookieconsent";
import { CONSENT_COOKIE_DAYS } from "./account";
import {
  CATEGORIES,
  type Category,
  CONSENT_COOKIE,
  INVENTORY,
  OPTIONAL_CATEGORIES,
} from "./inventory";

// The words of the banner in one language: `messages/<locale>/cookies.json`, `banner` part. The
// strip at the bottom of the screen says `description` and has `policyLinkShort`, `accept`,
// `reject` and `choose` (which opens the settings dialog); `title` is its name for screen readers.
// The settings dialog has the long words (`acceptAll`, `rejectAll`, `policyLink`).
export type ConsentTexts = {
  title: string;
  description: string;
  policyLink: string;
  policyLinkShort: string;
  accept: string;
  reject: string;
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
export function cookiesOf(category: Category, hostname: string) {
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
  // Markup drawn before the words of both accept buttons (the cookie icon).
  acceptIcon?: string;
  // The browser sends Global Privacy Control: nothing optional is on before a choice, even for a
  // visitor the banner is not shown to, and both dialogs say so.
  gpc?: boolean;
};

// The library's configuration. Opt-in: nothing optional is on before a choice; accept and reject
// weigh the same; the banner is a thin strip across the bottom of the screen (`#cc-main` in
// globals.css draws it); the cookie carries the policy version as `revision`, so a new version asks
// again. `hostname` is where the page is served, for the domains cookies are cleared on. A quiet
// visitor has every category on (opt-out), unless their browser sends Global Privacy Control.
export function consentConfig(
  texts: Record<string, ConsentTexts>,
  locale: string,
  version: number,
  hostname: string,
  { quiet = false, acceptIcon = "", gpc = false }: ConsentOptions = {},
): CookieConsentConfig {
  const allOn = quiet && !gpc;
  const categories: NonNullable<CookieConsentConfig["categories"]> = {
    necessary: { enabled: true, readOnly: true },
  };
  for (const category of OPTIONAL_CATEGORIES) {
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
        layout: "bar inline",
        position: "bottom",
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
          translation(text, acceptIcon, gpc),
        ]),
      ),
    },
  };
}

function translation(text: ConsentTexts, acceptIcon: string, gpc: boolean) {
  const notice = gpc ? ` ${text.gpcNotice}` : "";
  return {
    consentModal: {
      label: text.title,
      description: `${text.description}${notice} {{revisionMessage}} <a href="/cookies">${text.policyLinkShort}</a>`,
      revisionMessage: text.revisionMessage,
      acceptAllBtn: `${acceptIcon}${text.accept}`,
      acceptNecessaryBtn: text.reject,
      showPreferencesBtn: text.choose,
    },
    preferencesModal: {
      title: text.preferencesTitle,
      acceptAllBtn: `${acceptIcon}${text.acceptAll}`,
      acceptNecessaryBtn: text.rejectAll,
      savePreferencesBtn: text.savePreferences,
      closeIconLabel: text.closeLabel,
      serviceCounterLabel: "",
      sections: [
        {
          title: text.preferencesTitle,
          description: `${text.preferencesIntro}${notice} <a href="/cookies">${text.policyLink}</a>`,
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
