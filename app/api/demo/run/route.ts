import { NextResponse } from "next/server";
import { startNightPremiereIncident } from "@/lib/agent-loop";

export const runtime = "nodejs";

export async function POST() {
  const snapshot = await startNightPremiereIncident("demo");
  return NextResponse.json(snapshot);
}
