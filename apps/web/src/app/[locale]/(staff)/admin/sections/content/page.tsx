import { landingMetadata, SectionLanding } from "../../../section-landing";

export const generateMetadata = () => landingMetadata("content");

export default function ContentLanding() {
  return <SectionLanding section="content" />;
}
