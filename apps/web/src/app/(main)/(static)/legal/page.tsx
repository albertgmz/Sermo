import {
  StaticPage,
  staticPageMetadata,
} from "@/app/(main)/(static)/static-page";

export function generateMetadata() {
  return staticPageMetadata("legal");
}

export default function Page() {
  return <StaticPage slug="legal" path="/legal" />;
}
