import { NextResponse } from "next/server";
import { advanceIncident } from "@/lib/agent-loop";
import { getSnapshot, store } from "@/db";

export const runtime = "nodejs";

export async function GET(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const existing = await store.getInteraction(id);
  const incidentId = existing?.incidentId ?? id;
  const advanced = await advanceIncident(incidentId);
  if (advanced) return NextResponse.json(advanced);

  const snapshot = await getSnapshot(incidentId);
  if (!snapshot) {
    return NextResponse.json({ error: "Interaction not found" }, { status: 404 });
  }
  return NextResponse.json(snapshot);
}
