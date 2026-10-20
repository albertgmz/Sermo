import { LAND_EVENT } from "@/components/layout/spotlight";

// Lands on an item of the page just written or edited (`#profile-comment-5`) as a link to it
// would, once it is drawn (`HashTarget`). The address is left as it is: Next 16.4 changed behind
// its back (`history.replaceState`) takes it in as a restore of its state, which drops a
// navigation in flight and makes the next refresh draw the page's sections from their loading
// state again; changed through the router, it appends the new hash to the one already there.
export function landOn(hash: string) {
  window.dispatchEvent(new CustomEvent(LAND_EVENT, { detail: hash }));
}
