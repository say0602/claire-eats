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

  it("shows search results sorted by combined score by default", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json(
        makeSearchPayload([
          makeRestaurantFixture("r-low", "Low Score", { combined_score: 3.5 }),
          makeRestaurantFixture("r-high", "High Score", { combined_score: 8.2 }),
        ]),
      ),
    );
    global.fetch = fetchMock as typeof fetch;

    render(<Home />);
    fireEvent.change(screen.getByLabelText("City"), { target: { value: "San Francisco" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await waitFor(() => expect(screen.getByText("High Score")).toBeInTheDocument());

    const high = screen.getByText("High Score");
    const low = screen.getByText("Low Score");
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
});
