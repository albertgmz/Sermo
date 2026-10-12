import {
  StaticPage,
  staticPageMetadata,
} from "@/app/(main)/(static)/static-page";

export function generateMetadata() {
  return staticPageMetadata("privacy");
}

export default function Page() {
  return <StaticPage slug="privacy" path="/privacy" />;
}
