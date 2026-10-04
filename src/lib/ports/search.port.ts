export interface SearchQuery {
  query: string;
  locale: string;
  limit?: number | undefined;
  threshold?: number | undefined;
}

export interface SearchResultItem {
  id: string;
  title: string;
  description: string;
  url: string;
  locale: string;
  score: number;
}

export interface SearchEnginePort {
  search(params: SearchQuery): Promise<SearchResultItem[]>;
  indexDocument(item: SearchResultItem, content: string): Promise<void>;
}
