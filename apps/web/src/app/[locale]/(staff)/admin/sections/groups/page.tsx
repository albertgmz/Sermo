import { landingMetadata, SectionLanding } from "../../../section-landing";

export const generateMetadata = () => landingMetadata("groups");

export default function GroupsLanding() {
  return <SectionLanding section="groups" />;
}
