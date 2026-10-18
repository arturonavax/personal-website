import type { Locale } from "../../i18n/locales";

export const PERSON_ENTITY_ID = "https://arturonavax.dev/#person";
export const WEBSITE_ENTITY_ID = "https://arturonavax.dev/#website";

export interface SchemaPersonOptions {
  locale: Locale;
  canonicalUrl: string;
  jobTitle: string;
  description: string;
  sameAs?: string[];
}

export interface SchemaArticleOptions {
  locale: Locale;
  canonicalUrl: string;
  headline: string;
  description: string;
  publishedAt?: string | undefined;
  updatedAt?: string | undefined;
  authorName?: string | undefined;
  tags?: string[] | undefined;
  imageUrl?: string | undefined;
  wordCount?: number | undefined;
  bodyText?: string | undefined;
  proficiencyLevel?: string | undefined;
}

export interface SchemaProjectOptions {
  locale: Locale;
  canonicalUrl: string;
  title: string;
  description: string;
  techStack?: string[] | undefined;
  repoUrl?: string | undefined;
  liveUrl?: string | undefined;
  publishedAt?: string | undefined;
  updatedAt?: string | undefined;
}

export interface SchemaServiceOptions {
  locale: Locale;
  canonicalUrl: string;
  title: string;
  description: string;
  serviceType?: string | undefined;
  price?: string | undefined;
  tags?: string[] | undefined;
}

export interface SchemaResumeOptions {
  locale: Locale;
  canonicalUrl: string;
  title: string;
  description: string;
}

export interface SchemaExperienceOptions {
  locale: Locale;
  canonicalUrl: string;
  role: string;
  company: string;
  description: string;
  startDate?: string | undefined;
  endDate?: string | undefined;
  skills?: string[] | undefined;
  companyUrl?: string | undefined;
}

const DEFAULT_SAME_AS = [
  "https://github.com/arturonavax",
  "https://www.linkedin.com/in/arturonavax",
  "https://x.com/arturonavax",
];

const SECTION_LABELS: Record<string, { en: string; es: string }> = {
  blog: { en: "Blog & Engineering Notes", es: "Blog y Notas de Ingeniería" },
  projects: { en: "Projects & Systems", es: "Proyectos y Sistemas" },
  services: { en: "Store & Services", es: "Tienda y Servicios" },
  experience: { en: "Career Trajectory", es: "Trayectoria Profesional" },
  resume: { en: "Curriculum Vitae", es: "Currículum Vitae" },
  tools: { en: "Engineering Tools", es: "Herramientas de Ingeniería" },
};

export function buildBreadcrumbNode(
  canonicalUrl: string,
  locale: Locale,
  pageTitle?: string,
): Record<string, unknown> {
  const isEs = locale === "es";
  const homeUrl = isEs
    ? "https://arturonavax.dev/es/"
    : "https://arturonavax.dev/";
  const items: Array<Record<string, unknown>> = [
    {
      "@type": "ListItem",
      position: 1,
      name: isEs ? "Inicio" : "Home",
      item: homeUrl,
    },
  ];

  try {
    const parsed = new URL(canonicalUrl, "https://arturonavax.dev");
    const rawSegments = parsed.pathname
      .split("/")
      .filter((s) => Boolean(s) && s !== "en" && s !== "es");

    let currentPath = isEs ? "/es" : "";
    for (let i = 0; i < rawSegments.length; i++) {
      const seg = rawSegments[i]!;
      currentPath += `/${seg}`;
      const isLast = i === rawSegments.length - 1;
      const sectionLabel = SECTION_LABELS[seg]?.[isEs ? "es" : "en"];
      const fallbackLabel = seg
        .split("-")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(" ");

      items.push({
        "@type": "ListItem",
        position: items.length + 1,
        name: isLast && pageTitle ? pageTitle : (sectionLabel ?? fallbackLabel),
        item: `https://arturonavax.dev${currentPath}/`,
      });
    }
  } catch {
    // Keep root Home item on invalid URL
  }

  return {
    "@type": "BreadcrumbList",
    "@id": `${canonicalUrl}#breadcrumb`,
    itemListElement: items,
  };
}

