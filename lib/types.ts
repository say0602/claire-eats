export type MichelinAward = "1 Star" | "2 Stars" | "3 Stars" | "Bib Gourmand" | "Michelin Guide";
export type YelpPriceTier = "$" | "$$" | "$$$" | "$$$$";

export type Restaurant = {
  id: string;
  name: string;
  city: string;
  yelp: {
    rating: number;
    review_count: number;
    price: YelpPriceTier | null;
    categories: string[];
    lat: number;
    lng: number;
  };
  google: {
    rating: number | null;
    review_count: number | null;
    place_id: string | null;
    maps_url: string | null;
  };
  michelin: {
    award: MichelinAward | null;
    green_star: boolean;
    matched: boolean;
  };
  combined_score: number | null;
};

export type WarningCode =
  | "GOOGLE_TIMEOUT"
  | "GOOGLE_RATE_LIMITED"
  | "GOOGLE_UPSTREAM_ERROR"
  | "PARTIAL_ENRICHMENT";

export type SearchWarning = {
  code: WarningCode;
  message: string;
};

export type SearchResponseSuccess = {
  city: string;
  restaurants: Restaurant[];
  warnings: SearchWarning[];
};

export type SearchResponseFailure = {
  city: string;
  restaurants: [];
  warnings: SearchWarning[];
  error: {
    code: string;
    message: string;
  };
};

export type SearchResponse = SearchResponseSuccess | SearchResponseFailure;
