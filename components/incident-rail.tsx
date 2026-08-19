import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { IncidentRecord, IncidentSnapshot } from "@/db/types";

function statusVariant(status: IncidentRecord["status"]) {
  if (status === "resolved") return "secondary";
  if (status === "needs-human") return "destructive";
  return "default";
}

export function IncidentRail({
  incidents,
  latest,
}: {
  incidents: IncidentRecord[];
  latest: IncidentSnapshot | null;
}) {
  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium tracking-wide text-muted-foreground">
          Live rail
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <RailStat label="Alert" value={latest?.incident.alertName ?? "quiet"} />
          <RailStat
            label="Agent"
            value={latest?.interaction?.status ?? "idle"}
            mono
          />
          <RailStat
            label="Interaction ID"
            value={latest?.interaction?.geminiInteractionId ?? "—"}
            mono
          />
        </div>
        <div className="space-y-2">
          {incidents.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No incidents. Run Night Premiere to inject the QoS alert.
            </p>
          ) : (
            incidents.slice(0, 6).map((incident) => (
              <Link
                key={incident.id}
                href={`/incidents/${incident.id}`}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm hover:bg-muted/40"
              >
                <div>
                  <div className="font-medium">{incident.showName}</div>
                  <div className="font-mono text-[11px] text-muted-foreground">
                    {incident.region} · {incident.suspectEdge ?? "diagnosing"}
                  </div>
                </div>
                <Badge variant={statusVariant(incident.status)}>{incident.status}</Badge>
              </Link>
            ))
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function RailStat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 truncate text-sm ${mono ? "font-mono" : ""}`}>{value}</div>
    </div>
  );
}
