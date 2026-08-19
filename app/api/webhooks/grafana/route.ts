import { NextResponse } from "next/server";
import { startNightPremiereIncident } from "@/lib/agent-loop";
import { SHOW } from "@/lib/show";

export const runtime = "nodejs";

export async function POST(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    body = {};
  }

  const labels = (body.commonLabels ?? {}) as Record<string, string>;
  const show = labels.show ?? SHOW.slug;
  if (show !== SHOW.slug && show !== SHOW.name) {
    return NextResponse.json(
      { ok: false, message: "Webhook ignored — CineOps One v1 only handles Night Premiere." },
      { status: 202 },
    );
  }

  const snapshot = await startNightPremiereIncident("webhook");
  return NextResponse.json({ ok: true, snapshot });
}
