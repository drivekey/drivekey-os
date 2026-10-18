import { NextResponse } from "next/server";

// Retired in v2: no alternate browser-key or legacy submission path.
export async function POST() {
  return NextResponse.json({ error: "Legacy workflow retired. Use the v2 offline workflow." }, { status: 410 });
}
