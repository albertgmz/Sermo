import { getLiteState } from "@/lib/lite-mode";
import { REFERRAL_PARAM } from "@/lib/referral/link";

// What the browser may fetch before a click. Every link the site draws itself is a next/link
// `Link`, which already fetches what its soft navigation needs; the browser's own speculation
// would fetch a whole HTML page the click never uses. So the rules cover only the anchors in a
// post body (`.bb-content`, the backend's HTML, see html-content.tsx), which load a new document
// when followed. Only a thread or a forum at its own address (`<id>-<slug>`), or the forum list,
// is fetched: a bare id is answered with a redirect to that address, which the browser will not
// follow for a prefetch, and one path segment keeps the editor, the new-thread form and the
// upload route out. An address with a referral code is left alone: loading it gives the credit.
// Prefetch only, no prerender: a prerendered thread would run its scripts unseen and mark the
// thread read. `moderate` waits for the pointer to rest on the link (or for a press).
export const SPECULATION_RULES = {
  prefetch: [
    {
      where: {
        and: [
          {
            href_matches: [
              "/threads/:thread(\\d+)-:slug",
              "/forums/:forum(\\d+)-:slug",
              "/forums",
            ],
          },
          {
            not: {
              href_matches: [
                { pathname: "/*", search: `${REFERRAL_PARAM}=*` },
                { pathname: "/*", search: `*&${REFERRAL_PARAM}=*` },
              ],
            },
          },
          { selector_matches: ".bb-content a[href]" },
        ],
      },
      eagerness: "moderate",
    },
  ],
};

// The policy lets inline scripts run only with the response's nonce, and speculation rules are
// checked against it like any script. A visitor who asked the data saver to hold anything back
// gets no speculative fetches.
export async function SpeculationRulesScript({ nonce }: { nonce?: string }) {
  const lite = await getLiteState();
  if (lite.master || lite.blocked.length > 0) return null;
  return (
    <script
      type="speculationrules"
      nonce={nonce}
      // biome-ignore lint/security/noDangerouslySetInnerHtml: constant rules, no visitor input
      dangerouslySetInnerHTML={{ __html: JSON.stringify(SPECULATION_RULES) }}
    />
  );
}
