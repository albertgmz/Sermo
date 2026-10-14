import {
  StaticPage,
  staticPageMetadata,
} from "@/app/[locale]/(main)/(static)/static-page";

export function generateMetadata() {
  return staticPageMetadata("contact");
}

export default function Page() {
  return <StaticPage slug="contact" path="/contact" />;
}
