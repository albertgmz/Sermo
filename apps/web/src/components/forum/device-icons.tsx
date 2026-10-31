import { useTranslations } from "next-intl";
import { LitePlaceholder } from "@/components/forum/lite-placeholder";
import {
  type DeviceFields,
  type DeviceIconFile,
  deviceIcon,
  deviceLabel,
  systemIcon,
  systemLabel,
} from "@/lib/device-icons";
import { blocksImageRequest } from "@/lib/lite-images";
import { getLiteState } from "@/lib/lite-mode";
import type { LiteState } from "@/lib/lite-preferences";
import { cn } from "@/lib/utils";

// The device a member signed in from, as two small icons that sit on a line of small text: the
// type of device, then the system. Each names itself: "Smartphone — Samsung", then
// "Android 14 · Chrome 132". Nothing is drawn when the device is absent (hidden from the viewer,
// or not known).
//
// No script: the words are a popover of the browser's own (`popover`), which a press on the icon
// (a tap, a click, Enter or Space) opens and closes, and a press anywhere else or Escape closes.
// A pointer that can hover also shows it while it stays on the icon. Keyboard focus does not: a
// preview kept by focus could not be closed with Escape (WCAG 1.4.13); the button's name is the
// same words. The icons are files of the app (`assets/device-icons`): while LITE blocks pictures,
// the proxy blocks their addresses and a placeholder stands in.
export async function DeviceIcons({
  device,
  className,
}: {
  device?: DeviceFields | null;
  className?: string;
}) {
  if (!device) return null;
  const lite = await getLiteState();
  // The popovers are found by id. A card loaded later is a render of its own, where React's ids
  // start again: random ones cannot meet the page's.
  const ids = [crypto.randomUUID(), crypto.randomUUID()];
  return (
    <DevicePair device={device} lite={lite} ids={ids} className={className} />
  );
}

function DevicePair({
  device,
  lite,
  ids,
  className,
}: {
  device: DeviceFields;
  lite: LiteState;
  ids: string[];
  className?: string;
}) {
  const t = useTranslations("forum.deviceIcons");
  return (
    <span
      data-slot="device-icons"
      className={cn(
        "inline-flex shrink-0 items-center gap-2 align-middle",
        className,
      )}
    >
      <DeviceTip
        id={`device-${ids[0]}`}
        label={deviceLabel(device, t)}
        icon={deviceIcon(device)}
        lite={lite}
      />
      <DeviceTip
        id={`device-${ids[1]}`}
        label={systemLabel(device, t)}
        icon={systemIcon(device)}
        lite={lite}
      />
    </span>
  );
}

// The hit area reaches 24 px around the 16 px icon.
const TRIGGER =
  "peer relative inline-flex size-4 shrink-0 cursor-default rounded-sm after:absolute after:-inset-1 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring";

const TIP = cn(
  "fixed z-50 m-0 hidden w-max max-w-xs overflow-visible rounded-md border-0 bg-foreground px-3 py-1.5 text-center text-xs font-normal whitespace-normal text-background shadow-md",
  "open:block peer-hover:block",
  // Above the icon (below it when there is no room) where the browser can place a box by another;
  // else at the foot of the screen.
  "[position-area:top] [position-try-fallbacks:flip-block] supports-[position-area:top]:inset-auto supports-[position-area:top]:mb-1",
  "not-supports-[position-area:top]:inset-x-0 not-supports-[position-area:top]:top-auto not-supports-[position-area:top]:bottom-4 not-supports-[position-area:top]:mx-auto",
);

function DeviceTip({
  id,
  label,
  icon,
  lite,
}: {
  id: string;
  label: string;
  icon: DeviceIconFile;
  lite: LiteState;
}) {
  const anchor = `--${id}`;
  return (
    <span className="inline-flex">
      <button
        type="button"
        popoverTarget={id}
        aria-label={label}
        className={TRIGGER}
        style={{ anchorName: anchor }}
      >
        {blocksImageRequest(lite, icon.src) ? (
          <LitePlaceholder compact className="size-4 rounded-sm" />
        ) : (
          <IconPicture icon={icon} />
        )}
      </button>
      <span
        id={id}
        popover="auto"
        className={TIP}
        style={{ positionAnchor: anchor }}
      >
        {label}
      </span>
    </span>
  );
}

// The picture is the CSS of a box of fixed size, so nothing moves while it loads. A dark glyph of
// one colour is a mask filled with the colour of the text around it, readable on both themes;
// a logo in colour is drawn as it is.
function IconPicture({ icon }: { icon: DeviceIconFile }) {
  const url = `url("${icon.src}")`;
  if (icon.monochrome)
    return (
      <span
        aria-hidden="true"
        className="size-4 bg-current forced-color-adjust-none"
        style={{
          mask: `${url} center / contain no-repeat`,
          WebkitMask: `${url} center / contain no-repeat`,
        }}
      />
    );
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-4 bg-contain bg-center bg-no-repeat",
        // A dark logo keeps a light edge on the dark theme.
        icon.dark && "dark:drop-shadow-[0_0_1px_rgb(255_255_255/0.9)]",
        // matomo-icons' unknown icon is empty: a dashed box shows where it is.
        icon.unknown &&
          "rounded-[3px] border border-dashed border-muted-foreground/60",
      )}
      style={{ backgroundImage: url }}
    />
  );
}
