import type { CookieConsentConfig } from "vanilla-cookieconsent";

type Library = typeof import("vanilla-cookieconsent");

// The banner library once it has started, or null when it could not (a blocked or failed script):
// the page then works without a banner, and nothing optional is ever switched on. Shared by the
// banner and by the embed loader, which must not call the library before `run` has finished.
let ready: Promise<Library | null> | null = null;
// Whether the banner was started without showing itself (a visitor the site does not ask).
let silent = false;
let announceStarted: (library: Library | null) => void = () => {};
const started = new Promise<Library | null>((resolve) => {
  announceStarted = resolve;
});

export function startConsent(config: CookieConsentConfig) {
  if (!ready) silent = config.autoShow === false;
  ready ??= import("vanilla-cookieconsent")
    .then(async (library) => {
      await library.run(config);
      return library;
    })
    .catch(() => null);
  ready.then(announceStarted);
  return ready;
}

export const consentLibrary = () => ready;

// Resolves once the cookie banner is out of the visitor's way, so that nothing else asks them for
// something while it is up: their choice is recorded, or the banner is not shown to them, or it
// could not start. Waits for the banner to start first (it is started by the root layout).
export async function consentSettled(): Promise<void> {
  const library = await started;
  if (!library || silent || library.validConsent()) return;
  await new Promise<void>((resolve) =>
    window.addEventListener("cc:onFirstConsent", () => resolve(), {
      once: true,
    }),
  );
}
