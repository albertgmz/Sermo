import { landingMetadata, SectionLanding } from "../../../section-landing";

export const generateMetadata = () => landingMetadata("communication");

export default function CommunicationLanding() {
  return <SectionLanding section="communication" />;
}
