import { Monitor, Smartphone, Tablet } from "lucide-react";
import { useTranslations } from "next-intl";
import { hasSystemLogo, SystemIcon } from "@/components/forum/client-icons";
import { LazyTooltip } from "@/components/ui/lazy-tooltip";
import type { DeviceView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

const ICON = "size-3.5";
const TYPES = {
  desktop: <Monitor aria-hidden="true" className={ICON} />,
  phone: <Smartphone aria-hidden="true" className={ICON} />,
  tablet: <Tablet aria-hidden="true" className={ICON} />,
};

// The device a member last signed in from, as two small marks that sit on a line of small text:
// the kind of device, then the logo of its system. Each one names itself on hover: the kind
// ("Phone"), then the system and the browser ("Android · Chrome"). A system with no logo draws no
// second mark (a plain screen beside a phone would contradict it): the kind then names the system
// and the browser. A kind other than a computer, a phone or a tablet has no mark; with no logo
// either, nothing is drawn.
export function DeviceIcons({
  device,
  className,
}: {
  device: DeviceView;
  className?: string;
}) {
  const t = useTranslations("forum.deviceIcons");
  const names = [device.os, device.browser].filter(Boolean).join(" · ");
  const logo = hasSystemLogo(device.os);
  if (!device.type && !logo) return null;
  return (
    <span
      data-slot="device-icons"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 align-middle text-muted-foreground",
        className,
      )}
    >
      {device.type && (
        <LazyTooltip
          label={logo || !names ? t(`types.${device.type}`) : names}
          className="inline-flex"
        >
          {TYPES[device.type]}
        </LazyTooltip>
      )}
      {logo && (
        <LazyTooltip label={names} className="inline-flex">
          <SystemIcon os={device.os} className={ICON} />
        </LazyTooltip>
      )}
    </span>
  );
}
