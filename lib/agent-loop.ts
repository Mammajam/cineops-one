import { getSnapshot, newId, nowIso, store } from "@/db";
import type { AgentStep, IncidentSnapshot } from "@/db/types";
import {
  callGrafanaTool,
  createGrafanaIncident,
  dashboardDeeplink,
  extractIncidentId,
  grafanaMode,
  listFiringAlerts,
  qosFromToolResult,
  queryEdgeLatency,
  queryEdgeLogs,
  queryOrigin5xx,
  queryShowMetrics,
  resolveGrafanaIncident,
  searchNightPremiereDashboard,
  updateGrafanaIncident,
} from "@/lib/grafana-mcp";
import {
  cancelBackgroundInteraction,
  continueWithEvidence,
  continueWithFunctionResults,
  diagnosisPrompt,
  extractFunctionCalls,
  extractOutputText,
  geminiMode,
  getBackgroundInteraction,
  isGeminiConfigured,
  startBackgroundDiagnosis,
} from "@/lib/gemini";
import { drainPlan, pickSuspectEdge } from "@/lib/playbook";
import { SHOW, SUSPECT_EDGE, nightPremiereWebhookPayload } from "@/lib/show";

const MCP_TOOLS = new Set([
  "alerting_manage_rules",
  "query_prometheus",
  "query_loki_logs",
  "search_dashboards",
  "create_incident",
  "add_activity_to_incident",
  "list_alert_groups",
  "list_incidents",
]);