export function buildCoreGraphNodes(options: {
  locale: Locale;
  canonicalUrl: string;
  title: string;
  description: string;
  pageType?: string | string[] | undefined;
  sameAs?: string[] | undefined;
}): Array<Record<string, unknown>> {
  const isEs = options.locale === "es";
  const lang = isEs ? "es" : "en";

  const personNode: Record<string, unknown> = {
    "@type": "Person",
    "@id": PERSON_ENTITY_ID,
    name: "Arturo Nava",
    alternateName: ["arturonavax", "Arturo Enrique Nava Matheus"],
    jobTitle: isEs
      ? "Ingeniero de Software Senior / IA"
      : "Senior Software / AI Engineer",
    description: options.description,
    url: "https://arturonavax.dev/",
    sameAs: options.sameAs || DEFAULT_SAME_AS,
    worksFor: {
      "@type": "Organization",
      name: "LATAM Airlines",
      url: "https://www.latamairlines.com",
    },
    alumniOf: [
      {
        "@type": "EducationalOrganization",
        "@id": "https://arturonavax.dev/#etcr-romulo-gallegos",
        name: "E.T.C.R Rómulo Gallegos",
      },
    ],
    knowsAbout: [
      "Go",
      "Rust",
      "Python",
      "Distributed Systems",
      "High-Concurrency Architecture",
      "Cloudflare Workers",
      "Zero Trust Security",
      "Agentic AI Workflows",
    ],
  };

  const websiteNode: Record<string, unknown> = {
    "@type": "WebSite",
    "@id": WEBSITE_ENTITY_ID,
    url: isEs ? "https://arturonavax.dev/es/" : "https://arturonavax.dev/",
    name: "Arturo Nava",
    alternateName: "arturonavax.dev",
    inLanguage: lang,
    publisher: { "@id": PERSON_ENTITY_ID },
    potentialAction: {
      "@type": "SearchAction",
      target: "https://arturonavax.dev/search?q={search_term_string}",
      "query-input": "required name=search_term_string",
    },
  };

  const webpageNode: Record<string, unknown> = {
    "@type": options.pageType || "WebPage",
    "@id": `${options.canonicalUrl}#webpage`,
    url: options.canonicalUrl,
    name: options.title,
    description: options.description,
    inLanguage: lang,
    isPartOf: { "@id": WEBSITE_ENTITY_ID },
    about: { "@id": PERSON_ENTITY_ID },
    breadcrumb: { "@id": `${options.canonicalUrl}#breadcrumb` },
  };

  const breadcrumbNode = buildBreadcrumbNode(
    options.canonicalUrl,
    options.locale,
    options.title,
  );

  return [personNode, websiteNode, webpageNode, breadcrumbNode];
}

export function buildPersonJsonLd(
  options: SchemaPersonOptions,
): Record<string, unknown> {
  const coreNodes = buildCoreGraphNodes({
    locale: options.locale,
    canonicalUrl: options.canonicalUrl,
    title: `Arturo Nava - ${options.jobTitle}`,
    description: options.description,
    pageType: ["ProfilePage", "WebPage"],
    sameAs: options.sameAs,
  });
  coreNodes[0] = {
    ...coreNodes[0],
    jobTitle: options.jobTitle,
    description: options.description,
  };

  return {
    "@context": "https://schema.org",
    "@type": "Person",
    "@id": PERSON_ENTITY_ID,
    inLanguage: options.locale,
    name: "Arturo Nava",
    jobTitle: options.jobTitle,
    description: options.description,
    url: options.canonicalUrl,
    sameAs: options.sameAs || DEFAULT_SAME_AS,
    "@graph": coreNodes,
  };
}

