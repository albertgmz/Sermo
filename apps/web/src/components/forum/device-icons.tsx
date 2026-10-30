import { Monitor, Smartphone, Tablet } from "lucide-react";
import { useTranslations } from "next-intl";
import { SystemIcon } from "@/components/forum/client-icons";
import { LazyTooltip } from "@/components/ui/lazy-tooltip";
import type { DeviceView } from "@/lib/sermo/views";
import { cn } from "@/lib/utils";

const TYPE_ICON = "size-3.5";
const TYPES = {
  desktop: <Monitor aria-hidden="true" className={TYPE_ICON} />,
  phone: <Smartphone aria-hidden="true" className={TYPE_ICON} />,
  tablet: <Tablet aria-hidden="true" className={TYPE_ICON} />,
};

// The device a member last signed in from, as two small marks that sit on a line of small text:
// the kind of device, then the logo of its system. Each one names itself on hover: the kind
// ("Phone"), then the system and the browser ("Android · Chrome"). A kind other than a computer,
// a phone or a tablet has no mark.
export function DeviceIcons({
  device,
  className,
}: {
  device: DeviceView;
  className?: string;
}) {
  const t = useTranslations("forum.deviceIcons");
  const system = [device.os ?? t("unknownSystem"), device.browser]
    .filter(Boolean)
    .join(" · ");
  return (
    <span
      data-slot="device-icons"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 align-middle text-muted-foreground",
        className,
      )}
    >
      {device.type && (
        <LazyTooltip label={t(`types.${device.type}`)} className="inline-flex">
          {TYPES[device.type]}
        </LazyTooltip>
      )}
      <LazyTooltip label={system} className="inline-flex">
        <SystemIcon os={device.os} className={TYPE_ICON} />
      </LazyTooltip>
    </span>
  );
}