async function audit(incidentId: string, actor: string, action: string, detail?: Record<string, unknown>) {
  await store.createAudit({
    id: newId(),
    incidentId,
    actor,
    action,
    detail: detail ?? null,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
}

async function trace(
  incidentId: string,
  tool: string,
  args: Record<string, unknown>,
  result: Awaited<ReturnType<typeof callGrafanaTool>>,
) {
  await store.appendMcpTrace(incidentId, {
    at: nowIso(),
    tool,
    mode: result.mode,
    args,
    result: result.result,
    label: result.label,
  });
  await audit(incidentId, "grafana-mcp", tool, {
    mode: result.mode,
    label: result.label,
  });
}

async function maybeGeminiTools(snapshot: IncidentSnapshot) {
  const interaction = snapshot.interaction;
  if (!interaction || !isGeminiConfigured() || interaction.geminiInteractionId.startsWith("local-")) {
    return;
  }
  try {
    const current = await getBackgroundInteraction(interaction.geminiInteractionId);
    const calls = extractFunctionCalls(current);
    for (const call of calls) {
      if (!MCP_TOOLS.has(call.name)) continue;
      const result = await callGrafanaTool(call.name, call.arguments);
      await trace(snapshot.incident.id, call.name, call.arguments, result);
      const continued = await continueWithFunctionResults({
        previousId: current.id,
        callId: call.id,
        name: call.name,
        result: result.result,
      });
      await store.updateInteraction(interaction.id, {
        geminiInteractionId: continued.id,
        status: continued.status === "completed" ? "completed" : "in_progress",
        raw: {
          ...(interaction.raw ?? {}),
          lastGemini: continued as unknown as Record<string, unknown>,
        },
      });
    }
    const text = extractOutputText(current);
    if (text) {
      await store.updateInteraction(interaction.id, {
        raw: { ...(interaction.raw ?? {}), geminiText: text },
      });
    }
  } catch (error) {
    await audit(snapshot.incident.id, "gemini", "poll-error", {
      message: error instanceof Error ? error.message : String(error),
    });
  }
}

export async function startNightPremiereIncident(source: "demo" | "webhook") {
  const payload = nightPremiereWebhookPayload();
  const incidentId = newId();
  const interactionId = newId();
  const now = nowIso();

  await store.createIncident({
    id: incidentId,
    grafanaIncidentId: null,
    alertName: payload.alerts[0]?.labels.alertname ?? "NightPremiereBufferRatio",
    showName: SHOW.name,
    region: SHOW.region,
    status: "detecting",
    onAir: true,
    suspectEdge: null,
    isolatePlan: null,
    killed: false,
    createdAt: now,
    updatedAt: now,
  });

  let geminiId = `local-${interactionId}`;
  let geminiStatus: "queued" | "in_progress" = "in_progress";

  if (isGeminiConfigured()) {
    try {
      const started = await startBackgroundDiagnosis(
        diagnosisPrompt({
          alertName: payload.alerts[0]?.labels.alertname ?? "NightPremiereBufferRatio",
          showName: SHOW.name,
          region: SHOW.region,
          interactionNote: `CineOps Interaction pending; source=${source}`,
        }),
      );
      geminiId = started.id;
    } catch (error) {
      geminiStatus = "in_progress";
      await audit(incidentId, "gemini", "start-fallback-local", {
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  await store.createInteraction({
    id: interactionId,
    incidentId,
    geminiInteractionId: geminiId,
    background: true,
    status: geminiStatus,
    step: "start",
    lastPollAt: now,
    raw: { source, background: true },
    createdAt: now,
    updatedAt: now,
  });

  await audit(incidentId, source === "demo" ? "crew" : "grafana-webhook", "incident-opened", {
    show: SHOW.name,
    region: SHOW.region,
    onAir: true,
  });

  return getSnapshot(incidentId);
}

async function stepAlerts(snapshot: IncidentSnapshot) {
  const result = await listFiringAlerts();
  await trace(snapshot.incident.id, result.tool, { operation: "list" }, result);
  await store.updateIncident(snapshot.incident.id, { status: "diagnosing" });
  await store.setStep(snapshot.interaction!.id, "alerts", "in_progress");
}

async function stepMetrics(snapshot: IncidentSnapshot) {
  const buffer = await queryShowMetrics();
  await trace(snapshot.incident.id, buffer.tool, { metric: "cineops_buffer_ratio" }, buffer);
  const errors = await queryOrigin5xx();
  await trace(snapshot.incident.id, errors.tool, { metric: "cineops_origin_5xx" }, errors);
  const latency = await queryEdgeLatency();
  await trace(snapshot.incident.id, latency.tool, { metric: "cineops_edge_latency" }, latency);
  const qos = qosFromToolResult(buffer);
  const suspect = pickSuspectEdge(qos);
  await store.updateIncident(snapshot.incident.id, { suspectEdge: suspect });
  await store.updateInteraction(snapshot.interaction!.id, {
    raw: {
      ...(snapshot.interaction!.raw ?? {}),
      qosRows: qos,
      qosMode: buffer.mode,
    },
  });
  await store.setStep(snapshot.interaction!.id, "metrics", "in_progress");
}

async function stepLogs(snapshot: IncidentSnapshot) {
  const edge = snapshot.incident.suspectEdge ?? SUSPECT_EDGE;
  const logs = await queryEdgeLogs(edge);
  await trace(snapshot.incident.id, logs.tool, { edge }, logs);
  await store.setStep(snapshot.interaction!.id, "logs", "in_progress");
}

async function stepDashboards(snapshot: IncidentSnapshot) {
  const dash = await searchNightPremiereDashboard();
  await trace(snapshot.incident.id, dash.tool, { query: "Night Premiere QoS" }, dash);
  await store.updateInteraction(snapshot.interaction!.id, {
    raw: {
      ...(snapshot.interaction!.raw ?? {}),
      dashboardUrl: dashboardDeeplink(dash),
    },
  });
  await store.setStep(snapshot.interaction!.id, "dashboards", "in_progress");
}

async function stepFinding(snapshot: IncidentSnapshot) {
  const edge = snapshot.incident.suspectEdge ?? SUSPECT_EDGE;
  const plan = drainPlan(edge);
  const summary =
    `Isolate ${edge}. Buffer ratio / origin 5xx / latency outlier on Night Premiere EU-West. ` +
    `Simulated drain to ${plan.drainTo.join(" / ")}.`;
  await store.createFinding({
    id: newId(),
    incidentId: snapshot.incident.id,
    suspectEdge: edge,
    summary,
    confidence: "high",
    evidence: {
      metrics: "cineops_buffer_ratio, cineops_origin_5xx, cineops_edge_latency",
      dashboard: snapshot.interaction?.raw?.dashboardUrl ?? null,
      qosRows: snapshot.interaction?.raw?.qosRows ?? null,
      qosMode: snapshot.interaction?.raw?.qosMode ?? null,
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  await store.updateIncident(snapshot.incident.id, {
    isolatePlan: plan,
    status: "isolating",
  });
  await store.createAction({
    id: newId(),
    incidentId: snapshot.incident.id,
    type: "simulate-failover",
    status: "proposed",
    fromEdge: edge,
    toEdges: plan.drainTo,
    operator: "gemini-agent",
    detail: { auto: true, demo: true },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  await audit(snapshot.incident.id, "playbook", "isolate-verdict", plan as unknown as Record<string, unknown>);
  await store.setStep(snapshot.interaction!.id, "finding", "in_progress");

  if (isGeminiConfigured() && !snapshot.interaction!.geminiInteractionId.startsWith("local-")) {
    try {
      const continued = await continueWithEvidence(
        snapshot.interaction!.geminiInteractionId,
        summary,
      );
      await store.updateInteraction(snapshot.interaction!.id, {
        geminiInteractionId: continued.id,
        raw: {
          ...(snapshot.interaction!.raw ?? {}),
          geminiText: extractOutputText(continued),
        },
      });
    } catch {
      // Playbook finding already persisted.
    }
  }
}

async function stepGrafanaIncident(snapshot: IncidentSnapshot) {
  const created = await createGrafanaIncident({
    title: `${SHOW.name} QoS — ${SHOW.region}`,
    severity: "major",
    body: `CineOps Interaction ID ${snapshot.interaction?.geminiInteractionId}. Suspect ${snapshot.incident.suspectEdge}.`,
  });
  await trace(snapshot.incident.id, created.tool, { title: `${SHOW.name} QoS` }, created);
  const grafanaId = extractIncidentId(created);
  if (grafanaId) {
    await store.updateIncident(snapshot.incident.id, { grafanaIncidentId: grafanaId });
    await updateGrafanaIncident(
      grafanaId,
      `Evidence: isolate ${snapshot.incident.suspectEdge}. Interaction ${snapshot.interaction?.geminiInteractionId}.`,
    );
  }
  await store.setStep(snapshot.interaction!.id, "grafana_incident", "in_progress");
}

async function stepSimulate(snapshot: IncidentSnapshot, operator: string) {
  const plan = drainPlan(snapshot.incident.suspectEdge ?? SUSPECT_EDGE);
  const existing = snapshot.actions.find((item) => item.type === "simulate-failover");
  if (existing) {
    await store.updateAction(existing.id, { status: "simulated", operator });
  } else {
    await store.createAction({
      id: newId(),
      incidentId: snapshot.incident.id,
      type: "simulate-failover",
      fromEdge: plan.suspectEdge,
      toEdges: plan.drainTo,
      status: "simulated",
      operator,
      detail: { simulated: true },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
  }
  await audit(snapshot.incident.id, operator, "simulate-failover", plan as unknown as Record<string, unknown>);
  await store.setStep(snapshot.interaction!.id, "simulating", "in_progress");
}

async function stepResolve(snapshot: IncidentSnapshot) {
  const grafanaId = snapshot.incident.grafanaIncidentId;
  if (grafanaId) {
    const resolved = await resolveGrafanaIncident(
      grafanaId,
      `Simulated drain of ${snapshot.incident.suspectEdge} complete. Show remains ON AIR.`,
    );
    await trace(snapshot.incident.id, resolved.tool, { incidentId: grafanaId, resolve: true }, resolved);
  }
  await store.updateIncident(snapshot.incident.id, { status: "resolved" });
  await store.setStep(snapshot.interaction!.id, "complete", "completed");
  await audit(snapshot.incident.id, "grafana-mcp", "incident-resolved", {
    grafanaIncidentId: grafanaId,
  });
}

const ORDER: AgentStep[] = [
  "start",
  "alerts",
  "metrics",
  "logs",
  "dashboards",
  "finding",
  "grafana_incident",
  "awaiting_failover",
  "simulating",
  "resolving",
  "complete",
];

export async function advanceIncident(id: string): Promise<IncidentSnapshot | null> {
  let snapshot = await getSnapshot(id);
  if (!snapshot?.interaction) return snapshot;
  if (snapshot.incident.killed) {
    return snapshot;
  }
  if (snapshot.interaction.step === "complete" || snapshot.incident.status === "resolved") {
    return snapshot;
  }

  await maybeGeminiTools(snapshot);
  snapshot = (await getSnapshot(id)) ?? snapshot;
  if (!snapshot.interaction) return snapshot;

  const step = snapshot.interaction.step;

  if (step === "start") await stepAlerts(snapshot);
  else if (step === "alerts") await stepMetrics(snapshot);
  else if (step === "metrics") await stepLogs(snapshot);
  else if (step === "logs") await stepDashboards(snapshot);
  else if (step === "dashboards") await stepFinding(snapshot);
  else if (step === "finding") await stepGrafanaIncident(snapshot);
  else if (step === "grafana_incident") {
    await store.setStep(snapshot.interaction.id, "awaiting_failover", "in_progress");
  } else if (step === "awaiting_failover") {
    await stepSimulate(snapshot, "demo-auto");
  } else if (step === "simulating") {
    await stepResolve(snapshot);
  }

  const next = await getSnapshot(id);
  if (next?.interaction && ORDER.indexOf(next.interaction.step) >= 0) {
    await store.updateInteraction(next.interaction.id, { lastPollAt: nowIso() });
  }
  return getSnapshot(id);
}

export async function simulateFailover(incidentId: string, operator = "crew") {
  const snapshot = await getSnapshot(incidentId);
  if (!snapshot?.interaction) return null;
  if (snapshot.incident.killed) {
    throw new Error("Kill switch engaged — failover blocked.");
  }
  await stepSimulate(snapshot, operator);
  await stepResolve((await getSnapshot(incidentId)) ?? snapshot);
  return getSnapshot(incidentId);
}

export async function killSwitch(incidentId: string, operator = "crew") {
  const snapshot = await getSnapshot(incidentId);
  if (!snapshot?.interaction) return null;

  if (snapshot.interaction.geminiInteractionId) {
    await cancelBackgroundInteraction(snapshot.interaction.geminiInteractionId);
  }

  const existing = snapshot.actions.find((item) => item.type === "simulate-failover");
  if (existing && existing.status === "proposed") {
    await store.updateAction(existing.id, { status: "blocked", operator });
  }

  await store.createAction({
    id: newId(),
    incidentId,
    type: "kill",
    status: "cancelled",
    fromEdge: snapshot.incident.suspectEdge,
    toEdges: null,
    operator,
    detail: { reason: "kill-switch" },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });

  await store.updateIncident(incidentId, {
    killed: true,
    status: "needs-human",
  });
  await store.setStep(snapshot.interaction.id, "needs_human", "cancelled");
  await audit(incidentId, operator, "kill-switch", {
    message: "Interaction cancelled. No failover. Incident marked needs-human.",
  });

  return getSnapshot(incidentId);
}

export { grafanaMode, geminiMode };
