import type {
  SearchEnginePort,
  SearchQuery,
  SearchResultItem,
} from "../../ports/search.port";

export interface CloudflareAiBinding {
  run(
    model: string,
    input: { text: string[] | string },
  ): Promise<{ data: number[][] }>;
}

export interface CloudflareVectorizeBinding {
  query(
    vector: number[],
    options?: {
      topK?: number;
      returnMetadata?: boolean;
      filter?: Record<string, string>;
    },
  ): Promise<{
    matches: Array<{
      id: string;
      score: number;
      metadata?: Record<string, unknown>;
    }>;
  }>;
  insert(
    vectors: Array<{
      id: string;
      values: number[];
      metadata?: Record<string, unknown>;
    }>,
  ): Promise<unknown>;
}

export class CloudflareVectorizeSearchAdapter implements SearchEnginePort {
  constructor(
    private readonly ai: CloudflareAiBinding,
    private readonly vectorize: CloudflareVectorizeBinding,
  ) {}

  async search(params: SearchQuery): Promise<SearchResultItem[]> {
    const embeddingResponse = await this.ai.run("@cf/baai/bge-small-en-v1.5", {
      text: params.query,
    });

    const vector = embeddingResponse.data?.[0];
    if (!vector) {
      return [];
    }

    const results = await this.vectorize.query(vector, {
      topK: params.limit || 8,
      returnMetadata: true,
      filter: { locale: params.locale },
    });

    return results.matches
      .filter((match) =>
        params.threshold !== undefined ? match.score >= params.threshold : true,
      )
      .map((match) => ({
        id: match.id,
        title: String(match.metadata?.title || ""),
        description: String(match.metadata?.description || ""),
        url: String(match.metadata?.url || ""),
        locale: String(match.metadata?.locale || "en"),
        score: match.score,
      }));
  }

  async indexDocument(item: SearchResultItem, content: string): Promise<void> {
    const textToEmbed = `${item.title}\n${item.description}\n${content.slice(0, 2000)}`;
    const embeddingResponse = await this.ai.run("@cf/baai/bge-small-en-v1.5", {
      text: textToEmbed,
    });

    const vector = embeddingResponse.data?.[0];
    if (!vector) {
      return;
    }

    await this.vectorize.insert([
      {
        id: item.id,
        values: vector,
        metadata: {
          title: item.title,
          description: item.description,
          url: item.url,
          locale: item.locale,
        },
      },
    ]);
  }
}
