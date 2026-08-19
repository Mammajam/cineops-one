import { NextResponse } from "next/server";
import { getSnapshot, store } from "@/db";

export const runtime = "nodejs";

export async function GET() {
  const incidents = await store.listIncidents();
  const latest = incidents[0] ? await getSnapshot(incidents[0].id) : null;
  return NextResponse.json({
    incidents,
    latest,
    dbMode: store.dbMode(),
  });
}
