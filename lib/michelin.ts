export type MichelinAward = "1 Star" | "2 Stars" | "3 Stars" | "Bib Gourmand";

export type MichelinMatch = {
  award: MichelinAward | null;
  green_star: boolean;
  matched: boolean;
};

export const EMPTY_MICHELIN_MATCH: MichelinMatch = {
  award: null,
  green_star: false,
  matched: false,
};
