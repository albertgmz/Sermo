import {
  StaticPage,
  staticPageMetadata,
} from "@/app/[locale]/(main)/(static)/static-page";

export function generateMetadata() {
  return staticPageMetadata("terms");
}

export default function Page() {
  return <StaticPage slug="terms" path="/terms" />;
}
