import { defineCollection } from "astro:content";
import { z } from "astro/zod";
import { glob } from "astro/loaders";

const posts = defineCollection({
  loader: glob({
    pattern: ["**/*.{md,mdx}", "!**/_*"],
    base: "./src/content/posts",
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string().max(75, "SEO title under 75 chars"),
      description: z.string().max(160, "Meta description under 160 chars"),
      pubDate: z.coerce.date(),
      updatedDate: z.coerce.date().optional(),
      draft: z.boolean().default(false),
      locale: z.enum(["en", "es"]),
      translationKey: z.string(),
      category: z.string().default("systems"),
      tags: z.array(z.string()).min(1),
      coverImage: image().optional(),
      coverAlt: z.string().optional(),
      canonicalUrl: z.url().optional(),
      searchKeywords: z.array(z.string()).optional(),
    }),
});

const projects = defineCollection({
  loader: glob({
    pattern: ["**/*.md", "!**/_*"],
    base: "./src/content/projects",
  }),
  schema: ({ image }) =>
    z.object({
      title: z.string(),
      description: z.string(),
      role: z.string(),
      company: z.string().optional(),
      featured: z.boolean().default(false),
      order: z.number().int(),
      locale: z.enum(["en", "es"]),
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
  schema: z.object({
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
    locale: z.enum(["en", "es"]),
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
    z.object({
      title: z.string(),
      description: z.string(),
      type: z.enum(["service", "product", "mentorship"]),
      locale: z.enum(["en", "es"]),
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

export const collections = { posts, projects, experience, services };