export function buildArticleJsonLd(
  options: SchemaArticleOptions,
): Record<string, unknown> {
  const computedWords =
    options.wordCount ??
    (options.bodyText
      ? Math.max(
          120,
          options.bodyText.trim().split(/\s+/).filter(Boolean).length,
        )
      : 850);
  const readingMinutes = Math.max(1, Math.ceil(computedWords / 200));
  const timeRequired = `PT${readingMinutes}M`;
  const speakable = {
    "@type": "SpeakableSpecification",
    cssSelector: ["h1", "article > p:first-of-type"],
  };

  const coreNodes = buildCoreGraphNodes({
    locale: options.locale,
    canonicalUrl: options.canonicalUrl,
    title: options.headline,
    description: options.description,
    pageType: "WebPage",
  });

  const articleNode: Record<string, unknown> = {
    "@type": ["TechArticle", "BlogPosting"],
    "@id": `${options.canonicalUrl}#article`,
    inLanguage: options.locale,
    headline: options.headline,
    description: options.description,
    url: options.canonicalUrl,
    mainEntityOfPage: { "@id": `${options.canonicalUrl}#webpage` },
    isPartOf: { "@id": WEBSITE_ENTITY_ID },
    ...(options.publishedAt ? { datePublished: options.publishedAt } : {}),
    ...(options.updatedAt || options.publishedAt
      ? { dateModified: options.updatedAt || options.publishedAt }
      : {}),
    author: {
      "@type": "Person",
      "@id": PERSON_ENTITY_ID,
      name: options.authorName || "Arturo Nava",
      url: "https://arturonavax.dev/",
    },
    publisher: {
      "@type": "Person",
      "@id": PERSON_ENTITY_ID,
      name: "Arturo Nava",
    },
    wordCount: computedWords,
    timeRequired,
    proficiencyLevel: options.proficiencyLevel || "Expert",
    speakable,
    ...(options.tags && options.tags.length > 0
      ? { keywords: options.tags.join(", ") }
      : {}),
    ...(options.imageUrl ? { image: options.imageUrl } : {}),
  };

  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "@id": PERSON_ENTITY_ID,
    inLanguage: options.locale,
    headline: options.headline,
    description: options.description,
    url: options.canonicalUrl,
    ...(options.publishedAt ? { datePublished: options.publishedAt } : {}),
    ...(options.updatedAt || options.publishedAt
      ? { dateModified: options.updatedAt || options.publishedAt }
      : {}),
    author: articleNode.author,
    publisher: articleNode.publisher,
    wordCount: computedWords,
    timeRequired,
    proficiencyLevel: options.proficiencyLevel || "Expert",
    speakable,
    keywords: options.tags?.join(", "),
    image: options.imageUrl,
    "@graph": [...coreNodes, articleNode],
  };
}

export function buildProjectJsonLd(
  options: SchemaProjectOptions,
): Record<string, unknown> {
  const coreNodes = buildCoreGraphNodes({
    locale: options.locale,
    canonicalUrl: options.canonicalUrl,
    title: options.title,
    description: options.description,
    pageType: "WebPage",
  });

  const softwareNode: Record<string, unknown> = {
    "@type": ["SoftwareSourceCode", "SoftwareApplication"],
    "@id": `${options.canonicalUrl}#software`,
    name: options.title,
    headline: options.title,
    description: options.description,
    url: options.canonicalUrl,
    inLanguage: options.locale,
    mainEntityOfPage: { "@id": `${options.canonicalUrl}#webpage` },
    isPartOf: { "@id": WEBSITE_ENTITY_ID },
    author: {
      "@type": "Person",
      "@id": PERSON_ENTITY_ID,
      name: "Arturo Nava",
      url: "https://arturonavax.dev/",
    },
    programmingLanguage:
      options.techStack && options.techStack.length > 0
        ? options.techStack
        : ["Go", "Rust", "Python", "TypeScript"],
    runtimePlatform: "Cloudflare Edge / Linux Containers",
    applicationCategory: "DeveloperApplication",
    codeRepository: options.repoUrl || "https://github.com/arturonavax",
    ...(options.publishedAt ? { datePublished: options.publishedAt } : {}),
    ...(options.updatedAt || options.publishedAt
      ? { dateModified: options.updatedAt || options.publishedAt }
      : {}),
  };

  return {
    "@context": "https://schema.org",
    "@type": "SoftwareSourceCode",
    "@id": PERSON_ENTITY_ID,
    inLanguage: options.locale,
    name: options.title,
    headline: options.title,
    description: options.description,
    url: options.canonicalUrl,
    author: softwareNode.author,
    programmingLanguage: softwareNode.programmingLanguage,
    codeRepository: softwareNode.codeRepository,
    runtimePlatform: softwareNode.runtimePlatform,
    "@graph": [...coreNodes, softwareNode],
  };
}

