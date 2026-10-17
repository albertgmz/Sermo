import { landingMetadata, SectionLanding } from "../../../section-landing";

export const generateMetadata = () => landingMetadata("forums");

export default function ForumsLanding() {
  return <SectionLanding section="forums" />;
}
