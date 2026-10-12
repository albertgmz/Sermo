import { isLiteMode } from "@/lib/lite-mode";

export async function SiteIcon() {
  if (await isLiteMode()) return null;
  return (
    <link rel="icon" href="/icon.svg" type="image/svg+xml" sizes="24x24" />
  );
}
