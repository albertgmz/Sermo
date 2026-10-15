import {
  StaticPage,
  staticPageMetadata,
} from "@/app/[locale]/(main)/(static)/static-page";
import { LoggedData } from "@/components/forum/logged-data";

export function generateMetadata() {
  return staticPageMetadata("privacy");
}

export default function Page() {
  return <StaticPage slug="privacy" path="/privacy" after={<LoggedData />} />;
}
