// import { hasResume } from "./cv"; // TODO: reactivate

export interface ShortcutItem {
  id: string;
  title: string;
  titleEs?: string;
  description: string;
  descriptionEs?: string;
  url: string;
  external: boolean;
  badge?: string;
  badgeEs?: string;
  icon: "cv" | "github" | "terminal" | "architecture" | "app";
}

// Configurable shortcuts registry:
// If this array is empty ([]), the shortcuts floating trigger button and modal will NOT appear.
export const shortcuts: ShortcutItem[] = [];

/* TODO: reactivate
export const shortcuts: ShortcutItem[] = [
  ...(hasResume
    ? [
        {
          id: "cv",
          title: "Interactive CV / Resume",
          titleEs: "CV / Currículum Interactivo",
          description:
            "Official verified engineering trajectory and skills breakdown.",
          descriptionEs:
            "Trayectoria técnica verificada y desglose de aptitudes.",
          url: "/resume",
          external: false,
          badge: "Live",
          badgeEs: "En Vivo",
          icon: "cv" as const,
        },
      ]
    : []),
  {
    id: "github",
    title: "GitHub Repositories",
    titleEs: "Repositorios en GitHub",
    description:
      "Open source backends, benchmarks, and SIMD acceleration code.",
    descriptionEs: "Código fuente abierto, benchmarks y aceleración SIMD.",
    url: "https://github.com/arturonavax",
    external: true,
    badge: "Code",
    badgeEs: "Código",
    icon: "github",
  },
  {
    id: "fraud-engine",
    title: "Real-Time Fraud Engine",
    titleEs: "Motor Antifraude en Tiempo Real",
    description: "Sub-50ms Strategy Pattern specification in Go & Redis.",
    descriptionEs:
      "Especificación de patrón Strategy en Go y Redis a sub-50ms.",
    url: "/projects/real-time-fraud-engine",
    external: false,
    badge: "Spec",
    badgeEs: "Arquitectura",
    icon: "architecture",
  },
  {
    id: "snowflake-pipeline",
    title: "gosnowflake OLAP Decoupling",
    titleEs: "Desacople OLAP con gosnowflake",
    description:
      "Event-driven streaming pipeline for massive operational data.",
    descriptionEs:
      "Pipeline orientado a eventos para streaming analítico masivo.",
    url: "/projects/gosnowflake-olap-pipeline",
    external: false,
    badge: "Pipeline",
    badgeEs: "Pipeline",
    icon: "terminal",
  },
];
*/
