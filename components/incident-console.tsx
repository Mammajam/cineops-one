"use client";

import { useEffect, useState } from "react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { AgentStep, IncidentSnapshot, IsolatePlan } from "@/db/types";
import type { EdgeQos } from "@/lib/grafana-fixtures";

const MAX_ADK_TURNS = 12;

const STEP_LABEL: Record<AgentStep, string> = {
  start: "start",
  alerts: "alerts",
  metrics: "metrics",
  logs: "logs",
  dashboards: "dashboards",
  finding: "Gemini verdict",
  grafana_incident: "Grafana Incident",
  awaiting_failover: "awaiting drain",
  simulating: "simulating drain",
  resolving: "resolving",
  complete: "complete",
  needs_human: "needs-human",
};

const TOOL_PHASE: Record<string, string> = {
  alerting_manage_rules: "alerts",
  query_prometheus: "metrics",
  query_loki_logs: "logs",
  search_dashboards: "dashboards",
  create_incident: "Grafana Incident",
  add_activity_to_incident: "Grafana Incident",
};

function qosRowsFromSnapshot(snapshot: IncidentSnapshot): EdgeQos[] {
  const qosMode = snapshot.interaction?.raw?.qosMode;
  const fromInteraction = snapshot.interaction?.raw?.qosRows;
  const fromFinding = snapshot.findings[0]?.evidence?.qosRows;
  const candidate = fromInteraction ?? fromFinding;
  if (qosMode !== "mcp") return [];
  if (Array.isArray(candidate) && candidate.length > 0) {
    return candidate as EdgeQos[];
  }
  return [];
}

function needsHumanReason(snapshot: IncidentSnapshot) {
  const fromRaw = snapshot.interaction?.raw?.needsHumanReason;
  if (typeof fromRaw === "string" && fromRaw.trim()) return fromRaw;
  const event = snapshot.auditEvents.find((item) => item.action === "needs-human" || item.action === "kill-switch");
  const detail = event?.detail?.reason ?? event?.detail?.message;
  return typeof detail === "string" ? detail : null;
}

function parseIsolatePlan(value: IncidentSnapshot["incident"]["isolatePlan"]): IsolatePlan | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<IsolatePlan>;
  if (typeof row.suspectEdge !== "string" || !Array.isArray(row.drainTo)) return null;
  return {
    suspectEdge: row.suspectEdge,
    drainTo: row.drainTo.filter((item): item is string => typeof item === "string"),
    reason: typeof row.reason === "string" ? row.reason : "",
    simulated: row.simulated !== false,
  };
}

function drainPlanFromSnapshot(snapshot: IncidentSnapshot): IsolatePlan | null {
  const fromIncident = parseIsolatePlan(snapshot.incident.isolatePlan);
  if (fromIncident && fromIncident.drainTo.length > 0) return fromIncident;
  const action = snapshot.actions.find((item) => item.type === "simulate-failover");
  if (action?.fromEdge && Array.isArray(action.toEdges) && action.toEdges.length > 0) {
    return {
      suspectEdge: action.fromEdge,
      drainTo: action.toEdges,
      reason: "Simulated drain. No live CDN patch.",
      simulated: true,
    };
  }
  return null;
}

function adkTurnCount(snapshot: IncidentSnapshot) {
  const blob = snapshot.interaction?.raw?.adk;
  if (!blob || typeof blob !== "object") return 0;
  const count = (blob as { turnCount?: unknown }).turnCount;
  return typeof count === "number" && Number.isFinite(count) ? count : 0;
}

function adkProgressLabel(snapshot: IncidentSnapshot) {
  const sessionId = snapshot.interaction?.geminiInteractionId ?? "";
  const turns = adkTurnCount(snapshot);
  if (!sessionId || sessionId.startsWith("local-")) return "not started";
  return `turn ${turns}/${MAX_ADK_TURNS}`;
}

function agentPhaseLabel(snapshot: IncidentSnapshot) {
  const step = snapshot.interaction?.step;
  if (
    step === "finding" ||
    step === "grafana_incident" ||
    step === "awaiting_failover" ||
    step === "simulating" ||
    step === "resolving" ||
    step === "complete" ||
    step === "needs_human"
  ) {
    return STEP_LABEL[step];
  }
  const lastTool = snapshot.mcpTrace[snapshot.mcpTrace.length - 1]?.tool;
  if (lastTool && TOOL_PHASE[lastTool]) return TOOL_PHASE[lastTool];
  return STEP_LABEL[step ?? "start"];
}

async function readApiError(response: Response) {
  try {
    const body = (await response.json()) as { error?: unknown };
    if (typeof body.error === "string" && body.error.trim()) return body.error;
  } catch {
    // Response was not JSON.
  }
  return `Request failed (${response.status})`;
}

function isTerminalIncident(snapshot: IncidentSnapshot) {
  return (
    snapshot.incident.killed ||
    snapshot.incident.status === "resolved" ||
    snapshot.incident.status === "needs-human"
  );
}

