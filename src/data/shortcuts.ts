import { isItemVisible } from "@/utils/visibility";
import { hasResume } from "./resume";

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
  draft?: boolean | undefined;
  visible?: boolean | undefined;
}

// Configurable shortcuts registry:
// Items with draft: true or visible: false are automatically excluded.
// If this array resolves to empty ([]), the shortcuts floating button and modal will NOT appear.
export const rawShortcuts: ShortcutItem[] = [
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
          url: "/resume/",
          external: false,
          badge: "Live",
          badgeEs: "En Vivo",
          icon: "cv" as const,
          visible: false,
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
    visible: false,
  },
  {
    id: "fraud-engine",
    title: "Real-Time Fraud Engine",
    titleEs: "Motor Antifraude en Tiempo Real",
    description: "Sub-50ms Strategy Pattern specification in Go & Redis.",
    descriptionEs:
      "Especificación de patrón Strategy en Go y Redis a sub-50ms.",
    url: "/projects/real-time-fraud-engine/",
    external: false,
    badge: "Spec",
    badgeEs: "Arquitectura",
    icon: "architecture",
    visible: false,
  },
  {
    id: "snowflake-pipeline",
    title: "gosnowflake OLAP Decoupling",
    titleEs: "Desacople OLAP con gosnowflake",
    description:
      "Event-driven streaming pipeline for massive operational data.",
    descriptionEs:
      "Pipeline orientado a eventos para streaming analítico masivo.",
    url: "/projects/gosnowflake-olap-pipeline/",
    external: false,
    badge: "Pipeline",
    badgeEs: "Pipeline",
    icon: "terminal",
    visible: false,
  },
];

export const shortcuts: ShortcutItem[] = rawShortcuts.filter(isItemVisible);
