import { NextResponse } from "next/server";
import { killSwitch } from "@/lib/agent-loop";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const body = (await request.json()) as { incidentId?: string };
  if (!body.incidentId) {
    return NextResponse.json({ error: "incidentId required" }, { status: 400 });
  }
  const snapshot = await killSwitch(body.incidentId, "crew");
  if (!snapshot) {
    return NextResponse.json({ error: "Incident not found" }, { status: 404 });
  }
  return NextResponse.json(snapshot);
}
