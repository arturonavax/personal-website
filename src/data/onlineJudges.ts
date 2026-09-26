export interface MetricItem {
  label: string;
  labelEs: string;
  value: string;
  valueEs: string;
}

export interface JudgeProfile {
  name: string;
  handle: string;
  url: string;
  description: string;
  descriptionEs: string;
  category: string;
  categoryEs: string;
  accentColor: string;
  icon: string;
  metrics: MetricItem[];
}

export const judgeProfiles: JudgeProfile[] = [];

/* TODO: reactivate
export const judgeProfiles: JudgeProfile[] = [
  {
    name: "LeetCode",
    handle: "arturonavax",
    url: "https://leetcode.com/u/arturonavax/",
    description:
      "Advanced algorithms, data structures, dynamic programming & concurrency patterns.",
    descriptionEs:
      "Algoritmos avanzados, estructuras de datos, programación dinámica y concurrencia.",
    category: "Algorithms & Problem Solving",
    categoryEs: "Algoritmos & Resolución de Problemas",
    accentColor: "#FFA116",
    icon: "code",
    metrics: [
      {
        label: "Rating",
        labelEs: "Puntaje",
        value: "2,180+",
        valueEs: "2,180+",
      },
      {
        label: "Tier",
        labelEs: "Nivel",
        value: "Guardian (Top 1%)",
        valueEs: "Guardian (Top 1%)",
      },
      {
        label: "Solved",
        labelEs: "Resueltos",
        value: "650+ Problems",
        valueEs: "650+ Problemas",
      },
    ],
  },
  {
    name: "Codeforces",
    handle: "arturonavax",
    url: "https://codeforces.com/profile/arturonavax",
    description:
      "Competitive rounds, discrete mathematics, graph theory & number theory.",
    descriptionEs:
      "Rounds competitivos, matemáticas discretas, grafos y teoría de números.",
    category: "Competitive Programming",
    categoryEs: "Programación Competitiva",
    accentColor: "#1F8ACB",
    icon: "bar-chart",
    metrics: [
      {
        label: "Rating",
        labelEs: "Puntaje",
        value: "1,860+",
        valueEs: "1,860+",
      },
      {
        label: "Rank",
        labelEs: "Nivel",
        value: "Expert / Div. 1-2",
        valueEs: "Expert / Div. 1-2",
      },
      {
        label: "Solved",
        labelEs: "Resueltos",
        value: "420+ Problems",
        valueEs: "420+ Problemas",
      },
    ],
  },
  {
    name: "HackerRank",
    handle: "arturonavax",
    url: "https://www.hackerrank.com/profile/arturonavax",
    description:
      "Golang domain mastery, data structures, SQL & high-performance algorithm design.",
    descriptionEs:
      "Dominio en Golang, estructuras de datos, SQL y diseño de algoritmos de alto rendimiento.",
    category: "Core Language & CS Theory",
    categoryEs: "Teoría CS & Dominio de Lenguajes",
    accentColor: "#00EA64",
    icon: "terminal",
    metrics: [
      {
        label: "Badge",
        labelEs: "Puntaje",
        value: "6-Star Gold",
        valueEs: "6-Star Gold",
      },
      {
        label: "Rank",
        labelEs: "Nivel",
        value: "Top 0.5% Global",
        valueEs: "Top 0.5% Global",
      },
      {
        label: "Solved",
        labelEs: "Resueltos",
        value: "280+ Challenges",
        valueEs: "280+ Retos",
      },
    ],
  },
  {
    name: "Beecrowd (URI)",
    handle: "arturonavax",
    url: "https://judge.beecrowd.com/en/profile/arturonavax",
    description:
      "Computational paradigms, string algorithms, computational geometry & mathematics.",
    descriptionEs:
      "Entrenamiento en paradigmas de computación, optimización matemática y cadenas.",
    category: "Algorithmic Archive",
    categoryEs: "Archivo Algorítmico",
    accentColor: "#FF6F00",
    icon: "cpu",
    metrics: [
      {
        label: "Level",
        labelEs: "Puntaje",
        value: "Level 8 (Elite)",
        valueEs: "Nivel 8 (Elite)",
      },
      {
        label: "Rank",
        labelEs: "Nivel",
        value: "Top 500 Global",
        valueEs: "Top 500 Global",
      },
      {
        label: "Solved",
        labelEs: "Resueltos",
        value: "350+ Problems",
        valueEs: "350+ Problemas",
      },
    ],
  },
];
*/
