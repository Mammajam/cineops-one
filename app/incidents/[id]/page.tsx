import { notFound } from "next/navigation";
import { IncidentConsole } from "@/components/incident-console";
import { getSnapshot } from "@/db";

export const dynamic = "force-dynamic";

export default async function IncidentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const snapshot = await getSnapshot(id);
  if (!snapshot) notFound();
  return <IncidentConsole initial={snapshot} />;
}
