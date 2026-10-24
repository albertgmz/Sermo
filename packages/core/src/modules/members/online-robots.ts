import { isBot } from "isbot";

/**
 * Robots as XenForo names them (`XF\Data\Robot`): the user agent part that gives each away, its
 * key, and each key's name and page. `isBot` decides whether a user agent is a robot at all; a
 * robot that is not in the list is `unknown`.
 */
const AGENTS: readonly (readonly [string, string])[] = [
  ["adsbot-google", "google-adsbot"],
  ["ahrefsbot", "ahrefs"],
  ["amazonbot", "amazonbot"],
  ["applebot", "applebot"],
  ["archive.org_bot", "archive.org"],
  ["awariobot", "awario"],
  ["baiduspider", "baidu"],
  ["bingbot", "bing"],
  ["blexbot", "blexbot"],
  ["bytespider", "bytedance"],
  ["claudebot", "anthropic"],
  ["dotbot", "dotbot"],
  ["facebookexternalhit", "facebookextern"],
  ["googlebot", "google"],
  ["google-inspectiontool", "google-inspectiontool"],
  ["ia_archiver", "alexa"],
  ["imagesiftbot", "imagesift"],
  ["ltx71", "ltx71"],
  ["magpie-crawler", "brandwatch"],
  ["marginalia", "marginalia"],
  ["mauibot", "mauibot"],
  ["mediapartners-google", "google-adsense"],
  ["mj12bot", "mj12"],
  ["msnbot", "msnbot"],
  ["petalbot", "petalsearch"],
  ["proximic", "proximic"],
  ["scoutjet", "scoutjet"],
  ["seekportbot", "seekport"],
  ["semrushbot", "semrush"],
  ["seostar", "seostar"],
  ["seznambot", "seznam"],
  ["sogou web spider", "sogou"],
  ["trendictionbot", "trendiction"],
  ["twitterbot", "twitter"],
  ["yahoo! slurp", "yahoo"],
  ["yandex", "yandex"],
];

const ROBOTS: Readonly<Record<string, { name: string; url: string | null }>> = {
  ahrefs: { name: "Ahrefs", url: "http://ahrefs.com/robot/" },
  alexa: { name: "Alexa", url: "http://www.alexa.com/help/webmasters" },
  amazonbot: { name: "Amazon", url: "https://developer.amazon.com/support/amazonbot" },
  anthropic: { name: "Anthropic", url: "https://www.anthropic.com/" },
  applebot: { name: "Applebot", url: "https://support.apple.com/en-us/HT204683" },
  "archive.org": {
    name: "Internet Archive",
    url: "http://www.archive.org/details/archive.org_bot",
  },
  awario: { name: "Awario", url: "https://awario.com/bots.html" },
  baidu: { name: "Baidu", url: "http://www.baidu.com/search/spider.htm" },
  bing: { name: "Bing", url: "http://www.bing.com/bingbot.htm" },
  blexbot: { name: "BLEXBot", url: "http://webmeup-crawler.com/" },
  brandwatch: {
    name: "Brandwatch",
    url: "http://www.brandwatch.com/how-it-works/gathering-data/",
  },
  bytedance: { name: "ByteDance", url: "https://www.bytedance.com/" },
  dotbot: { name: "Moz Dotbot", url: "https://moz.com/help/moz-procedures/crawlers/dotbot" },
  facebookextern: { name: "Facebook", url: "http://www.facebook.com/externalhit_uatext.php" },
  google: { name: "Google", url: "https://support.google.com/webmasters/answer/182072" },
  "google-adsbot": { name: "Google Ads", url: "http://www.google.com/adsbot.html" },
  "google-adsense": {
    name: "Google AdSense",
    url: "https://support.google.com/webmasters/answer/182072",
  },
  "google-inspectiontool": {
    name: "Google Inspection Tool",
    url: "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers#google-inspectiontool",
  },
  imagesift: { name: "ImageSift", url: "http://imagesift.com/about" },
  ltx71: { name: "LTX71", url: "http://ltx71.com/" },
  marginalia: { name: "Marginalia", url: "https://search.marginalia.nu/" },
  mauibot: { name: "MauiBot", url: null },
  mj12: { name: "Majestic-12", url: "http://majestic12.co.uk/bot.php" },
  msnbot: { name: "MSN", url: "http://search.msn.com/msnbot.htm" },
  petalsearch: { name: "Petal Search", url: "https://webmaster.petalsearch.com/site/petalbot" },
  proximic: { name: "Proximic", url: "http://www.proximic.com/info/spider.php" },
  scoutjet: { name: "Blekko", url: "http://www.scoutjet.com/" },
  seekport: { name: "Seekport", url: "http://seekport.com/" },
  semrush: { name: "SEMRush", url: "http://www.semrush.com/bot.html" },
  seostar: { name: "Seostar", url: "https://seostar.co/robot/" },
  seznam: { name: "Seznam", url: "https://napoveda.seznam.cz/en/seznamcz-web-search/" },
  sogou: { name: "Sogou", url: "http://www.sogou.com/docs/help/webmasters.htm#07" },
  trendiction: { name: "Trendiction", url: "https://www.trendiction.com/bot" },
  twitter: {
    name: "Twitter",
    url: "https://developer.twitter.com/en/docs/twitter-for-websites/cards/guides/getting-started",
  },
  yahoo: { name: "Yahoo", url: "http://help.yahoo.com/help/us/ysearch/slurp" },
  yandex: { name: "Yandex", url: "http://help.yandex.com/search/?id=1112030" },
};

export const UNKNOWN_ROBOT = "unknown";

// One alternation in the list's order, as XenForo matches it: the leftmost part found wins.
const KNOWN = new RegExp(
  AGENTS.map(([part]) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"),
  "i",
);
const KEY_OF = new Map(AGENTS.map(([part, key]) => [part, key]));

/** The robot a user agent belongs to (its key), or null for a person. */
export function robotOf(userAgent: string | undefined): string | null {
  if (!userAgent || !isBot(userAgent)) return null;
  const part = KNOWN.exec(userAgent)?.[0]?.toLowerCase();
  return (part && KEY_OF.get(part)) || UNKNOWN_ROBOT;
}

/** A robot's name and page; the name is null for a robot the list does not know. */
export function robotInfo(key: string): { name: string | null; url: string | null } {
  return ROBOTS[key] ?? { name: null, url: null };
}
