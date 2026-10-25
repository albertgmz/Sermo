import {
  createOpener,
  fetchCode,
  type Loader,
} from "@/components/ui/lazy-popup-gate";
import { type JoinAsk, type JoinHost, loginHref } from "@/lib/join-window";

// The page's hold on the sign-up window (`lib/join-window.ts`), opened through the site's lazy-popup
// path: a press before the window's code has arrived waits for it (`busy` says so to the pressed
// action), a dropped request is tried once more, and code that cannot be fetched sends the guest to
// the log-in page the action names (`follow`), as the link would have without the window.
export function joinHost(
  load: Loader<unknown>,
  view: { show: (ask: JoinAsk) => void; follow: (href: string) => void },
): JoinHost {
  return {
    open(ask, busy) {
      createOpener(load, {
        slot: "join",
        show: () => view.show(ask),
        fail: () => view.follow(loginHref(ask.next)),
        busy,
      }).open();
    },
    warm: () => {
      fetchCode(load).catch(() => {});
    },
  };
}
