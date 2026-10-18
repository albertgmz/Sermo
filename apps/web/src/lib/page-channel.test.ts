import { expect, test } from "bun:test";
import { pageChannel } from "./page-channel";

// A window that only dispatches page transitions, and channels that record what is done to them.
function setup() {
  const listeners = new Map<string, Set<(event: Event) => void>>();
  const page = {
    addEventListener: (type: string, listener: (event: Event) => void) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(listener);
    },
    removeEventListener: (type: string, listener: (event: Event) => void) => {
      listeners.get(type)?.delete(listener);
    },
  };
  const fire = (type: string, persisted: boolean) => {
    for (const listener of listeners.get(type) ?? [])
      listener({ type, persisted } as unknown as Event);
  };
  const channels: {
    onmessage: ((event: MessageEvent) => void) | null;
    posted: unknown[];
    closed: boolean;
    postMessage(message: unknown): void;
    close(): void;
  }[] = [];
  const open = () => {
    const channel = {
      onmessage: null,
      posted: [] as unknown[],
      closed: false,
      postMessage(message: unknown) {
        this.posted.push(message);
      },
      close() {
        this.closed = true;
      },
    };
    channels.push(channel);
    return channel;
  };
  const received: number[] = [];
  const handle = pageChannel(open, () => received.push(1), page);
  return { handle, fire, channels, received, listeners };
}

test("the channel is open while the page is shown and hears the other tabs", () => {
  const { handle, channels, received } = setup();
  expect(channels).toHaveLength(1);
  handle.post("value");
  expect(channels[0].posted).toEqual(["value"]);
  channels[0].onmessage?.({} as MessageEvent);
  expect(received).toEqual([1]);
});

test("the channel is closed when the page is hidden away and opened again when it comes back", () => {
  const { handle, fire, channels } = setup();
  fire("pagehide", true);
  expect(channels[0].closed).toBe(true);
  // Nothing goes out while the page is cached.
  handle.post("lost");
  expect(channels[0].posted).toEqual([]);
  fire("pageshow", true);
  expect(channels).toHaveLength(2);
  expect(channels[1].closed).toBe(false);
  handle.post("back");
  expect(channels[1].posted).toEqual(["back"]);
});

test("the first show of a page does not open a second channel", () => {
  const { fire, channels } = setup();
  fire("pageshow", false);
  fire("pageshow", true);
  expect(channels).toHaveLength(1);
});

test("closing the handle closes the channel and stops listening", () => {
  const { handle, fire, channels, listeners } = setup();
  handle.close();
  expect(channels[0].closed).toBe(true);
  fire("pageshow", true);
  expect(channels).toHaveLength(1);
  expect([...(listeners.get("pagehide") ?? [])]).toEqual([]);
});

test("a browser without BroadcastChannel has no channel and posts nothing", () => {
  const listeners: string[] = [];
  const handle = pageChannel(
    () => null,
    () => {},
    {
      addEventListener: (type) => listeners.push(type),
      removeEventListener: () => {},
    },
  );
  expect(() => handle.post("x")).not.toThrow();
  expect(listeners).toEqual(["pagehide", "pageshow"]);
});
