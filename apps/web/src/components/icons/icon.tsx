import { iconComponent } from "@/components/icons/icon-set";

// Draws the icon stored under `name`, or nothing when there is none or the set does not know it.
export function Icon({
  name,
  className,
}: {
  name: string | null | undefined;
  className?: string;
}) {
  const Component = iconComponent(name);
  if (!Component) return null;
  return <Component className={className} aria-hidden="true" />;
}
