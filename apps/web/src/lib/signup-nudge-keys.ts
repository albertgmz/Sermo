// What a guest's invitations to create an account keep in the browser (both in the cookie
// inventory): when the floating card was last put off (localStorage, epoch milliseconds), and that
// this visit came from a search engine (sessionStorage). Apart from the rules
// (`lib/signup-nudges.ts`), so the cookie banner, which lists every name, does not carry their code.
export const SNOOZE_KEY = "sermo-signup-card";
export const SEARCH_VISIT_KEY = "sermo-signup-visit";
