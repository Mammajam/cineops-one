import { getSnapshot, store } from "@/db";
import { IncidentRail } from "@/components/incident-rail";
import { RunDemoButton } from "@/components/run-demo-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SHOW } from "@/lib/show";
import { isGeminiConfigured } from "@/lib/gemini";
import { isGrafanaMcpLive } from "@/lib/grafana-mcp";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  const incidents = await store.listIncidents();
  const latest = incidents[0] ? await getSnapshot(incidents[0].id) : null;
  const grafanaLive = isGrafanaMcpLive();
  const geminiLive = isGeminiConfigured();

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Studio-ops console</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
            {SHOW.name} is on air in {SHOW.region}. When Grafana fires a QoS alert, a Gemini
            ADK agent queries Grafana MCP, returns an isolate verdict, and the playbook gates a
            simulated drain into a Grafana Incident.
          </p>
        </div>
        <RunDemoButton />
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant={grafanaLive ? "default" : "secondary"}>
          {grafanaLive ? "Grafana MCP live" : "Grafana fixture / demo"}
        </Badge>
        <Badge variant={geminiLive ? "default" : "outline"}>
          {geminiLive ? "Gemini live" : "Gemini not live (needs-human)"}
        </Badge>
        <Badge variant="outline">DB {store.dbMode()}</Badge>
      </div>

      <IncidentRail incidents={incidents} latest={latest} />

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Show context</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Show</div>
            <div>{SHOW.name}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Region</div>
            <div>{SHOW.region}</div>
          </div>
          <div>
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">On-air</div>
            <div>ON AIR</div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
