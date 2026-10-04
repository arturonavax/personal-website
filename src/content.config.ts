import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";
import { SUPPORTED_LOCALES } from "./i18n/locales";

export const localizedBaseSchema = z.object({
  canonicalId: z
    .string()
    .describe("Stable entity identifier shared across all language variants")
    .optional(),
  translationKey: z.string().optional(),
  locale: z.enum(SUPPORTED_LOCALES),
  draft: z.boolean().default(false),
  visible: z.boolean().default(true),
});

export const postCategoryEnum = z.enum([
  "systems",
  "architecture",
  "performance",
  "ai",
  "research",
  "leadership",
  "opinion",
  "notes",
  "general",
  "personal",
]);

export type PostCategory = z.infer<typeof postCategoryEnum>;

const posts = defineCollection({
  loader: glob({
    pattern: ["**/*.{md,mdx}", "!**/_*"],
    base: "./src/content/posts",
  }),
  schema: ({ image }) =>
    localizedBaseSchema.extend({
      title: z.string().max(75, "SEO title under 75 chars"),
      description: z.string().max(160, "Meta description under 160 chars"),
      pubDate: z.coerce.date(),
      publishedAt: z.coerce.date().optional(),
      updatedDate: z.coerce.date().optional(),
      updatedAt: z.coerce.date().optional(),
      translationKey: z.string(),
      category: postCategoryEnum.default("systems"),
      tags: z.array(z.string()).min(1),
      coverImage: image().optional(),
      coverAlt: z.string().optional(),
      canonicalUrl: z.url().optional(),
      searchKeywords: z.array(z.string()).optional(),
      author: z.string().default("Arturo Nava"),
      readingTimeMinutes: z.number().int().positive().optional(),
      searchPriority: z.number().int().default(50),
      postType: z
        .enum(["essay", "note", "article", "opinion"])
        .default("article"),
    }),
});

const projects = defineCollection({
  loader: glob({
    pattern: ["**/*.md", "!**/_*"],
    base: "./src/content/projects",
  }),
  schema: ({ image }) =>
    localizedBaseSchema.extend({
      title: z.string(),
      description: z.string(),
      role: z.string(),
      company: z.string().optional(),
      featured: z.boolean().default(false),
      order: z.number().int(),
      translationKey: z.string(),
      techStack: z.array(z.string()),
      metrics: z
        .array(z.object({ label: z.string(), value: z.string() }))
        .optional(),
      repoUrl: z.url().optional(),
      liveUrl: z.url().optional(),
      thumbnail: image().optional(),
      searchKeywords: z.array(z.string()).optional(),
    }),
});

const experience = defineCollection({
  loader: glob({
    pattern: ["**/*.md", "!**/_*"],
    base: "./src/content/experience",
  }),
  schema: localizedBaseSchema.extend({
    company: z.string(),
    companyUrl: z.url().optional(),
    companyDomain: z.string().optional(),
    companyIndustry: z.string().optional(),
    companyDescription: z.string().optional(),
    role: z.string(),
    location: z.string(),
    employmentType: z.string(),
    startDate: z.coerce.date(),
    endDate: z.coerce.date().optional(),
    order: z.number().int(),
    skills: z.array(z.string()),
    keyAchievements: z.array(z.string()),
    searchKeywords: z.array(z.string()).optional(),
  }),
});

const services = defineCollection({
  loader: glob({
    pattern: ["**/*.{md,mdx}", "!**/_*"],
    base: "./src/content/services",
  }),
  schema: ({ image }) =>
    localizedBaseSchema.extend({
      title: z.string(),
      description: z.string(),
      type: z.enum(["service", "product", "mentorship"]),
      translationKey: z.string(),
      featured: z.boolean().default(false),
      order: z.number().int(),
      price: z.string().optional(),
      deliveryTime: z.string().optional(),
      tags: z.array(z.string()).default([]),
      deliverables: z.array(z.string()).default([]),
      ctaUrl: z.string().optional(),
      ctaText: z.string().optional(),
      thumbnail: image().optional(),
      searchKeywords: z.array(z.string()).optional(),
    }),
});

const resume = defineCollection({
  loader: glob({
    pattern: "ArturoNava-Resume-*.md",
    base: "./src/content/resume",
  }),
  schema: localizedBaseSchema.extend({
    canonicalId: z.string().default("arturo-nava-resume"),
    title: z.string().min(1),
    name: z.string().min(1),
    role: z.string().min(1),
    location: z.string().min(1),
    summary: z.string().min(1),
    updatedDate: z.coerce.date(),
    skills: z.record(z.string(), z.array(z.string())),
    contact: z.object({
      email: z.email(),
      github: z.url(),
      linkedin: z.url(),
      website: z.url(),
    }),
  }),
});

export const collections = { posts, projects, experience, services, resume };
