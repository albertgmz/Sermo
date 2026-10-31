import {
  StaticPage,
  staticPageMetadata,
} from "@/app/[locale]/(policy)/static-page";

export function generateMetadata() {
  return staticPageMetadata("contact", "/contact");
}

export default function Page() {
  return <StaticPage slug="contact" path="/contact" />;
}