export function buildServiceJsonLd(
  options: SchemaServiceOptions,
): Record<string, unknown> {
  const coreNodes = buildCoreGraphNodes({
    locale: options.locale,
    canonicalUrl: options.canonicalUrl,
    title: options.title,
    description: options.description,
    pageType: "WebPage",
  });

  const serviceNode: Record<string, unknown> = {
    "@type": ["Service", "ProfessionalService"],
    "@id": `${options.canonicalUrl}#service`,
    name: options.title,
    description: options.description,
    url: options.canonicalUrl,
    inLanguage: options.locale,
    mainEntityOfPage: { "@id": `${options.canonicalUrl}#webpage` },
    isPartOf: { "@id": WEBSITE_ENTITY_ID },
    provider: {
      "@type": "Person",
      "@id": PERSON_ENTITY_ID,
      name: "Arturo Nava",
      url: "https://arturonavax.dev/",
    },
    areaServed: "Worldwide",
    availableChannel: {
      "@type": "ServiceChannel",
      serviceUrl: options.canonicalUrl,
      availableLanguage: ["English", "Spanish"],
    },
    ...(options.serviceType ? { serviceType: options.serviceType } : {}),
    ...(options.tags && options.tags.length > 0
      ? { keywords: options.tags.join(", ") }
      : {}),
  };

  return {
    "@context": "https://schema.org",
    "@type": "Service",
    "@id": PERSON_ENTITY_ID,
    inLanguage: options.locale,
    name: options.title,
    description: options.description,
    url: options.canonicalUrl,
    provider: serviceNode.provider,
    areaServed: "Worldwide",
    availableChannel: serviceNode.availableChannel,
    "@graph": [...coreNodes, serviceNode],
  };
}

export function buildResumeJsonLd(
  options: SchemaResumeOptions,
): Record<string, unknown> {
  const isEs = options.locale === "es";
  const coreNodes = buildCoreGraphNodes({
    locale: options.locale,
    canonicalUrl: options.canonicalUrl,
    title: options.title,
    description: options.description,
    pageType: ["ProfilePage", "WebPage"],
  });

  const webpageNode = coreNodes[2]!;
  webpageNode.mainEntity = { "@id": PERSON_ENTITY_ID };
  webpageNode.hasOccupation = [
    {
      "@type": "Occupation",
      name: isEs
        ? "Ingeniero de Software Senior & Arquitecto de Sistemas Distribuidos"
        : "Senior Software Engineer & Distributed Systems Architect",
      skills: "Go, Rust, Python, Distributed Systems, Security, Agentic AI",
    },
  ];
  webpageNode.educationalCredentialAwarded = isEs
    ? "Técnico Medio en Comercio y Servicios Administrativos, Mención Informática"
    : "Middle Technical Degree in Commerce & Administrative Services, Major in Computer Science";

  return {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    "@id": PERSON_ENTITY_ID,
    inLanguage: options.locale,
    name: options.title,
    description: options.description,
    url: options.canonicalUrl,
    mainEntity: { "@id": PERSON_ENTITY_ID },
    hasOccupation: webpageNode.hasOccupation,
    educationalCredentialAwarded: webpageNode.educationalCredentialAwarded,
    "@graph": coreNodes,
  };
}

export function buildExperienceJsonLd(
  options: SchemaExperienceOptions,
): Record<string, unknown> {
  const headline = `${options.role} at ${options.company} - Career Milestone & System Architecture`;
  const coreNodes = buildCoreGraphNodes({
    locale: options.locale,
    canonicalUrl: options.canonicalUrl,
    title: headline,
    description: options.description,
    pageType: "WebPage",
  });

  const experienceNode: Record<string, unknown> = {
    "@type": ["TechArticle", "BlogPosting"],
    "@id": `${options.canonicalUrl}#experience`,
    headline,
    description: options.description,
    url: options.canonicalUrl,
    inLanguage: options.locale,
    mainEntityOfPage: { "@id": `${options.canonicalUrl}#webpage` },
    isPartOf: { "@id": WEBSITE_ENTITY_ID },
    author: {
      "@type": "Person",
      "@id": PERSON_ENTITY_ID,
      name: "Arturo Nava",
      url: "https://arturonavax.dev/",
    },
    publisher: {
      "@type": "Person",
      "@id": PERSON_ENTITY_ID,
      name: "Arturo Nava",
    },
    about: {
      "@type": "Organization",
      name: options.company,
      ...(options.companyUrl ? { url: options.companyUrl } : {}),
    },
    ...(options.startDate ? { datePublished: options.startDate } : {}),
    ...(options.endDate || options.startDate
      ? { dateModified: options.endDate || options.startDate }
      : {}),
    ...(options.skills && options.skills.length > 0
      ? { keywords: options.skills.join(", ") }
      : {}),
    proficiencyLevel: "Expert",
    speakable: {
      "@type": "SpeakableSpecification",
      cssSelector: ["h1", "article > p:first-of-type"],
    },
  };

  return {
    "@context": "https://schema.org",
    "@type": "TechArticle",
    "@id": PERSON_ENTITY_ID,
    inLanguage: options.locale,
    headline,
    description: options.description,
    url: options.canonicalUrl,
    author: experienceNode.author,
    publisher: experienceNode.publisher,
    ...(options.startDate ? { datePublished: options.startDate } : {}),
    "@graph": [...coreNodes, experienceNode],
  };
}

