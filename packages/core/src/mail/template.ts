import mjml2html from "mjml";
import { type Language, phrase } from "../i18n";

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

/** What every email shows of the site: its name, pictures, accent and a few addresses. */
export interface Brand {
  name: string;
  /** The site's home page, absolute. */
  url: string;
  /** Absolute addresses of the site's public pictures, or null. */
  logoUrl: string | null;
  iconUrl: string | null;
  /** `#rrggbb` colours of the button and of the text on it. */
  accent: string;
  accentForeground: string;
  /** The published contact page, or null. */
  contactUrl: string | null;
  /** Where a member turns notification emails on and off. */
  preferencesUrl: string;
}

/**
 * Why the member got the mail. Account mail (security mail among it) never carries unsubscribe
 * links; notification and digest mail always do.
 */
type Purpose =
  | { reason: "account"; unsubscribe?: never }
  | { reason: "notification" | "digest"; unsubscribe: { typeUrl: string; allUrl: string } };

export type TemplateInput = Purpose & {
  language: Language;
  brand: Brand;
  subject: string;
  body: string;
  /** Each link is a button, its address shown as text below it. */
  links?: { label: string; url: string }[];
  /** A list of linked titles, each with a line of detail (the digest's threads). */
  items?: { label: string; detail: string; url: string }[];
};

interface SignIn {
  browser: string | null;
  os: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
  at: number;
}

export type AccountTemplate =
  | "verify"
  | "welcome"
  | "reset"
  | "passwordChanged"
  | "changeEmail"
  | "emailChanged"
  | "apiKeyCreated"
  | "banned"
  | "newDevice"
  | "signupApproved"
  | "signupRejected";

/** Security mail shares the layout but never includes unsubscribe links. */
export function renderAccountEmail(input: {
  kind: AccountTemplate;
  language: Language;
  brand: Brand;
  url?: string;
  reason?: string;
  expiresAt?: string | null;
  /** The new sign-in a "newDevice" mail is about. */
  signIn?: SignIn;
}) {
  const { kind, language, brand } = input;
  const site = brand.name;
  const expiry = input.expiresAt
    ? new Intl.DateTimeFormat(language, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone: "UTC",
        timeZoneName: "short",
      }).format(new Date(input.expiresAt))
    : phrase(language, "email.account.banned.permanent");
  const values = {
    site,
    reason: input.reason ?? "",
    expiresAt: expiry,
    ...(input.signIn ? signInValues(language, input.signIn) : {}),
  };
  return renderEmail({
    language,
    brand,
    reason: "account",
    subject: phrase(language, `email.account.${kind}.subject`, values),
    body: phrase(
      language,
      `email.account.${kind === "signupRejected" && !input.reason ? "signupRejected.noReason" : kind}.body`,
      values,
    ),
    ...(input.url
      ? { links: [{ label: phrase(language, `email.account.${kind}.link`), url: input.url }] }
      : {}),
  });
}

function signInValues(language: Language, signIn: SignIn) {
  const device = signIn.browser
    ? signIn.os
      ? phrase(language, "email.account.newDevice.deviceOn", {
          browser: signIn.browser,
          os: signIn.os,
        })
      : signIn.browser
    : phrase(language, "email.account.newDevice.unknownDevice");
  let country = signIn.country;
  if (country)
    try {
      country = new Intl.DisplayNames([language], { type: "region" }).of(country) ?? country;
    } catch {
      // keep the code
    }
  const parts = [signIn.city, signIn.region, country].filter(
    (part, at, all): part is string => !!part && all.indexOf(part) === at,
  );
  return {
    device,
    place: parts.length
      ? parts.join(", ")
      : phrase(language, "email.account.newDevice.unknownPlace"),
    time: new Intl.DateTimeFormat(language, {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
      timeZoneName: "short",
    }).format(new Date(signIn.at)),
  };
}

/**
 * Light colours, set on every element so that a mail app's own dark mode, which recolours what
 * it is given (Gmail's apps, Outlook), inverts a complete palette. Apple Mail and other apps that
 * honour `prefers-color-scheme` get the dark palette below instead.
 */
