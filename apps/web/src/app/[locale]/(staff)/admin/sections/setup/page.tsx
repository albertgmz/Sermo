import { landingMetadata, SectionLanding } from "../../../section-landing";

export const generateMetadata = () => landingMetadata("setup");

export default function SetupLanding() {
  return <SectionLanding section="setup" />;
}
