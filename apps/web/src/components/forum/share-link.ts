import { announce } from "@/components/forum/notice-store";
import { copyText } from "@/lib/clipboard";
import { shareAddress } from "@/lib/referral/link";
import { currentViewer } from "@/lib/session-epoch";

// The floating notice said once a link is on the clipboard (`PageNotice` in the main layout).
export const LINK_COPIED = "linkCopied";

// A signed-in member's copy of the link carries their id, so those who register through it are
// credited to them.
export const linkTo = (href: string) =>
  shareAddress(href, location.origin, currentViewer());

type Device = {
  share?: (data: { url: string }) => Promise<void>;
  clipboard?: { writeText: (text: string) => Promise<void> };
  // A touch screen: a phone or a tablet, whose share sheet is how links travel there.
  touch: boolean;
};

// Hands the link to the device's share sheet where there is one and says so; false where there is
// none or it failed at once. Closing the sheet (an AbortError) is nothing wrong; any other failure
// calls `fallback`.
function shareNatively(url: string, device: Device, fallback: () => void) {
  if (typeof device.share !== "function") return false;
  try {
    device.share({ url }).catch((error: unknown) => {
      if ((error as { name?: string } | null)?.name !== "AbortError") {
        fallback();
      }
    });
  } catch {
    return false;
  }
  return true;
}

// What one press of Share does. On a touch screen with a share sheet the sheet takes the link;
// everywhere else (and where the sheet fails) the link goes on the clipboard at once and the
// floating notice says so. Where the clipboard refuses, `manual` hands the link over to be copied
// by hand. Both are asked for inside the press: a browser allows them only there.
export function shareLink(
  url: string,
  device: Device,
  manual: (url: string) => void,
) {
  const copy = () =>
    copyText(url, device).then((copied) => {
      if (copied) announce(LINK_COPIED);
      else manual(url);
    });
  if (device.touch && shareNatively(url, device, copy)) return;
  void copy();
}
