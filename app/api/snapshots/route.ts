import { NextResponse } from "next/server";

const SNAPSHOT_VERSION_DEFAULT = "pilot-v1";

function normalizeBaseUrl(url: string) {
  return url.replace(/\/+$/, "");
}

function isLoopbackHost(hostname: string) {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
}

function getRequestOrigin(request: Request) {
  const configuredOrigin = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configuredOrigin) {
    try {
      const configuredUrl = new URL(configuredOrigin);
      const requestUrl = new URL(request.url);
      if (!(isLoopbackHost(configuredUrl.hostname) && !isLoopbackHost(requestUrl.hostname))) {
        return normalizeBaseUrl(configuredUrl.origin);
      }
    } catch {
      // fall through
    }
  }

  try {
    const url = new URL(request.url);
    if (!isLoopbackHost(url.hostname)) {
      return url.origin;
    }
  } catch {
    // fall through
  }

  const forwardedHost = request.headers.get("x-forwarded-host") || request.headers.get("host");
  if (forwardedHost) {
    const forwardedProto = request.headers.get("x-forwarded-proto") || "https";
    return `${forwardedProto}://${forwardedHost}`;
  }

  return "http://localhost";
}

async function tryReadFile(filePath: string) {
  try {
    const fs = await import("node:fs/promises");
    return await fs.readFile(filePath, "utf8");
  } catch {
    return null;
  }
}

type SnapshotSummary = {
  finishedAtUtc: string | null;
  entries: Array<{ city: string; slug: string }>;
};

function parseManifest(raw: string): SnapshotSummary | null {
  const parsed = JSON.parse(raw) as {
    finished_at_utc?: string;
    results?: Array<{ city?: string; slug?: string; success?: boolean }>;
  };

  const results = Array.isArray(parsed.results) ? parsed.results : [];
  const entries = results
    .filter((entry) => entry.success && typeof entry.city === "string" && typeof entry.slug === "string")
    .map((entry) => ({ city: entry.city as string, slug: entry.slug as string }));
  if (entries.length === 0) return null;

  return { finishedAtUtc: parsed.finished_at_utc ?? null, entries };
}

async function loadSnapshotSummary(request: Request, version: string): Promise<SnapshotSummary | null> {
  try {
    const path = await import("node:path");
    const candidates = [
      path.join(process.cwd(), "data", "precompute", version, "_run-summary.json"),
      path.join(process.cwd(), "public", "precompute", version, "_run-summary.json"),
    ];
    for (const candidate of candidates) {
      const raw = await tryReadFile(candidate);
      if (raw) {
        const result = parseManifest(raw);
        if (result) return result;
      }
    }
  } catch {
    // filesystem unavailable, fall through to HTTP
  }

  try {
    const origin = getRequestOrigin(request);
    const url = `${normalizeBaseUrl(origin)}/precompute/${encodeURIComponent(version)}/_run-summary.json`;
    const response = await fetch(url, { cache: "no-store" });
    if (response.ok) {
      const raw = await response.text();
      return parseManifest(raw);
    }
  } catch {
    // HTTP fallback failed
  }

  return null;
}

export async function GET(request: Request) {
  const version = process.env.SEARCH_SNAPSHOT_VERSION?.trim() || SNAPSHOT_VERSION_DEFAULT;
  const summary = await loadSnapshotSummary(request, version);
  if (!summary) {
    return NextResponse.json(
      { ok: false, version, error: { code: "SNAPSHOT_MANIFEST_MISSING", message: "No snapshot manifest found." } },
      { status: 404 },
    );
  }

  return NextResponse.json({
    ok: true,
    version,
    finished_at_utc: summary.finishedAtUtc,
    cities: summary.entries.map((entry) => entry.city),
    entries: summary.entries,
  });
}
