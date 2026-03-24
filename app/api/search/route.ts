import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    {
      city: "",
      restaurants: [],
      warnings: [],
      error: { code: "NOT_IMPLEMENTED", message: "Search route not implemented yet." },
    },
    { status: 501 },
  );
}
