import { availability } from "../../config/availability.mjs";

/** Positioning describes opportunities sought, not an unverified current role. */
export function createHiringPositioning(
  openToWork: boolean = availability.openToWork,
) {
  return {
    en: {
      title: "Arturo Nava | Senior Software Engineer & Technology Leadership",
      description: openToWork
        ? "Senior Software Engineer specializing in Go, Rust, distributed systems and AI. Explore experience, projects and opportunities for technology leadership or consulting."
        : "Senior Software Engineer specializing in Go, Rust, distributed systems and AI. Explore software projects, architecture insights and technology leadership experience.",
      availability: openToWork
        ? "Open to Senior / Staff Software Engineer and Director of Technology opportunities, plus independent software architecture projects."
        : "Selected software engineering work, architecture insights and technology leadership experience.",
      status: openToWork
        ? "STATUS: ACTIVE // AVAILABLE"
        : "STATUS: ACTIVE // NOT SEEKING WORK",
      isAvailable: openToWork,
    },
    es: {
      title: "Arturo Nava | Ingeniería de Software Senior y Liderazgo Técnico",
      description: openToWork
        ? "Ingeniería de software senior en Go, Rust, sistemas distribuidos e IA. Experiencia y proyectos para oportunidades de liderazgo tecnológico o consultoría."
        : "Ingeniería de software senior en Go, Rust, sistemas distribuidos e IA. Proyectos de software, arquitectura y experiencia de liderazgo tecnológico.",
      availability: openToWork
        ? "Disponible para posiciones de ingeniería de software Senior / Staff y dirección de tecnología, además de proyectos independientes de arquitectura de software."
        : "Una selección de proyectos de ingeniería de software, arquitectura y experiencia de liderazgo tecnológico.",
      status: openToWork
        ? "ESTADO: ACTIVO // DISPONIBLE"
        : "ESTADO: ACTIVO // SIN BÚSQUEDA LABORAL",
      isAvailable: openToWork,
    },
  } as const;
}

export const hiringPositioning = createHiringPositioning();
