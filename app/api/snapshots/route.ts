import { NextResponse } from "next/server";
import { getSnapshotSummary } from "@/lib/snapshot-data.generated";

const SNAPSHOT_VERSION_DEFAULT = "pilot-v1";

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

export async function GET() {
  const version = process.env.SEARCH_SNAPSHOT_VERSION?.trim() || SNAPSHOT_VERSION_DEFAULT;
  const raw = getSnapshotSummary(version);
  if (!raw) {
    return NextResponse.json(
      { ok: false, version, error: { code: "SNAPSHOT_MANIFEST_MISSING", message: "No snapshot manifest found." } },
      { status: 404 },
    );
  }

  const summary = parseManifest(raw);
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
