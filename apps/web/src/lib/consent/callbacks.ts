import type { CookieConsentConfig } from "vanilla-cookieconsent";
import { effectOf, firstChoiceEffect } from "./effects";
import type { OptionalCategory } from "./inventory";

// Whether the page must be loaded again because the visitor went from "not asked" to "asked" (a
// guest outside Europe signed in by a soft navigation): the running banner started in opt-out mode,
// never shows itself and has every category on, so only a fresh start asks the member.
export const mustReloadForQuiet = (was: boolean, now: boolean) => was && !now;

type Library = { getUserPreferences(): { acceptedCategories: string[] } };

// What the banner does when the visitor chooses: send the choice to be saved on the account, then
// reload or refresh the page as `effects` says. `library` is the started banner library, or null
// when it could not start (the choice was still stored by it, and is still sent).
export function consentCallbacks({
  quiet,
  omit,
  library,
  save,
  reload,
  refresh,
  later = (run) => setTimeout(run, 0),
}: {
  // The banner is not shown to this visitor (the library runs in its opt-out mode).
  quiet: boolean;
  // Categories the banner does not offer.
  omit: readonly OptionalCategory[];
  library: () => Promise<Library | null> | null;
  save: () => void;
  reload: () => void;
  refresh: () => void;
  later?: (run: () => void) => void;
}): Pick<CookieConsentConfig, "onFirstConsent" | "onChange"> {
  const act = (effect: "reload" | "refresh" | "none") => {
    if (effect === "reload") reload();
    else if (effect === "refresh") refresh();
  };
  // In the library's opt-out mode, which a quiet visitor is in, the first choice reports a change
  // as well, in the same call, when some category differs from what was on before: that one is
  // the first choice again, not a second event.
  let justChosen = false;
  return {
    onFirstConsent: async () => {
      if (quiet) {
        justChosen = true;
        later(() => {
          justChosen = false;
        });
      }
      save();
      const started = await library();
      if (!started) return;
      act(
        firstChoiceEffect(
          quiet,
          started.getUserPreferences().acceptedCategories,
          omit,
        ),
      );
    },
    onChange: async ({ changedCategories }) => {
      if (justChosen) return;
      save();
      const started = await library();
      if (!started) return;
      act(
        effectOf(
          changedCategories,
          started.getUserPreferences().acceptedCategories,
        ),
      );
    },
  };
}