export function IncidentConsole({ initial }: { initial: IncidentSnapshot }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [ticking, setTicking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = snapshot.interaction?.id ?? snapshot.incident.id;
    let cancelled = false;
    let inFlight = false;

    async function poll() {
      if (inFlight) return;
      if (isTerminalIncident(snapshot)) return;
      inFlight = true;
      setTicking(true);
      try {
        const response = await fetch(`/api/interactions/${id}/tick`, { method: "POST" });
        if (cancelled) return;
        if (!response.ok) {
          setError(await readApiError(response));
          return;
        }
        setError(null);
        setSnapshot((await response.json()) as IncidentSnapshot);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "ADK tick failed");
        }
      } finally {
        inFlight = false;
        if (!cancelled) setTicking(false);
      }
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
    setError(null);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ incidentId: snapshot.incident.id }),
      });
      if (!response.ok) {
        setError(await readApiError(response));
        return;
      }
      setSnapshot((await response.json()) as IncidentSnapshot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setBusy(false);
    }
  }

  const incident = snapshot.incident;
  const finding = snapshot.findings[0];
  const drainPlan = drainPlanFromSnapshot(snapshot);
  const dashboardUrl = String(snapshot.interaction?.raw?.dashboardUrl ?? "/d/night-premiere-qos");
  const geminiText = String(snapshot.interaction?.raw?.geminiText ?? finding?.summary ?? "");
  const qosRows = qosRowsFromSnapshot(snapshot);
  const humanReason = needsHumanReason(snapshot);
  const terminal = isTerminalIncident(snapshot);
  const canSimulate = Boolean(finding) && !busy && !terminal;
  const canKill = !busy && !terminal;
  const qosSource =
    snapshot.interaction?.raw?.qosMode === "mcp"
      ? "Grafana MCP query"
      : snapshot.grafanaMode === "mcp"
        ? "Grafana MCP (awaiting rows)"
        : "No live QoS rows (fixture is not shown as a diagnosis)";
  const agentValue = ticking
    ? `${snapshot.interaction?.status ?? "idle"} · working`
    : (snapshot.interaction?.status ?? "idle");

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
          <Badge variant={incident.status === "needs-human" ? "destructive" : "default"}>{incident.status}</Badge>
          <Badge variant="secondary">{snapshot.grafanaMode === "mcp" ? "Grafana MCP live" : "Grafana fixture"}</Badge>
          <Badge variant="outline">{snapshot.geminiMode === "live" ? "Gemini live" : "Gemini not live"}</Badge>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Live rail</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <Meta label="Alert state" value={incident.status === "detecting" ? "firing" : incident.status} />
            <Meta label="Agent" value={agentValue} />
            <Meta label="ADK" value={adkProgressLabel(snapshot)} mono />
            <Meta label="Phase" value={agentPhaseLabel(snapshot)} />
            <Meta label="Grafana Incident" value={incident.grafanaIncidentId ?? "—"} mono />
            <Meta label="Interaction ID" value={snapshot.interaction?.geminiInteractionId ?? "—"} mono />
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm text-muted-foreground">Isolate verdict</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-sm text-primary">
              {finding?.suspectEdge ??
                incident.suspectEdge ??
                (incident.status === "needs-human" ? "no isolate" : "awaiting Gemini isolate verdict")}
            </p>
            <p className="mt-2 text-sm text-muted-foreground">
              {finding?.summary ??
                (incident.status === "needs-human"
                  ? humanReason ?? "Needs human review — no auto-isolate."
                  : "Gemini is choosing Grafana MCP tools. The playbook will not pick an edge.")}
            </p>
            {drainPlan ? (
              <p className="mt-3 font-mono text-xs text-foreground">
                {drainPlan.simulated ? "Simulated drain" : "Drain"} {drainPlan.suspectEdge} → {drainPlan.drainTo.join(" / ")}
              </p>
            ) : null}
            {finding ? (
              <p className="mt-2 text-[11px] uppercase tracking-wider text-muted-foreground">
                Gemini confidence {finding.confidence}
                {drainPlan?.simulated ? " · simulated — no live CDN patch" : ""}
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            disabled={!canSimulate}
            onClick={() => postAction("/api/actions/simulate-failover")}
          >
            Simulate failover
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="destructive" disabled={!canKill}>
                Kill switch
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Engage kill switch?</AlertDialogTitle>
                <AlertDialogDescription>
                  Cancels the Gemini ADK session, marks this incident needs-human, and blocks simulated failover.
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
        {!finding && !terminal ? (
          <p className="text-xs text-muted-foreground">
            Awaiting Gemini isolate verdict — drain is gated until the playbook accepts a live MCP finding.
          </p>
        ) : null}
        {error ? (
          <p className="text-sm text-destructive" role="alert">
            {error}
          </p>
        ) : null}
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
                  {qosRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={4} className="text-sm text-muted-foreground">
                        {ticking
                          ? "Gemini is querying Grafana MCP…"
                          : "No live MCP QoS rows. Fixture series are not shown as a diagnosis."}
                      </TableCell>
                    </TableRow>
                  ) : (
                    qosRows.map((row) => (
                      <TableRow key={row.edge} className={row.edge === incident.suspectEdge ? "bg-destructive/10" : ""}>
                        <TableCell className="font-mono text-xs">{row.edge}</TableCell>
                        <TableCell>{Number(row.bufferRatio).toFixed(2)}</TableCell>
                        <TableCell>{Number(row.origin5xx).toFixed(1)}</TableCell>
                        <TableCell>{Number(row.edgeLatencyMs)} ms</TableCell>
                      </TableRow>
                    ))
                  )}
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
                <p className="text-sm text-muted-foreground">
                  {ticking ? "ADK turn in progress — waiting for Grafana MCP tool calls…" : "Waiting for Grafana MCP tool calls…"}
                </p>
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
