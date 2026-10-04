import type { IContentSourceProvider, PostEntity } from "./repository";
import { getCollection } from "astro:content";

export class LocalFilesystemProvider implements IContentSourceProvider {
  async fetchPosts(locale?: string): Promise<PostEntity[]> {
    const rawPosts = await getCollection("posts");
    return rawPosts
      .filter((post) => {
        const [postLocale] = post.id.split("/");
        return locale ? postLocale === locale : true;
      })
      .map((post) => {
        const parts = post.id.split("/");
        const postLocale = parts[0] ?? "en";
        const slug = parts.slice(1).join("/") || post.id;
        return {
          id: post.id,
          slug,
          locale: postLocale,
          title: post.data.title,
          description: post.data.description,
          publishDate: post.data.pubDate,
          updatedDate: post.data.updatedDate,
          tags: post.data.tags || [],
          content: post.body || "",
        };
      });
  }

  async fetchPostBySlug(
    slug: string,
    locale: string,
  ): Promise<PostEntity | null> {
    const posts = await this.fetchPosts(locale);
    return posts.find((p) => p.slug === slug && p.locale === locale) || null;
  }
}

export class CloudflareR2Provider implements IContentSourceProvider {
  private endpoint: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private bucketName: string;

  constructor(config: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucketName: string;
  }) {
    this.endpoint = config.endpoint;
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.bucketName = config.bucketName;
  }

  async fetchPosts(locale?: string): Promise<PostEntity[]> {
    const indexUrl = `${this.endpoint}/${this.bucketName}/index-${locale || "all"}.json`;
    const response = await fetch(indexUrl, {
      headers: {
        Authorization: `Bearer ${this.secretAccessKey}`,
        "X-Access-Key-Id": this.accessKeyId,
      },
    });

    if (!response.ok) {
      console.warn(
        `[CloudflareR2Provider] Fallback: unable to load remote index from ${indexUrl}`,
      );
      return [];
    }

    return (await response.json()) as PostEntity[];
  }

  async fetchPostBySlug(
    slug: string,
    locale: string,
  ): Promise<PostEntity | null> {
    const rawUrl = `${this.endpoint}/${this.bucketName}/posts/${locale}/${slug}.md`;
    const response = await fetch(rawUrl);
    if (!response.ok) return null;

    const rawText = await response.text();
    return this.parseMarkdownPayload(rawText, slug, locale);
  }

  private parseMarkdownPayload(
    raw: string,
    slug: string,
    locale: string,
  ): PostEntity {
    const parts = raw.split(/^---$/m);
    const body = parts.slice(2).join("---").trim();
    return {
      id: `${locale}/${slug}`,
      slug,
      locale,
      title: slug.replace(/-/g, " "),
      description: "",
      publishDate: new Date(),
      tags: [],
      content: body,
    };
  }
}

export function createContentRepository(): IContentSourceProvider {
  const useRemoteR2 = process.env.ENABLE_R2_CONTENT === "true";
  if (useRemoteR2 && process.env.R2_ENDPOINT && process.env.R2_SECRET_KEY) {
    return new CloudflareR2Provider({
      endpoint: process.env.R2_ENDPOINT,
      accessKeyId: process.env.R2_ACCESS_KEY_ID || "",
      secretAccessKey: process.env.R2_SECRET_KEY,
      bucketName: process.env.R2_BUCKET_NAME || "arturonava-content",
    });
  }
  return new LocalFilesystemProvider();
}
