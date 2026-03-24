import { NextResponse } from "next/server";
import { EnvValidationError, getServerEnv } from "@/lib/env";

export async function GET() {
  try {
    getServerEnv();
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (error instanceof EnvValidationError) {
      return NextResponse.json(
        { ok: false, error: { code: "CONFIG_ERROR", message: error.message } },
        { status: 500 },
      );
    }
    throw error;
  }
}
