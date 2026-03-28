import { afterEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import Home from "../app/page";

const ORIGINAL_FETCH = global.fetch;

afterEach(() => {
  vi.restoreAllMocks();
  global.fetch = ORIGINAL_FETCH;
});

function makeSearchPayload(restaurants: Record<string, unknown>[]) {
  return {
    city: "San Francisco",
    warnings: [],
    restaurants,
  };
}

function makeRestaurantFixture(id: string, name: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name,
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
    ...overrides,
  };
}

describe("Home page search flow", () => {
  it("shows city suggestions to guide valid input", () => {
    render(<Home />);

    const cityInput = screen.getByLabelText("City");
    fireEvent.focus(cityInput);
    fireEvent.change(cityInput, { target: { value: "san" } });

    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "San Francisco, CA" })).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByText("San Francisco, CA"));
    expect(screen.getByLabelText("City")).toHaveValue("San Francisco, CA");
  });

  it("shows search results sorted by Yelp reviews by default", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        makeSearchPayload([
          makeRestaurantFixture("r-low", "Lower Reviews", {
            yelp: { rating: 4.7, review_count: 120, price: "$$", categories: ["Test"], lat: 37.77, lng: -122.42 },
            combined_score: 9.4,
          }),
          makeRestaurantFixture("r-high", "Higher Reviews", {
            yelp: { rating: 4.1, review_count: 600, price: "$$", categories: ["Test"], lat: 37.77, lng: -122.42 },
            combined_score: 6.2,
          }),
        ]),
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "San Francisco" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("Higher Reviews")).toBeInTheDocument());

    const high = screen.getByText("Higher Reviews");
    const low = screen.getByText("Lower Reviews");
    expect((high.compareDocumentPosition(low) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
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
      expect(screen.getByText(/No restaurants found for San Francisco/)).toBeInTheDocument(),
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
          makeRestaurantFixture("r1", "Warning Row"),
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
      Response.json(
        makeSearchPayload([
          makeRestaurantFixture("r-a", "High Rating Low Reviews", {
            yelp: { rating: 4.9, review_count: 30, price: "$", categories: [], lat: 35.68, lng: 139.76 },
            combined_score: 5.0,
          }),
          makeRestaurantFixture("r-b", "Low Rating High Reviews", {
            yelp: { rating: 3.5, review_count: 500, price: "$$", categories: [], lat: 35.69, lng: 139.77 },
            combined_score: 7.0,
          }),
        ]),
      ),
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

  it("allows switching sort key to Google Rating", async () => {
    global.fetch = vi.fn(async () =>
      Response.json(
        makeSearchPayload([
          makeRestaurantFixture("g-a", "Lower Google Rating", {
            google: { rating: 4.1, review_count: 500, place_id: "g-a", maps_url: "https://maps.google.com/g-a" },
            yelp: { rating: 4.0, review_count: 220, price: "$$", categories: [], lat: 37.7, lng: -122.4 },
            combined_score: 7.1,
          }),
          makeRestaurantFixture("g-b", "Higher Google Rating", {
            google: { rating: 4.8, review_count: 200, place_id: "g-b", maps_url: "https://maps.google.com/g-b" },
            yelp: { rating: 4.0, review_count: 210, price: "$$", categories: [], lat: 37.7, lng: -122.4 },
            combined_score: 7.0,
          }),
        ]),
      ),
    ) as typeof fetch;

    render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Tokyo" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("Higher Google Rating")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Google Rating"));

    const first = screen.getByText("Higher Google Rating");
    const second = screen.getByText("Lower Google Rating");
    expect((first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0).toBe(true);
  });

  it("renders all returned results without pagination controls", async () => {
    const restaurants = Array.from({ length: 51 }, (_, index) =>
      makeRestaurantFixture(`r-${index + 1}`, `Restaurant ${index + 1}`, {
        yelp: {
          rating: 4.0,
          review_count: 1000 - index,
          price: "$$",
          categories: [],
          lat: 37.77,
          lng: -122.42,
        },
        combined_score: 7.0,
      }),
    );

    global.fetch = vi.fn(async () => Response.json(makeSearchPayload(restaurants))) as typeof fetch;

    render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "San Francisco" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("Restaurant 1")).toBeInTheDocument());
    expect(screen.getByText("Restaurant 51")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Next" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Previous" })).not.toBeInTheDocument();
  });

  it("renders score pills when data is present", async () => {
    global.fetch = vi.fn(async () =>
      Response.json(
        makeSearchPayload([
          makeRestaurantFixture("r-high", "High Score Place", {
            combined_score: 9.1,
          }),
          makeRestaurantFixture("r-mid", "Mid Score Place", {
            combined_score: 7.1,
          }),
          makeRestaurantFixture("r-low", "Low Score Place", {
            combined_score: 6.4,
          }),
        ]),
      ),
    ) as typeof fetch;

    render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Paris" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("High Score Place")).toBeInTheDocument());

    expect(screen.getByText("9.1")).toBeInTheDocument();
    expect(screen.getByText("6.4")).toBeInTheDocument();
  });

  it("shows google-only banner when response has google_only flag", async () => {
    global.fetch = vi.fn(async () =>
      Response.json({
        city: "Seoul",
        warnings: [],
        restaurants: [
          makeRestaurantFixture("g1", "Google Only Place", {
            google: { rating: 4.3, review_count: 500, place_id: "p1", maps_url: "https://maps.google.com/p1" },
            combined_score: 7.5,
          }),
        ],
        google_only: true,
      }),
    ) as typeof fetch;

    render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Seoul" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("Google Only Place")).toBeInTheDocument());
    expect(screen.getByText("Limited Yelp coverage")).toBeInTheDocument();
    expect(screen.getByText(/Yelp has limited coverage for Seoul/)).toBeInTheDocument();
  });

  it("shows dash for yelp fields in google-only mode", async () => {
    global.fetch = vi.fn(async () =>
      Response.json({
        city: "Seoul",
        warnings: [],
        restaurants: [
          makeRestaurantFixture("g1", "Google Fallback Row", {
            yelp: { rating: 0, review_count: 0, price: null, categories: ["Korean"], lat: 37.56, lng: 126.97 },
            google: { rating: 4.5, review_count: 800, place_id: "p2", maps_url: "https://maps.google.com/p2" },
            combined_score: 8.0,
          }),
        ],
        google_only: true,
      }),
    ) as typeof fetch;

    render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Seoul" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("Google Fallback Row")).toBeInTheDocument());

    const row = screen.getByText("Google Fallback Row").closest("tr");
    expect(row).not.toBeNull();
    const cells = row!.querySelectorAll("td");
    const yelpRatingCell = cells[3];
    const yelpReviewsCell = cells[4];
    const priceCell = cells[7];
    expect(yelpRatingCell.textContent).toBe("-");
    expect(yelpReviewsCell.textContent).toBe("-");
    expect(priceCell.textContent).toBe("-");
  });

  it("renders dash placeholder for null combined score", async () => {
    global.fetch = vi.fn(async () =>
      Response.json(
        makeSearchPayload([
          makeRestaurantFixture("r-no-score", "No Score Place", {
            combined_score: null,
          }),
        ]),
      ),
    ) as typeof fetch;

    render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Paris" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("No Score Place")).toBeInTheDocument());

    const row = screen.getByText("No Score Place").closest("tr");
    expect(row).not.toBeNull();
    const cells = row!.querySelectorAll("td");
    const scoreCell = cells[2];
    expect(scoreCell.textContent).toBe("-");
  });

  it("emits analytics for search submit and map open click", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/search") {
        return Response.json(
          makeSearchPayload([
            makeRestaurantFixture("r-map", "Map Place", {
              city: "Seoul",
              google: {
                rating: 4.5,
                review_count: 1000,
                place_id: "map-place-id",
                maps_url: "https://maps.google.com/map-place-id",
              },
              combined_score: 8.1,
            }),
          ]),
        );
      }

      if (url === "/api/events") {
        return Response.json({ ok: true, echoed: init?.body ? JSON.parse(String(init.body)) : null });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Seoul" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("Map Place")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("link", { name: "Open" }));

    await waitFor(() => {
      const eventCalls = fetchMock.mock.calls.filter(([arg]) => String(arg) === "/api/events");
      expect(eventCalls.length).toBeGreaterThanOrEqual(2);
    });

    const eventPayloads = fetchMock.mock.calls
      .filter(([arg]) => String(arg) === "/api/events")
      .map(([, init]) => JSON.parse(String(init?.body)));

    expect(eventPayloads.some((payload) => payload.event === "search_submitted" && payload.city === "Seoul")).toBe(true);
    expect(
      eventPayloads.some(
        (payload) =>
          payload.event === "map_open_clicked" &&
          payload.restaurant_id === "r-map" &&
          payload.city === "Seoul" &&
          payload.rank === 1,
      ),
    ).toBe(true);
  });

  it("emits results_view_closed when a new search replaces active results", async () => {
    let searchCall = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/search") {
        searchCall += 1;
        if (searchCall === 1) {
          return Response.json({
            city: "Seoul",
            warnings: [],
            restaurants: [makeRestaurantFixture("r-1", "First Result", { city: "Seoul", combined_score: 7.1 })],
          });
        }
        return Response.json({
          city: "Tokyo",
          warnings: [],
          restaurants: [makeRestaurantFixture("r-2", "Second Result", { city: "Tokyo", combined_score: 7.9 })],
        });
      }

      if (url === "/api/events") {
        return Response.json({ ok: true, echoed: init?.body ? JSON.parse(String(init.body)) : null });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    render(<Home />);

    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Seoul" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText("First Result")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Tokyo" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText("Second Result")).toBeInTheDocument());

    await waitFor(() => {
      const eventPayloads = fetchMock.mock.calls
        .filter(([arg]) => String(arg) === "/api/events")
        .map(([, requestInit]) => JSON.parse(String(requestInit?.body)));
      expect(eventPayloads.some((payload) => payload.event === "results_view_closed" && payload.city === "Seoul")).toBe(true);
    });
  });

  it("emits results_view_closed on page unmount with active results", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url === "/api/search") {
        return Response.json({
          city: "Busan",
          warnings: [],
          restaurants: [makeRestaurantFixture("r-busan", "Busan Spot", { city: "Busan", combined_score: 8.0 })],
        });
      }

      if (url === "/api/events") {
        return Response.json({ ok: true, echoed: init?.body ? JSON.parse(String(init.body)) : null });
      }

      throw new Error(`Unexpected fetch target: ${url}`);
    });
    global.fetch = fetchMock as typeof fetch;

    const { unmount } = render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "Busan" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    await waitFor(() => expect(screen.getByText("Busan Spot")).toBeInTheDocument());

    unmount();

    await waitFor(() => {
      const eventPayloads = fetchMock.mock.calls
        .filter(([arg]) => String(arg) === "/api/events")
        .map(([, requestInit]) => JSON.parse(String(requestInit?.body)));
      expect(eventPayloads.some((payload) => payload.event === "results_view_closed" && payload.city === "Busan")).toBe(true);
    });
  });

});