const LIGHT = {
  page: "#f4f4f5",
  card: "#ffffff",
  heading: "#18181b",
  text: "#27272a",
  muted: "#52525b",
  border: "#e4e4e7",
};
const DARK = {
  page: "#09090b",
  card: "#18181b",
  heading: "#fafafa",
  text: "#e4e4e7",
  muted: "#a1a1aa",
  border: "#3f3f46",
};
/** Sermo's own accent (the web app's `--primary`), for a site whose palette has none. */
export const DEFAULT_ACCENT = { color: "#dc2626", foreground: "#ffffff" };
const HEX = /^#[0-9a-f]{6}$/i;
const FONT =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";
const LOGO_HEIGHT = 40;

function channels(hex: string): number[] {
  return [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));
}

function luminance(hex: string): number {
  const [r, g, b] = channels(hex).map((value) => {
    const c = value / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [high, low] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (high! + 0.05) / (low! + 0.05);
}

function mix(from: string, to: string, amount: number): string {
  const target = channels(to);
  return `#${channels(from)
    .map((value, at) =>
      Math.round(value + (target[at]! - value) * amount)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

/** The accent as text on `background`: moved toward `toward` until it reads (4.5:1). */
function accentInk(accent: string, background: string, toward: string): string {
  for (let step = 0; step < 10; step++) {
    const colour = mix(accent, toward, step / 10);
    if (contrast(colour, background) >= 4.5) return colour;
  }
  return toward;
}

/**
 * The accent goes into attributes and a stylesheet, and its contrast is computed: anything but
 * `#rrggbb` gives way to Sermo's accent, and a malformed foreground to black or white.
 */
function checkedAccent(brand: Brand): Brand {
  if (!HEX.test(brand.accent))
    return {
      ...brand,
      accent: DEFAULT_ACCENT.color,
      accentForeground: DEFAULT_ACCENT.foreground,
    };
  if (HEX.test(brand.accentForeground)) return brand;
  const white = contrast(brand.accent, "#ffffff") >= contrast(brand.accent, "#000000");
  return { ...brand, accentForeground: white ? "#ffffff" : "#000000" };
}

const WEB_ADDRESS = /^https?:\/\//i;

/**
 * Every address in a mail is set by the server, but the layout does not rely on it: an address
 * that is not http or https (`javascript:`, `data:`) is refused, so a caller that one day passes a
 * member's address cannot put a script in a button. A required address that fails is a mistake of
 * the caller and throws; a picture or a contact page that fails is left out.
 */
function webAddress(value: string, what: string): string {
  // Only the scheme is judged here: every address is also escaped for HTML (`escapeXml`), and an
  // address with spaces or control characters cannot be made by the callers that build them.
  if (!WEB_ADDRESS.test(value)) throw new Error(`${what} must be an http or https address.`);
  return value;
}

function checkedAddresses(brand: Brand): Brand {
  const optional = (value: string | null) => (value && WEB_ADDRESS.test(value) ? value : null);
  webAddress(brand.url, "The site address");
  webAddress(brand.preferencesUrl, "The notification settings address");
  return {
    ...brand,
    logoUrl: optional(brand.logoUrl),
    iconUrl: optional(brand.iconUrl),
    contactUrl: optional(brand.contactUrl),
  };
}

/** Paragraphs on blank lines, line breaks on single newlines; the text itself is escaped. */
function paragraphs(text: string): string {
  return text
    .trim()
    .split(/\n\s*\n/)
    .map(
      (paragraph, at, all) =>
        `<p style="margin:0 0 ${at === all.length - 1 ? 0 : 16}px">${escapeXml(paragraph.trim()).replace(/\n/g, "<br/>")}</p>`,
    )
    .join("");
}

/** The header: the logo, else the icon beside the name, else the name, linking home. */
function header(brand: Brand, ink: string): string {
  const name = escapeXml(brand.name);
  const home = escapeXml(brand.url);
  const nameText = `<span class="sermo-name" style="font-size:22px;line-height:${LOGO_HEIGHT}px;font-weight:700;color:${ink};vertical-align:middle">${name}</span>`;
  const icon = brand.iconUrl
    ? `<img src="${escapeXml(brand.iconUrl)}" alt="" width="${LOGO_HEIGHT}" height="${LOGO_HEIGHT}" style="display:inline-block;width:${LOGO_HEIGHT}px;height:${LOGO_HEIGHT}px;border:0;vertical-align:middle;margin-right:10px"/>`
    : "";
  const mark = `<a href="${home}" style="text-decoration:none;color:${ink}">${icon}${nameText}</a>`;
  if (!brand.logoUrl) return mark;
  // The logo is stored as WebP, which classic Outlook for Windows cannot show: it gets the mark.
  // Only maximums: a logo wider than the column scales down whole instead of being squashed.
  const logo = `<a href="${home}" style="text-decoration:none"><img src="${escapeXml(brand.logoUrl)}" alt="${name}" style="display:block;width:auto;height:auto;max-width:100%;max-height:${LOGO_HEIGHT}px;border:0;font-size:22px;font-weight:700;color:${ink}"/></a>`;
  return `<!--[if mso]>${mark}<![endif]--><!--[if !mso]><!-->${logo}<!--<![endif]-->`;
}

/**
 * The dark palette, by class over the inline light colours. A header that shows the logo stays
 * light: a logo is drawn for the site's light background.
 */
const darkStyle = (linkInk: string) => `
:root { color-scheme: light dark; supported-color-schemes: light dark; }
@media (prefers-color-scheme: dark) {
  body, .sermo-page, .sermo-page > div { background-color: ${DARK.page} !important; }
  .sermo-card, .sermo-card > table { background-color: ${DARK.card} !important; }
  .sermo-card div, .sermo-card p { color: ${DARK.text} !important; }
  .sermo-heading div, .sermo-name { color: ${DARK.heading} !important; }
  .sermo-head td { border-bottom-color: ${DARK.border} !important; }
  .sermo-muted div, .sermo-detail { color: ${DARK.muted} !important; }
  .sermo-rule p { border-color: ${DARK.border} !important; }
  .sermo-link { color: ${linkInk} !important; }
  .sermo-footer div, .sermo-footer a { color: ${DARK.muted} !important; }
  .sermo-footer a.sermo-site { color: ${DARK.text} !important; }
}`;

export async function renderEmail(
  input: TemplateInput,
): Promise<{ subject: string; html: string; text: string }> {
  const { language } = input;
  const brand = checkedAddresses(checkedAccent(input.brand));
  const t = (key: string, values: Record<string, string | number> = {}) =>
    phrase(language, key, values);
  const subject = input.subject.replace(/[\r\n]+/g, " ");
  const links = input.links ?? [];
  const items = input.items ?? [];
  for (const { url } of [...links, ...items]) webAddress(url, "A link");
  if (input.unsubscribe) {
    webAddress(input.unsubscribe.typeUrl, "An unsubscribe link");
    webAddress(input.unsubscribe.allUrl, "An unsubscribe link");
  }
  const reason = t(`email.layout.reason.${input.reason}`, { site: brand.name });
  const footerLinks = [
    { label: t("email.layout.home"), url: brand.url },
    ...(brand.contactUrl ? [{ label: t("email.layout.contact"), url: brand.contactUrl }] : []),
    ...(input.reason === "account"
      ? []
      : [{ label: t("email.layout.preferences"), url: brand.preferencesUrl }]),
  ];
  const unsubscribe = input.unsubscribe
    ? [
        { label: t("email.unsubscribe.type"), url: input.unsubscribe.typeUrl },
        { label: t("email.unsubscribe.all"), url: input.unsubscribe.allUrl },
      ]
    : [];

  const text = [
    brand.name,
    subject,
    input.body.trim(),
    ...links.map((link) => `${link.label}: ${link.url}`),
    ...items.map((item) => `${item.label}\n${item.detail}\n${item.url}`),
    [
      "-- ",
      reason,
      ...unsubscribe.map((link) => `${link.label}: ${link.url}`),
      ...footerLinks.map((link) => `${link.label}: ${link.url}`),
    ].join("\n"),
  ].join("\n\n");

  const linkInk = accentInk(brand.accent, LIGHT.card, "#000000");
  const anchor = (url: string, label: string, style: string, className = "sermo-link") =>
    `<a class="${className}" href="${escapeXml(url)}" style="${style}">${escapeXml(label)}</a>`;
  const card: string[] = [
    `<mj-text css-class="sermo-heading" padding="0 32px 12px" font-size="22px" line-height="30px" font-weight="700" color="${LIGHT.heading}">${escapeXml(subject)}</mj-text>`,
    `<mj-text>${paragraphs(input.body)}</mj-text>`,
  ];
  for (const link of links)
    card.push(
      `<mj-button href="${escapeXml(link.url)}" align="left" padding="24px 32px 8px" inner-padding="12px 24px" background-color="${brand.accent}" color="${brand.accentForeground}" font-size="16px" font-weight="600" line-height="20px" border-radius="6px">${escapeXml(link.label)}</mj-button>`,
      `<mj-text css-class="sermo-muted" padding="4px 32px 0" font-size="13px" line-height="20px" color="${LIGHT.muted}">${escapeXml(t("email.layout.linkFallback"))}<br/>${anchor(link.url, link.url, `color:${linkInk};word-break:break-all`)}</mj-text>`,
    );
  for (const [at, item] of items.entries())
    card.push(
      `<mj-text css-class="sermo-rule" padding="${at ? 0 : 16}px 32px 0"><p style="margin:0;padding:14px 0;border-top:1px solid ${LIGHT.border}">${anchor(item.url, item.label, `color:${linkInk};font-weight:600;text-decoration:none`)}<br/><span class="sermo-detail" style="font-size:13px;color:${LIGHT.muted}">${escapeXml(item.detail)}</span></p></mj-text>`,
    );

  const footerAnchor = (link: { label: string; url: string }) =>
    anchor(link.url, link.label, `color:${LIGHT.muted};text-decoration:underline`, "sermo-foot");
  const footer = [
    anchor(
      brand.url,
      brand.name,
      `color:${LIGHT.text};font-weight:600;text-decoration:none`,
      "sermo-site",
    ),
    escapeXml(reason),
    ...(unsubscribe.length ? [unsubscribe.map(footerAnchor).join(" &middot; ")] : []),
    footerLinks.map(footerAnchor).join(" &middot; "),
  ];

  // The body's first line, then blank characters so that the inbox shows nothing after it.
  const firstLine = Array.from(input.body.trim().split("\n")[0]!).slice(0, 200).join("");
  const preview = `${escapeXml(firstLine)}${"&#847;&zwnj;&nbsp;".repeat(60)}`;
  const result = await mjml2html(
    `<mjml lang="${language}" dir="ltr">
<mj-head>
<mj-title>${escapeXml(subject)}</mj-title>
<mj-preview>${preview}</mj-preview>
<mj-raw><meta name="color-scheme" content="light dark"/><meta name="supported-color-schemes" content="light dark"/></mj-raw>
<mj-attributes>
<mj-all font-family="${FONT}"/>
<mj-text padding="0 32px" font-size="16px" line-height="26px" color="${LIGHT.text}"/>
</mj-attributes>
<mj-style>${darkStyle(accentInk(brand.accent, DARK.card, "#ffffff"))}</mj-style>
</mj-head>
<mj-body background-color="${LIGHT.page}" css-class="sermo-page">
<mj-wrapper padding="24px 12px 0">
<mj-section css-class="${brand.logoUrl ? "sermo-plate" : "sermo-card sermo-head"}" background-color="${LIGHT.card}" border-top="4px solid ${brand.accent}" border-bottom="1px solid ${LIGHT.border}" border-radius="8px 8px 0 0" padding="20px 0">
<mj-column><mj-text>${header(brand, LIGHT.heading)}</mj-text></mj-column>
</mj-section>
<mj-section css-class="sermo-card" background-color="${LIGHT.card}" border-radius="0 0 8px 8px" padding="28px 0 32px">
<mj-column>${card.join("\n")}</mj-column>
</mj-section>
</mj-wrapper>
<mj-section css-class="sermo-footer" padding="24px 0 32px">
<mj-column><mj-text align="center" padding="0 24px" font-size="13px" line-height="22px" color="${LIGHT.muted}">${footer.join("<br/>")}</mj-text></mj-column>
</mj-section>
</mj-body>
</mjml>`,
    // No web fonts: the system fonts come first, and an import would tell Google of every reading.
    { validationLevel: "strict", fonts: {} },
  );
  if (result.errors.length) throw new Error(result.errors.map((error) => error.message).join("; "));
  return { subject, html: result.html, text };
}
