export interface PostEntity {
  id: string;
  slug: string;
  locale: string;
  title: string;
  description: string;
  publishDate: Date;
  updatedDate?: Date | undefined;
  tags: string[];
  content: string;
}

export interface IContentSourceProvider {
  fetchPosts(locale?: string): Promise<PostEntity[]>;
  fetchPostBySlug(slug: string, locale: string): Promise<PostEntity | null>;
}
