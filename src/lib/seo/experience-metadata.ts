import type { SupportedLocale } from "../../i18n/config";

interface ExperienceMetadataInput {
  role: string;
  company: string;
  locale: SupportedLocale;
  endDate?: Date | undefined;
  hasSimulations?: boolean;
}

/** Match timeline semantics: an omitted endDate means the role is current. */
export function buildExperienceMetadata({
  role,
  company,
  locale,
  endDate,
  hasSimulations = false,
}: ExperienceMetadataInput): { title: string; description: string } {
  const former = Boolean(endDate);
  if (locale === "es") {
    return {
      title: `${former ? "Cargo anterior" : "Cargo actual"}: ${role} en ${company} | Arturo Nava`,
      description: `Arturo Nava ${former ? "trabajó" : "trabaja"} como ${role} en ${company}. Hitos de carrera y arquitectura de producción${hasSimulations ? ", con simulaciones interactivas de sistemas" : ""}.`,
    };
  }
  return {
    title: `${former ? "Former" : "Current"} ${role} at ${company} | Arturo Nava`,
    description: `Arturo Nava ${former ? "previously worked" : "currently works"} as ${role} at ${company}. Career milestones and production architecture achievements${hasSimulations ? ", with interactive system simulations" : ""}.`,
  };
}
