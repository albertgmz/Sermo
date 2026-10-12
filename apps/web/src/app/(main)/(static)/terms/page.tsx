import {
  StaticPage,
  staticPageMetadata,
} from "@/app/(main)/(static)/static-page";

export function generateMetadata() {
  return staticPageMetadata("terms");
}

export default function Page() {
  return <StaticPage slug="terms" path="/terms" />;
}