/**
 * Normalizes any page JSON-LD input (or generates a default one when omitted)
 * so every page emits a single valid `<script type="application/ld+json">` with
 * `@context: "https://schema.org"` and `@graph` containing `#person`, `#website`,
 * `#webpage`, and `#breadcrumb`.
 */
export function ensureUnifiedGraphJsonLd(
  inputJsonLd:
    Record<string, unknown> | Array<Record<string, unknown>> | undefined,
  fallback: {
    locale: Locale;
    canonicalUrl: string;
    title: string;
    description: string;
  },
): Record<string, unknown> {
  const coreNodes = buildCoreGraphNodes({
    locale: fallback.locale,
    canonicalUrl: fallback.canonicalUrl,
    title: fallback.title,
    description: fallback.description,
  });

  if (!inputJsonLd) {
    return {
      "@context": "https://schema.org",
      "@id": PERSON_ENTITY_ID,
      inLanguage: fallback.locale,
      "@graph": coreNodes,
    };
  }

  const rootObj: Record<string, unknown> = Array.isArray(inputJsonLd)
    ? inputJsonLd.length === 1 && inputJsonLd[0]
      ? { ...inputJsonLd[0] }
      : {
          "@context": "https://schema.org",
          "@id": PERSON_ENTITY_ID,
          inLanguage: fallback.locale,
          "@graph": inputJsonLd,
        }
    : { ...inputJsonLd };

  const existingGraph = Array.isArray(rootObj["@graph"])
    ? ([...(rootObj["@graph"] as Array<Record<string, unknown>>)] as Array<
        Record<string, unknown>
      >)
    : [];

  const hasNodeId = (suffixOrExact: string) =>
    existingGraph.some((node) => {
      const id = typeof node?.["@id"] === "string" ? node["@id"] : "";
      return id === suffixOrExact || id.endsWith(suffixOrExact);
    });

  if (existingGraph.length === 0) {
    // Wrap standalone entity node into @graph alongside core nodes
    const standaloneNode = { ...rootObj };
    delete standaloneNode["@context"];
    delete standaloneNode["@graph"];
    const mergedGraph = [...coreNodes];
    if (
      standaloneNode["@type"] &&
      standaloneNode["@type"] !== "Person" &&
      standaloneNode["@type"] !== "WebSite" &&
      standaloneNode["@type"] !== "WebPage"
    ) {
      if (
        !standaloneNode["@id"] ||
        standaloneNode["@id"] === PERSON_ENTITY_ID
      ) {
        standaloneNode["@id"] = `${fallback.canonicalUrl}#entity`;
      }
      mergedGraph.push(standaloneNode);
    }
    return {
      ...rootObj,
      "@context": "https://schema.org",
      "@id": rootObj["@id"] || PERSON_ENTITY_ID,
      inLanguage: rootObj["inLanguage"] || fallback.locale,
      "@graph": mergedGraph,
    };
  }

  if (!hasNodeId("#person")) existingGraph.push(coreNodes[0]!);
  if (!hasNodeId("#website")) existingGraph.push(coreNodes[1]!);
  if (!hasNodeId("#webpage") && !hasNodeId("#profilepage")) {
    existingGraph.push(coreNodes[2]!);
  }
  if (!hasNodeId("#breadcrumb")) existingGraph.push(coreNodes[3]!);

  return {
    ...rootObj,
    "@context": "https://schema.org",
    "@id": rootObj["@id"] || PERSON_ENTITY_ID,
    inLanguage: rootObj["inLanguage"] || fallback.locale,
    "@graph": existingGraph,
  };
}
