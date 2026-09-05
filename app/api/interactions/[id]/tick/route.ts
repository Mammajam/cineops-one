import { NextResponse } from "next/server";
import { getSnapshot, store } from "@/db";
import { tickIncident } from "@/lib/agent-loop";

export const runtime = "nodejs";
export const maxDuration = 60;

function isTerminalStatus(status: string) {
  return status === "resolved" || status === "needs-human";
}

export async function POST(
  _request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const existing = await store.getInteraction(id);
  const incidentId = existing?.incidentId ?? id;
  const snapshot = await getSnapshot(incidentId);
  if (!snapshot?.interaction) {
    return NextResponse.json({ error: "Interaction not found" }, { status: 404 });
  }

  if (snapshot.incident.killed || isTerminalStatus(snapshot.incident.status)) {
    return NextResponse.json(snapshot);
  }

  const locked = await store.tryBeginTick(snapshot.interaction.id);
  if (!locked) {
    const current = await getSnapshot(incidentId);
    return NextResponse.json(current ?? snapshot);
  }

  try {
    const next = await tickIncident(incidentId);
    if (!next) {
      return NextResponse.json({ error: "Interaction not found" }, { status: 404 });
    }
    return NextResponse.json(next);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Tick failed" },
      { status: 500 },
    );
  } finally {
    await store.endTick(snapshot.interaction.id);
  }
}
