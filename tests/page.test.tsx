import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Home from "../app/page";

const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = ORIGINAL_FETCH;
});

describe("Home page search flow", () => {
  it("shows search results sorted by Yelp reviews by default", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        city: "San Francisco",
        warnings: [],
        restaurants: [
          {
            id: "r-low",
            name: "Low Reviews",
            city: "San Francisco",
            yelp: {
              rating: 4.8,
              review_count: 50,
              price: "$$",
              categories: ["Sushi"],
              lat: 37.77,
              lng: -122.42,
            },
            google: {
              rating: 4.6,
              review_count: 500,
              place_id: "place-low",
              maps_url: "https://www.google.com/maps/place/?q=place_id:place-low",
            },
            michelin: { award: null, green_star: false, matched: false },
            combined_score: null,
          },
          {
            id: "r-high",
            name: "High Reviews",
            city: "San Francisco",
            yelp: {
              rating: 4.1,
              review_count: 200,
              price: "$",
              categories: ["Burgers"],
              lat: 37.78,
              lng: -122.41,
            },
            google: {
              rating: 4.2,
              review_count: 200,
              place_id: "place-high",
              maps_url: "https://www.google.com/maps/place/?q=place_id:place-high",
            },
            michelin: { award: null, green_star: false, matched: false },
            combined_score: null,
          },
        ],
      }),
    );
    global.fetch = fetchMock as typeof fetch;

    render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "San Francisco" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("High Reviews")).toBeInTheDocument());

    const high = screen.getByText("High Reviews");
    const low = screen.getByText("Low Reviews");
    const relation = high.compareDocumentPosition(low);

    expect((relation & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
  });

  it("shows a clear error on malformed success payloads", async () => {
    global.fetch = vi.fn(async () => Response.json({ city: "San Francisco" })) as typeof fetch;

    render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "San Francisco" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() =>
      expect(screen.getByText("Search response format is invalid.")).toBeInTheDocument(),
    );
  });

  it("shows API error message when search returns failure envelope", async () => {
    global.fetch = vi.fn(async () =>
      new Response(
        JSON.stringify({
          city: "San Francisco",
          restaurants: [],
          warnings: [],
          error: { code: "YELP_UPSTREAM_ERROR", message: "Failed to fetch Yelp restaurants." },
        }),
        { status: 502, headers: { "content-type": "application/json" } },
      ),
    ) as typeof fetch;

    render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "San Francisco" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() =>
      expect(screen.getByText("Failed to fetch Yelp restaurants.")).toBeInTheDocument(),
    );
  });

  it("shows empty-results message when no restaurants are returned", async () => {
    global.fetch = vi.fn(async () =>
      Response.json({
        city: "San Francisco",
        warnings: [],
        restaurants: [],
      }),
    ) as typeof fetch;

    render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "San Francisco" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() =>
      expect(screen.getByText("No Yelp restaurants found for San Francisco.")).toBeInTheDocument(),
    );
  });

  it("renders warning banner when partial enrichment warnings exist", async () => {
    global.fetch = vi.fn(async () =>
      Response.json({
        city: "San Francisco",
        warnings: [
          { code: "GOOGLE_TIMEOUT", message: "One or more Google enrichment calls timed out." },
        ],
        restaurants: [
          {
            id: "r1",
            name: "Warning Row",
            city: "San Francisco",
            yelp: {
              rating: 4.0,
              review_count: 100,
              price: "$$",
              categories: ["Test"],
              lat: 37.77,
              lng: -122.42,
            },
            google: {
              rating: null,
              review_count: null,
              place_id: null,
              maps_url: null,
            },
            michelin: { award: null, green_star: false, matched: false },
            combined_score: null,
          },
        ],
      }),
    ) as typeof fetch;

    render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "San Francisco" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() =>
      expect(screen.getByText("Partial enrichment warnings")).toBeInTheDocument(),
    );
    expect(screen.getByText("One or more Google enrichment calls timed out.")).toBeInTheDocument();
  });

  it("shows generic error when fetch throws a network error", async () => {
    global.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Tokyo" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() =>
      expect(screen.getByText("Unable to complete search. Please try again.")).toBeInTheDocument(),
    );
  });

  it("allows switching sort key after results load", async () => {
    global.fetch = vi.fn(async () =>
      Response.json({
        city: "Tokyo",
        warnings: [],
        restaurants: [
          {
            id: "r-a",
            name: "High Rating Low Reviews",
            city: "Tokyo",
            yelp: { rating: 4.9, review_count: 30, price: "$", categories: [], lat: 35.68, lng: 139.76 },
            google: { rating: null, review_count: null, place_id: null, maps_url: null },
            michelin: { award: null, green_star: false, matched: false },
            combined_score: null,
          },
          {
            id: "r-b",
            name: "Low Rating High Reviews",
            city: "Tokyo",
            yelp: { rating: 3.5, review_count: 500, price: "$$", categories: [], lat: 35.69, lng: 139.77 },
            google: { rating: null, review_count: null, place_id: null, maps_url: null },
            michelin: { award: null, green_star: false, matched: false },
            combined_score: null,
          },
        ],
      }),
    ) as typeof fetch;

    render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Tokyo" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("Low Rating High Reviews")).toBeInTheDocument());

    const first = screen.getByText("Low Rating High Reviews");
    const second = screen.getByText("High Rating Low Reviews");
    expect((first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);

    fireEvent.click(screen.getByText("Yelp Rating"));

    const reorderedFirst = screen.getByText("High Rating Low Reviews");
    const reorderedSecond = screen.getByText("Low Rating High Reviews");
    expect((reorderedFirst.compareDocumentPosition(reorderedSecond) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
  });
});
