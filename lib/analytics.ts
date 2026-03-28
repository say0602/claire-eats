export type AnalyticsEventName = "search_submitted" | "map_open_clicked" | "results_view_closed";

type AnalyticsEventBase = {
  session_id: string;
  ts: string;
};

export type SearchSubmittedEvent = AnalyticsEventBase & {
  event: "search_submitted";
  city: string;
};

export type MapOpenClickedEvent = AnalyticsEventBase & {
  event: "map_open_clicked";
  restaurant_id: string;
  city: string;
  sort_key: string;
  rank: number;
};

export type ResultsViewClosedEvent = AnalyticsEventBase & {
  event: "results_view_closed";
  city: string;
  dwell_ms: number;
};

export type AnalyticsEvent = SearchSubmittedEvent | MapOpenClickedEvent | ResultsViewClosedEvent;

function timestamp() {
  return new Date().toISOString();
}

export function createSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `session-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function buildSearchSubmittedEvent(city: string, sessionId: string): SearchSubmittedEvent {
  return {
    event: "search_submitted",
    city,
    session_id: sessionId,
    ts: timestamp(),
  };
}

export function buildMapOpenClickedEvent(params: {
  restaurantId: string;
  city: string;
  sortKey: string;
  rank: number;
  sessionId: string;
}): MapOpenClickedEvent {
  return {
    event: "map_open_clicked",
    restaurant_id: params.restaurantId,
    city: params.city,
    sort_key: params.sortKey,
    rank: params.rank,
    session_id: params.sessionId,
    ts: timestamp(),
  };
}

export function buildResultsViewClosedEvent(params: {
  city: string;
  dwellMs: number;
  sessionId: string;
}): ResultsViewClosedEvent {
  return {
    event: "results_view_closed",
    city: params.city,
    dwell_ms: params.dwellMs,
    session_id: params.sessionId,
    ts: timestamp(),
  };
}

export async function emitAnalyticsEvent(event: AnalyticsEvent) {
  try {
    await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(event),
      keepalive: true,
    });
  } catch {
    // Analytics is best-effort and must never block UX.
  }
}
