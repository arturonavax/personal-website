import { getCollection } from "astro:content";
import { getCompanyInfo } from "@/data/companies";

export interface SearchDoc {
  id: string;
  entityId: string;
  locale: "en" | "es";
  langBadge: "EN" | "ES";
  type: "project" | "post" | "experience" | "service";
  category: string;
  title: string;
  description: string;
  meta: string;
  tags: string[];
  keywords: string[];
  url: string;
}

export async function getBilingualSearchDocuments(
  preferredLocale: "en" | "es" = "en",
): Promise<SearchDoc[]> {
  const [
    enProjects,
    esProjects,
    enExperience,
    esExperience,
    enPosts,
    esPosts,
    enServices,
    esServices,
  ] = await Promise.all([
    getCollection("projects", ({ data }) => data.locale === "en"),
    getCollection("projects", ({ data }) => data.locale === "es"),
    getCollection("experience", ({ data }) => data.locale === "en"),
    getCollection("experience", ({ data }) => data.locale === "es"),
    getCollection("posts", ({ data }) => data.locale === "en" && !data.draft),
    getCollection("posts", ({ data }) => data.locale === "es" && !data.draft),
    getCollection("services", ({ data }) => data.locale === "en"),
    getCollection("services", ({ data }) => data.locale === "es"),
  ]);

  // English Documents (Priority 1: Ranked First)
  const enDocuments: SearchDoc[] = [
    ...enProjects.map((p) => {
      const slug = p.id.replace(/^en\//, "").replace(/\.md$/, "");
      const keywords = p.data.searchKeywords || [];
      return {
        id: `project-en-${slug}`,
        entityId: `project-${slug}`,
        locale: "en" as const,
        langBadge: "EN" as const,
        type: "project" as const,
        category: "Project & Architecture",
        title: p.data.title,
        description: p.data.description,
        meta: p.data.company ?? p.data.role,
        tags: p.data.techStack,
        keywords,
        url: `/projects/${slug}`,
      };
    }),
    ...enPosts.map((post) => {
      const slug = post.id.replace(/^en\//, "").replace(/\.(md|mdx)$/, "");
      const keywords = post.data.searchKeywords || [];
      return {
        id: `post-en-${slug}`,
        entityId: `post-${slug}`,
        locale: "en" as const,
        langBadge: "EN" as const,
        type: "post" as const,
        category: "Technical Essay",
        title: post.data.title,
        description: post.data.description,
        meta: post.data.category,
        tags: post.data.tags,
        keywords,
        url: `/blog/${slug}`,
      };
    }),
    ...enExperience.map((exp, idx) => {
      const slug = exp.id.replace(/^en\//, "").replace(/\.md$/, "");
      const compInfo = getCompanyInfo(exp.data.company, {
        industry: exp.data.companyIndustry,
        description: exp.data.companyDescription,
        domain: exp.data.companyDomain,
        url: exp.data.companyUrl,
      });
      const keywords = exp.data.searchKeywords || [];
      return {
        id: `exp-en-${slug || idx}`,
        entityId: `exp-${slug || idx}`,
        locale: "en" as const,
        langBadge: "EN" as const,
        type: "experience" as const,
        category: "Career & Milestones",
        title: `${exp.data.role} @ ${exp.data.company}`,
        description: `${exp.data.companyDescription || compInfo.description} ${exp.data.keyAchievements.join(" ")}`,
        meta: `${exp.data.company} • ${exp.data.companyIndustry || compInfo.industry}`,
        tags: exp.data.skills,
        keywords,
        url: `/experience/${slug}`,
      };
    }),
    ...enServices.map((s) => {
      const slug = s.id.replace(/^en\//, "").replace(/\.(md|mdx)$/, "");
      const keywords = s.data.searchKeywords || [];
      return {
        id: `service-en-${slug}`,
        entityId: `service-${slug}`,
        locale: "en" as const,
        langBadge: "EN" as const,
        type: "service" as const,
        category: "Store & Services",
        title: s.data.title,
        description: `${s.data.description} ${s.data.deliverables.join(" ")}`,
        meta: s.data.price || s.data.type,
        tags: s.data.tags,
        keywords,
        url: `/services/${slug}`,
      };
    }),
  ];

  // Spanish Documents (Priority 2: Ranked after English)
  const esDocuments: SearchDoc[] = [
    ...esProjects.map((p) => {
      const slug = p.id.replace(/^es\//, "").replace(/\.md$/, "");
      const keywords = p.data.searchKeywords || [];
      return {
        id: `project-es-${slug}`,
        entityId: `project-${slug}`,
        locale: "es" as const,
        langBadge: "ES" as const,
        type: "project" as const,
        category: "Proyecto / Arquitectura",
        title: p.data.title,
        description: p.data.description,
        meta: p.data.company ?? p.data.role,
        tags: p.data.techStack,
        keywords,
        url: `/es/projects/${slug}`,
      };
    }),
    ...esPosts.map((post) => {
      const slug = post.id.replace(/^es\//, "").replace(/\.(md|mdx)$/, "");
      const keywords = post.data.searchKeywords || [];
      return {
        id: `post-es-${slug}`,
        entityId: `post-${slug}`,
        locale: "es" as const,
        langBadge: "ES" as const,
        type: "post" as const,
        category: "Ensayo Técnico",
        title: post.data.title,
        description: post.data.description,
        meta: post.data.category,
        tags: post.data.tags,
        keywords,
        url: `/es/blog/${slug}`,
      };
    }),
    ...esExperience.map((exp, idx) => {
      const slug = exp.id.replace(/^es\//, "").replace(/\.md$/, "");
      const compInfo = getCompanyInfo(exp.data.company, {
        industry: exp.data.companyIndustry,
        industryEs: exp.data.companyIndustry,
        description: exp.data.companyDescription,
        descriptionEs: exp.data.companyDescription,
        domain: exp.data.companyDomain,
        url: exp.data.companyUrl,
      });
      const keywords = exp.data.searchKeywords || [];
      return {
        id: `exp-es-${slug || idx}`,
        entityId: `exp-${slug || idx}`,
        locale: "es" as const,
        langBadge: "ES" as const,
        type: "experience" as const,
        category: "Trayectoria Profesional",
        title: `${exp.data.role} @ ${exp.data.company}`,
        description: `${exp.data.companyDescription || compInfo.descriptionEs || compInfo.description} ${exp.data.keyAchievements.join(" ")}`,
        meta: `${exp.data.company} • ${exp.data.companyIndustry || compInfo.industryEs || compInfo.industry}`,
        tags: exp.data.skills,
        keywords,
        url: `/es/experience/${slug}`,
      };
    }),
    ...esServices.map((s) => {
      const slug = s.id.replace(/^es\//, "").replace(/\.(md|mdx)$/, "");
      const keywords = s.data.searchKeywords || [];
      return {
        id: `service-es-${slug}`,
        entityId: `service-${slug}`,
        locale: "es" as const,
        langBadge: "ES" as const,
        type: "service" as const,
        category: "Tienda & Servicios",
        title: s.data.title,
        description: `${s.data.description} ${s.data.deliverables.join(" ")}`,
        meta: s.data.price || s.data.type,
        tags: s.data.tags,
        keywords,
        url: `/es/services/${slug}`,
      };
    }),
  ];

  // Prioritize documents corresponding to preferred locale
  return preferredLocale === "es"
    ? [...esDocuments, ...enDocuments]
    : [...enDocuments, ...esDocuments];
}
