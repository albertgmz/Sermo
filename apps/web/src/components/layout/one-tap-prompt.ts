import { documentNonce } from "@/lib/document-nonce";
import { oneTapRefusalAddress } from "@/lib/one-tap";

// The part of One Tap that runs only once it is wanted (`OneTap` imports this module when the
// browser is idle, so none of it is in the page's first load): Google's library, its prompt, and
// the sign-in with the token it hands over.
type Identity = {
  initialize(options: Record<string, unknown>): void;
  prompt(): void;
  cancel(): void;
};

declare global {
  interface Window {
    google?: { accounts: { id: Identity } };
  }
}

const LIBRARY = "https://accounts.google.com/gsi/client";
let loading: Promise<Identity> | undefined;

function loadLibrary(locale: string): Promise<Identity> {
  loading ??= new Promise<Identity>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `${LIBRARY}?hl=${encodeURIComponent(locale)}`;
    script.async = true;
    script.nonce = documentNonce() ?? "";
    script.onload = () => {
      const identity = window.google?.accounts.id;
      if (identity) resolve(identity);
      else reject(new Error("Google's sign-in library did not start"));
    };
    script.onerror = () => {
      loading = undefined;
      reject(new Error("Google's sign-in library could not be loaded"));
    };
    document.head.append(script);
  });
  return loading;
}

// Hands Google's token to the backend, which signs the visitor in (and makes the account of a new
// one). Then a full load of `next`, or of this page, draws it for the member; a refusal goes to the
// sign-in page, which says why.
async function signIn(credential: string, next: string | undefined) {
  let response: Response;
  try {
    response = await fetch("/api/auth/one-tap/callback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ idToken: credential }),
    });
  } catch {
    window.location.assign(oneTapRefusalAddress(0, null));
    return;
  }
  if (response.ok) {
    if (next) window.location.assign(next);
    else window.location.reload();
    return;
  }
  const body = await response.json().catch(() => null);
  window.location.assign(oneTapRefusalAddress(response.status, body));
}

export type OneTapOptions = {
  clientId: string;
  locale: string;
  // Words the prompt: "Sign in to" or "Sign up to" the site.
  context: "signin" | "signup";
  // Where a sign-in goes; this page when absent.
  next?: string;
};

// Loads Google's library and asks it for its prompt. Google decides whether to show it (it waits
// longer each time a visitor closes it). Returns what takes the prompt away again. A library that
// does not load shows nothing: the page's other ways to sign in stay.
export function showOneTap({
  clientId,
  locale,
  context,
  next,
}: OneTapOptions): () => void {
  let gone = false;
  loadLibrary(locale)
    .then((identity) => {
      if (gone) return;
      identity.initialize({
        client_id: clientId,
        callback: ({ credential }: { credential: string }) =>
          signIn(credential, next),
        context,
        // The prompt on Safari and other browsers that block third-party cookies.
        itp_support: true,
      });
      identity.prompt();
    })
    .catch(() => {});
  return () => {
    gone = true;
    window.google?.accounts.id.cancel();
  };
}
