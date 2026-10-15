import type { CookieConsentConfig } from "vanilla-cookieconsent";

type Library = typeof import("vanilla-cookieconsent");

// The banner library once it has started, or null when it could not (a blocked or failed script):
// the page then works without a banner, and nothing optional is ever switched on. Shared by the
// banner and by the embed loader, which must not call the library before `run` has finished.
let ready: Promise<Library | null> | null = null;

export function startConsent(config: CookieConsentConfig) {
  ready ??= import("vanilla-cookieconsent")
    .then(async (library) => {
      await library.run(config);
      return library;
    })
    .catch(() => null);
  return ready;
}

export const consentLibrary = () => ready;
