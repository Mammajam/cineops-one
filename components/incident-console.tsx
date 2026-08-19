"use client";

import { useEffect, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { IncidentSnapshot } from "@/db/types";
import { fixtureEdgeQos, type EdgeQos } from "@/lib/grafana-fixtures";

function qosRowsFromSnapshot(snapshot: IncidentSnapshot): EdgeQos[] {
  const fromInteraction = snapshot.interaction?.raw?.qosRows;
  const fromFinding = snapshot.findings[0]?.evidence?.qosRows;
  const candidate = fromInteraction ?? fromFinding;
  if (Array.isArray(candidate) && candidate.length > 0) {
    return candidate as EdgeQos[];
  }
  return fixtureEdgeQos;
}

export function IncidentConsole({ initial }: { initial: IncidentSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const id = snapshot.interaction?.id ?? snapshot.incident.id;
    let cancelled = false;
    async function poll() {
      const done =
        snapshot.incident.status === "resolved" ||
        snapshot.incident.status === "needs-human" ||
        snapshot.incident.killed;
      if (done) return;
      const response = await fetch(`/api/interactions/${id}`);
      if (!response.ok || cancelled) return;
      setSnapshot((await response.json()) as IncidentSnapshot);
    }
    const timer = setInterval(() => {
      void poll();
    }, 1400);
    void poll();
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [snapshot.incident.id, snapshot.incident.killed, snapshot.incident.status, snapshot.interaction?.id]);

  async function postAction(path: string) {
    setBusy(true);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId: snapshot.incident.id }),
      });
      if (response.ok) {
        setSnapshot((await response.json()) as IncidentSnapshot);
      }
    } finally {
      setBusy(false);
    }
  }

  const incident = snapshot.incident;
  const finding = snapshot.findings[0];
  const dashboardUrl = String(snapshot.interaction?.raw?.dashboardUrl ?? "/d/night-premiere-qos");
  const geminiText = String(snapshot.interaction?.raw?.geminiText ?? "");
  const qosRows = qosRowsFromSnapshot(snapshot);
  const qosSource =
    snapshot.interaction?.raw?.qosMode === "mcp"
      ? "Grafana MCP query"
      : snapshot.grafanaMode === "mcp"
        ? "Grafana MCP (awaiting rows)"
        : "FIXTURE / DEMO MODE";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold tracking-tight">
            {incident.showName} · {incident.region}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Alert {incident.alertName} · on-air {incident.onAir ? "yes" : "no"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge>{incident.status}</Badge>
          <Badge variant="secondary">{snapshot.grafanaMode === "mcp" ? "Grafana MCP live" : "Grafana fixture"}</Badge>
          <Badge variant="outline">{snapshot.geminiMode === "live" ? "Gemini live" : "local playbook"}</Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Live rail</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-3">
            <Meta label="Alert state" value={incident.status === "detecting" ? "firing" : incident.status} />
            <Meta label="Agent" value={snapshot.interaction?.status ?? "idle"} />
            <Meta label="Interaction ID" value={snapshot.interaction?.geminiInteractionId ?? "—"} mono />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Isolate verdict</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-sm text-primary">
              {incident.suspectEdge ?? "awaiting Grafana MCP metrics"}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {finding?.summary ?? "Agent is querying Grafana MCP for buffer ratio, origin 5xx, and edge latency."}
            </p>
            {finding ? (
              <p className="mt-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                Confidence {finding.confidence}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          variant="secondary"
          disabled={busy || incident.killed || incident.status === "resolved"}
          onClick={() => postAction("/api/actions/simulate-failover")}
        >
          Simulate failover
        </Button>
        <AlertDialog>
          <AlertDialogTrigger asChild>
            <Button variant="destructive" disabled={busy || incident.killed || incident.status === "resolved"}>
              Kill switch
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Engage kill switch?</AlertDialogTitle>
              <AlertDialogDescription>
                Cancels the Gemini Interaction, marks this incident needs-human, and blocks simulated failover.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Stay on air</AlertDialogCancel>
              <AlertDialogAction onClick={() => postAction("/api/actions/kill")}>
                Cancel agent
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>

      <Tabs defaultValue="evidence">
        <TabsList>
          <TabsTrigger value="evidence">Evidence</TabsTrigger>
          <TabsTrigger value="mcp">MCP tool trace</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
        </TabsList>
        <TabsContent value="evidence" className="mt-3 space-y-3">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Night Premiere QoS by edge</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="mb-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                Evidence source · {qosSource}
              </p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Edge</TableHead>
                    <TableHead>Buffer ratio</TableHead>
                    <TableHead>Origin 5xx</TableHead>
                    <TableHead>Latency</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {qosRows.map((row) => (
                    <TableRow key={row.edge} className={row.edge === incident.suspectEdge ? "bg-destructive/10" : ""}>
                      <TableCell className="font-mono text-xs">{row.edge}</TableCell>
                      <TableCell>{Number(row.bufferRatio).toFixed(2)}</TableCell>
                      <TableCell>{Number(row.origin5xx).toFixed(1)}</TableCell>
                      <TableCell>{Number(row.edgeLatencyMs)} ms</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              <a
                className="mt-3 inline-block text-xs text-primary underline-offset-4 hover:underline"
                href={dashboardUrl}
                target="_blank"
                rel="noreferrer"
              >
                Grafana dashboard deeplink — Night Premiere QoS
              </a>
              {geminiText ? (
                <p className="mt-3 whitespace-pre-wrap font-mono text-xs text-muted-foreground">{geminiText}</p>
              ) : null}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="mcp" className="mt-3">
          <Card>
            <CardContent className="space-y-3 pt-6">
              {snapshot.mcpTrace.length === 0 ? (
                <p className="text-sm text-muted-foreground">Waiting for Grafana MCP tool calls…</p>
              ) : (
                snapshot.mcpTrace.map((entry, index) => (
                  <div key={`${entry.at}-${index}`} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs">{entry.tool}</span>
                      <Badge variant={entry.mode === "mcp" ? "default" : "secondary"}>{entry.mode}</Badge>
                    </div>
                    {entry.label ? (
                      <p className="mt-1 text-[11px] text-amber-400">{entry.label}</p>
                    ) : null}
                    <pre className="mt-2 max-h-40 overflow-auto font-mono text-[11px] text-muted-foreground">
                      {JSON.stringify(entry.result, null, 2)}
                    </pre>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="timeline" className="mt-3">
          <Card>
            <CardContent className="space-y-3 pt-6">
              {snapshot.auditEvents.map((event) => (
                <div key={event.id}>
                  <div className="flex items-center justify-between gap-3 text-sm">
                    <span>
                      <span className="text-muted-foreground">{event.actor}</span>
                      {" · "}
                      {event.action}
                    </span>
                    <span className="font-mono text-[11px] text-muted-foreground">
                      {new Date(event.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                  <Separator className="mt-2" />
                </div>
              ))}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Meta({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-md border border-border bg-background/40 p-3">
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={`mt-1 break-all text-sm ${mono ? "font-mono text-xs" : ""}`}>{value}</div>
    </div>
  );
}
