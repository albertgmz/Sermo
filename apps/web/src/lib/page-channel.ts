// A BroadcastChannel to the site's other tabs that is closed while the page is hidden away in the
// back/forward cache and opened again when it comes back: an open channel keeps some browsers
// from caching the page, and in Chrome a message that reaches a cached page evicts it. The page
// re-reads what it missed when it is shown (its own `pageshow` listener).
type Channel = {
  onmessage: ((event: MessageEvent) => void) | null;
  postMessage(message: unknown): void;
  close(): void;
};

type PageEvents = {
  addEventListener(type: string, listener: (event: Event) => void): void;
  removeEventListener(type: string, listener: (event: Event) => void): void;
};

export function pageChannel(
  open: () => Channel | null,
  onMessage: () => void,
  page: PageEvents = window,
) {
  let channel: Channel | null = null;
  const connect = () => {
    if (channel) return;
    channel = open();
    if (channel) channel.onmessage = onMessage;
  };
  const disconnect = () => {
    channel?.close();
    channel = null;
  };
  const onShow = (event: Event) => {
    if ((event as PageTransitionEvent).persisted) connect();
  };
  connect();
  page.addEventListener("pagehide", disconnect);
  page.addEventListener("pageshow", onShow);
  return {
    post: (message: unknown) => channel?.postMessage(message),
    close: () => {
      page.removeEventListener("pagehide", disconnect);
      page.removeEventListener("pageshow", onShow);
      disconnect();
    },
  };
}
