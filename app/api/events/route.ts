import { NextResponse } from "next/server";
import type { AnalyticsEvent } from "@/lib/analytics";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isIsoTimestamp(value: unknown) {
  if (typeof value !== "string") return false;
  return !Number.isNaN(Date.parse(value));
}

function hasValidInternalAnalyticsKey(request: Request) {
  const configuredKey = process.env.ANALYTICS_INTERNAL_KEY;
  if (!configuredKey) return false;
  const requestKey = request.headers.get("x-analytics-key");
  return requestKey === configuredKey;
}

function isTrustedAnalyticsRequest(request: Request) {
  if (hasValidInternalAnalyticsKey(request)) {
    return true;
  }

  const requestOrigin = new URL(request.url).origin;
  const originHeader = request.headers.get("origin");
  if (originHeader) {
    return originHeader === requestOrigin;
  }

  const refererHeader = request.headers.get("referer");
  if (!refererHeader) return false;
  try {
    return new URL(refererHeader).origin === requestOrigin;
  } catch {
    return false;
  }
}

function isAnalyticsEvent(value: unknown): value is AnalyticsEvent {
  if (!isObject(value)) return false;
  if (typeof value.session_id !== "string" || value.session_id.length === 0) return false;
  if (!isIsoTimestamp(value.ts)) return false;

  if (value.event === "search_submitted") {
    return typeof value.city === "string" && value.city.length > 0;
  }

  if (value.event === "map_open_clicked") {
    return (
      typeof value.restaurant_id === "string" &&
      value.restaurant_id.length > 0 &&
      typeof value.city === "string" &&
      value.city.length > 0 &&
      typeof value.sort_key === "string" &&
      value.sort_key.length > 0 &&
      typeof value.rank === "number" &&
      Number.isFinite(value.rank) &&
      value.rank >= 1
    );
  }

  if (value.event === "results_view_closed") {
    return (
      typeof value.city === "string" &&
      value.city.length > 0 &&
      typeof value.dwell_ms === "number" &&
      Number.isFinite(value.dwell_ms) &&
      value.dwell_ms >= 0
    );
  }

  return false;
}

export async function POST(request: Request) {
  if (!isTrustedAnalyticsRequest(request)) {
    return NextResponse.json(
      {
        ok: false,
        error: { code: "FORBIDDEN", message: "Analytics events must come from same-origin browser requests or trusted internal callers." },
      },
      { status: 403 },
    );
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_INPUT", message: "Request body must be valid JSON." } },
      { status: 400 },
    );
  }

  if (!isAnalyticsEvent(payload)) {
    return NextResponse.json(
      { ok: false, error: { code: "INVALID_INPUT", message: "Analytics event payload is invalid." } },
      { status: 400 },
    );
  }

  // Dev-visible verification path for Phase 1.5B instrumentation.
  if (process.env.NODE_ENV !== "production") {
    console.info("[analytics-event]", payload);
  }
  return NextResponse.json({ ok: true });
}
