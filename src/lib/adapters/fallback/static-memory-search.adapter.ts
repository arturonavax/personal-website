import type {
  SearchEnginePort,
  SearchQuery,
  SearchResultItem,
} from "../../ports/search.port";

export class StaticMemorySearchAdapter implements SearchEnginePort {
  constructor(
    private readonly documents: Array<
      SearchResultItem & { content: string }
    > = [],
  ) {}

  async search(params: SearchQuery): Promise<SearchResultItem[]> {
    const tokens = params.query.toLowerCase().split(/\s+/).filter(Boolean);
    const matched = this.documents
      .filter((doc) => doc.locale === params.locale)
      .map((doc) => {
        const text =
          `${doc.title} ${doc.description} ${doc.content}`.toLowerCase();
        let hits = 0;
        for (const token of tokens) {
          if (text.includes(token)) hits++;
        }
        const score = tokens.length > 0 ? hits / tokens.length : 0;
        return { ...doc, score };
      })
      .filter((doc) => doc.score > (params.threshold || 0.1))
      .sort((a, b) => b.score - a.score)
      .slice(0, params.limit || 8);

    return matched.map(({ content, ...rest }) => rest);
  }

  async indexDocument(item: SearchResultItem, content: string): Promise<void> {
    this.documents.push({ ...item, content });
  }
}
