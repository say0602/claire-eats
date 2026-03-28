import { afterEach, describe, expect, it, vi } from "vitest";
import { POST as eventsPost } from "../app/api/events/route";

const ORIGINAL_ENV = { ...process.env };

afterEach(() => {
  vi.restoreAllMocks();
  process.env = { ...ORIGINAL_ENV };
});

describe("events route", () => {
  it("accepts search_submitted events", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const request = new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({
        event: "search_submitted",
        city: "Seoul",
        session_id: "session-1",
        ts: new Date().toISOString(),
      }),
    });

    const response = await eventsPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(infoSpy).toHaveBeenCalledTimes(1);
  });

  it("accepts map_open_clicked events", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});

    const request = new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({
        event: "map_open_clicked",
        restaurant_id: "r-1",
        city: "Seoul",
        sort_key: "combined_score",
        rank: 3,
        session_id: "session-1",
        ts: new Date().toISOString(),
      }),
    });

    const response = await eventsPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
  });

  it("accepts results_view_closed events", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});

    const request = new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({
        event: "results_view_closed",
        city: "Seoul",
        dwell_ms: 2500,
        session_id: "session-1",
        ts: new Date().toISOString(),
      }),
    });

    const response = await eventsPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
  });

  it("returns INVALID_INPUT for malformed payloads", async () => {
    const request = new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({
        event: "map_open_clicked",
        city: "Seoul",
        session_id: "session-1",
        ts: "not-a-date",
      }),
    });

    const response = await eventsPost(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT for non-JSON body", async () => {
    const request = new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: "{bad-json",
    });

    const response = await eventsPost(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_INPUT");
  });

  it("returns INVALID_INPUT for unknown event name", async () => {
    const request = new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({
        event: "unknown_event",
        city: "Seoul",
        session_id: "session-1",
        ts: new Date().toISOString(),
      }),
    });

    const response = await eventsPost(request);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload.error.code).toBe("INVALID_INPUT");
  });

  it("returns FORBIDDEN for cross-origin requests", async () => {
    const request = new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://evil.example" },
      body: JSON.stringify({
        event: "search_submitted",
        city: "Seoul",
        session_id: "session-1",
        ts: new Date().toISOString(),
      }),
    });

    const response = await eventsPost(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("FORBIDDEN");
  });

  it("accepts trusted internal requests with analytics key and no origin headers", async () => {
    process.env.ANALYTICS_INTERNAL_KEY = "test-analytics-key";
    vi.spyOn(console, "info").mockImplementation(() => {});

    const request = new Request("http://localhost/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-analytics-key": "test-analytics-key",
      },
      body: JSON.stringify({
        event: "search_submitted",
        city: "Osaka",
        session_id: "server-session-1",
        ts: new Date().toISOString(),
      }),
    });

    const response = await eventsPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
  });

  it("rejects internal requests with wrong analytics key", async () => {
    process.env.ANALYTICS_INTERNAL_KEY = "test-analytics-key";

    const request = new Request("http://localhost/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-analytics-key": "wrong-key",
      },
      body: JSON.stringify({
        event: "search_submitted",
        city: "Osaka",
        session_id: "server-session-1",
        ts: new Date().toISOString(),
      }),
    });

    const response = await eventsPost(request);
    const payload = await response.json();

    expect(response.status).toBe(403);
    expect(payload.error.code).toBe("FORBIDDEN");
  });

  it("accepts same-origin requests when only referer is present", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});

    const request = new Request("http://localhost/api/events", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        referer: "http://localhost/some-page",
      },
      body: JSON.stringify({
        event: "results_view_closed",
        city: "Seoul",
        dwell_ms: 1200,
        session_id: "session-2",
        ts: new Date().toISOString(),
      }),
    });

    const response = await eventsPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
  });

  it("does not log analytics events in production mode", async () => {
    process.env.NODE_ENV = "production";
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});

    const request = new Request("http://localhost/api/events", {
      method: "POST",
      headers: { "content-type": "application/json", origin: "http://localhost" },
      body: JSON.stringify({
        event: "search_submitted",
        city: "Seoul",
        session_id: "session-1",
        ts: new Date().toISOString(),
      }),
    });

    const response = await eventsPost(request);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.ok).toBe(true);
    expect(infoSpy).not.toHaveBeenCalled();
  });
});
