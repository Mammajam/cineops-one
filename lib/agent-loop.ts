import { getSnapshot, newId, nowIso, store } from "@/db";
import type { IncidentSnapshot, InteractionRecord } from "@/db/types";
import {
  createAdkSessionBlob,
  MAX_ADK_TURNS,
  runCineopsAdkTurn,
  type AdkSessionBlob,
} from "@/lib/cineops-agent";
import {
  cancelBackgroundInteraction,
  geminiMode,
  isGeminiConfigured,
} from "@/lib/gemini";
import {
  createGrafanaIncident,
  extractIncidentId,
  grafanaMode,
  isGrafanaMcpLive,
  resolveGrafanaIncident,
  updateGrafanaIncident,
} from "@/lib/grafana-mcp";
import { drainPlan, validateIsolate } from "@/lib/playbook";
import { SHOW, nightPremiereWebhookPayload } from "@/lib/show";
import { verdictNeedsHuman, type IsolateVerdict } from "@/lib/verdict";

function adkFromRaw(raw: Record<string, unknown> | null | undefined): AdkSessionBlob | null {
  const blob = raw?.adk;
  if (!blob || typeof blob !== "object") return null;
  const row = blob as Partial<AdkSessionBlob>;
  if (!row.sessionId || !row.appName || !row.userId) return null;
  return {
    appName: String(row.appName),
    userId: String(row.userId),
    sessionId: String(row.sessionId),
    state: (row.state ?? {}) as Record<string, unknown>,
    events: Array.isArray(row.events) ? (row.events as Record<string, unknown>[]) : [],
    turnCount: typeof row.turnCount === "number" ? row.turnCount : 0,
    cancelled: row.cancelled === true,
  };
}

async function mergeInteractionRaw(
  interaction: InteractionRecord,
  patch: Record<string, unknown>,
  extra?: Partial<InteractionRecord>,
) {
  const latest = (await store.getInteraction(interaction.id)) ?? interaction;
  await store.updateInteraction(interaction.id, {
    ...extra,
    raw: {
      ...(latest.raw ?? {}),
      ...patch,
    },
  });
}

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
  result: Awaited<ReturnType<typeof import("@/lib/grafana-mcp").callGrafanaTool>>,
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

function liveGateReason() {
  const gemini = isGeminiConfigured();
  const mcp = isGrafanaMcpLive();
  if (!gemini && !mcp) {
    return "Gemini is not configured and Grafana MCP is not live — fixture path cannot auto-isolate.";
  }
  if (!gemini) {
    return "Gemini is not configured — isolate requires a live @google/adk LlmAgent.";
  }
  return "Grafana MCP is not live — fixture-only results cannot auto-isolate.";
}

async function markNeedsHuman(
  snapshot: IncidentSnapshot,
  actor: string,
  reason: string,
) {
  const interaction = snapshot.interaction;
  if (!interaction) return getSnapshot(snapshot.incident.id);
  await store.updateIncident(snapshot.incident.id, { status: "needs-human" });
  await store.setStep(interaction.id, "needs_human", "cancelled");
  await mergeInteractionRaw(interaction, { needsHumanReason: reason });
  await audit(snapshot.incident.id, actor, "needs-human", { reason });
  return getSnapshot(snapshot.incident.id);
}

function isTerminal(snapshot: IncidentSnapshot) {
  return (
    snapshot.incident.killed ||
    snapshot.incident.status === "resolved" ||
    snapshot.incident.status === "needs-human" ||
    snapshot.interaction?.step === "complete" ||
    snapshot.interaction?.step === "needs_human" ||
    snapshot.interaction?.status === "cancelled" ||
    snapshot.interaction?.status === "completed"
  );
}

export async function startNightPremiereIncident(source: "demo" | "webhook") {
  const payload = nightPremiereWebhookPayload();
  const incidentId = newId();
  const interactionId = newId();
  const now = nowIso();
  const live = isGeminiConfigured() && isGrafanaMcpLive();
  const reason = live ? null : liveGateReason();

  await store.createIncident({
    id: incidentId,
    grafanaIncidentId: null,
    alertName: payload.alerts[0]?.labels.alertname ?? "NightPremiereBufferRatio",
    showName: SHOW.name,
    region: SHOW.region,
    status: live ? "detecting" : "needs-human",
    onAir: true,
    suspectEdge: null,
    isolatePlan: null,
    killed: false,
    createdAt: now,
    updatedAt: now,
  });

  const adk = live ? createAdkSessionBlob() : null;
  const geminiId = adk?.sessionId ?? `local-${interactionId}`;

  await store.createInteraction({
    id: interactionId,
    incidentId,
    geminiInteractionId: geminiId,
    background: true,
    status: live ? "in_progress" : "cancelled",
    step: live ? "start" : "needs_human",
    lastPollAt: now,
    raw: {
      source,
      background: true,
      needsHumanReason: reason,
      adk: adk ?? undefined,
    },
    createdAt: now,
    updatedAt: now,
  });

  await audit(incidentId, source === "demo" ? "crew" : "grafana-webhook", "incident-opened", {
    show: SHOW.name,
    region: SHOW.region,
    onAir: true,
    live,
    reason,
  });

  if (reason) {
    await audit(incidentId, "playbook", "needs-human", { reason });
  }

  return getSnapshot(incidentId);
}

async function applyIsolateVerdict(snapshot: IncidentSnapshot, verdict: IsolateVerdict) {
  const interaction = snapshot.interaction;
  if (!interaction) return getSnapshot(snapshot.incident.id);

  if (verdictNeedsHuman(verdict)) {
    return markNeedsHuman(snapshot, "gemini", verdict.evidence || "Gemini confidence is needs-human.");
  }

  const liveMcp = snapshot.mcpTrace.some((entry) => entry.mode === "mcp");
  if (!liveMcp) {
    return markNeedsHuman(
      snapshot,
      "playbook",
      "No live Grafana MCP tool in the trace — fixture-only results cannot auto-isolate.",
    );
  }

  const gate = validateIsolate({
    suspectEdge: verdict.suspectEdge,
    simulated: verdict.action === "simulate-drain",
    killed: snapshot.incident.killed,
  });
  if (!gate.ok) {
    return markNeedsHuman(snapshot, "playbook", gate.reason);
  }

  const plan = gate.plan;
  const summary = `${verdict.evidence} Simulated drain to ${plan.drainTo.join(" / ")}.`;

  await store.createFinding({
    id: newId(),
    incidentId: snapshot.incident.id,
    suspectEdge: plan.suspectEdge,
    summary,
    confidence: verdict.confidence,
    evidence: {
      actor: "gemini",
      metrics: "cineops_buffer_ratio, cineops_origin_5xx, cineops_edge_latency",
      dashboard: interaction.raw?.dashboardUrl ?? null,
      qosRows: interaction.raw?.qosRows ?? null,
      qosMode: interaction.raw?.qosMode ?? null,
      verdict,
    },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  await store.updateIncident(snapshot.incident.id, {
    suspectEdge: plan.suspectEdge,
    isolatePlan: plan,
    status: "isolating",
  });
  await store.createAction({
    id: newId(),
    incidentId: snapshot.incident.id,
    type: "simulate-failover",
    status: "proposed",
    fromEdge: plan.suspectEdge,
    toEdges: plan.drainTo,
    operator: "gemini",
    detail: { auto: true, demo: true, simulated: true },
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  await audit(snapshot.incident.id, "gemini", "isolate-verdict", {
    ...plan,
    confidence: verdict.confidence,
    evidence: verdict.evidence,
  } as unknown as Record<string, unknown>);
  await store.setStep(interaction.id, "finding", "in_progress");

  return openIncidentThenSimulate((await getSnapshot(snapshot.incident.id)) ?? snapshot);
}

async function openIncidentThenSimulate(snapshot: IncidentSnapshot) {
  const interaction = snapshot.interaction;
  if (!interaction) return getSnapshot(snapshot.incident.id);
  if (snapshot.incident.killed) {
    return markNeedsHuman(snapshot, "playbook", "Kill switch engaged — failover blocked.");
  }
  if (!snapshot.findings[0]) {
    return markNeedsHuman(snapshot, "playbook", "No Gemini isolate finding — refusing auto-drain.");
  }

  if (!snapshot.incident.grafanaIncidentId) {
    const created = await createGrafanaIncident({
      title: `${SHOW.name} QoS — ${SHOW.region}`,
      severity: "major",
      body: `CineOps ADK session ${interaction.geminiInteractionId}. Suspect ${snapshot.incident.suspectEdge}.`,
    });
    await trace(snapshot.incident.id, created.tool, { title: `${SHOW.name} QoS` }, created);
    const grafanaId = extractIncidentId(created);
    if (grafanaId) {
      await store.updateIncident(snapshot.incident.id, { grafanaIncidentId: grafanaId });
      await updateGrafanaIncident(
        grafanaId,
        `Gemini isolate ${snapshot.incident.suspectEdge}. Session ${interaction.geminiInteractionId}.`,
      );
    }
    await store.setStep(interaction.id, "grafana_incident", "in_progress");
  }

  const next = (await getSnapshot(snapshot.incident.id)) ?? snapshot;
  if (next.incident.killed) {
    return markNeedsHuman(next, "playbook", "Kill switch engaged — failover blocked.");
  }
  await stepSimulate(next, "demo-auto");
  await stepResolve((await getSnapshot(snapshot.incident.id)) ?? next);
  return getSnapshot(snapshot.incident.id);
}

async function stepSimulate(snapshot: IncidentSnapshot, operator: string) {
  const interaction = snapshot.interaction;
  if (!interaction) return;
  if (snapshot.incident.killed) {
    throw new Error("Kill switch engaged — failover blocked.");
  }
  const edge = snapshot.incident.suspectEdge ?? snapshot.findings[0]?.suspectEdge;
  if (!edge) {
    throw new Error("No Gemini isolate edge — refusing simulated drain.");
  }
  const plan = drainPlan(edge);
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
  await store.setStep(interaction.id, "simulating", "in_progress");
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
  if (snapshot.interaction) {
    await store.setStep(snapshot.interaction.id, "complete", "completed");
  }
  await audit(snapshot.incident.id, "grafana-mcp", "incident-resolved", {
    grafanaIncidentId: grafanaId,
  });
}

/** One ADK turn (or post-verdict drain). GET must never call this. */
export async function tickIncident(id: string): Promise<IncidentSnapshot | null> {
  let snapshot = await getSnapshot(id);
  if (!snapshot?.interaction) return snapshot;
  if (isTerminal(snapshot)) return snapshot;

  const blob = adkFromRaw(snapshot.interaction.raw);
  if (blob?.cancelled) {
    return markNeedsHuman(snapshot, "crew", "ADK session cancelled.");
  }

  if (snapshot.findings.length > 0 && snapshot.incident.status === "isolating") {
    return openIncidentThenSimulate(snapshot);
  }

  if (!isGeminiConfigured() || !isGrafanaMcpLive()) {
    return markNeedsHuman(snapshot, "playbook", liveGateReason());
  }

  if (!blob) {
    return markNeedsHuman(snapshot, "playbook", "ADK session missing — cannot diagnose.");
  }

  if (blob.turnCount >= MAX_ADK_TURNS) {
    return markNeedsHuman(
      snapshot,
      "gemini",
      `No isolate verdict after ${MAX_ADK_TURNS} ADK turns.`,
    );
  }

  await store.updateIncident(snapshot.incident.id, { status: "diagnosing" });
  await store.setStep(snapshot.interaction.id, snapshot.interaction.step === "start" ? "alerts" : snapshot.interaction.step, "in_progress");

  const userMessage =
    blob.turnCount === 0
      ? [
          `Night Premiere is ON AIR in ${SHOW.region}.`,
          `Firing alert: ${snapshot.incident.alertName}.`,
          `Query Grafana MCP, then call submit_isolate_verdict or mark_needs_human.`,
          `Session ID: ${blob.sessionId}.`,
        ].join(" ")
      : "Continue one diagnostic step. Call more Grafana MCP tools, or submit_isolate_verdict / mark_needs_human now.";

  let turn;
  try {
    turn = await runCineopsAdkTurn({
      blob,
      userMessage,
      hooks: {
        onGrafanaTool: async (name, args, result) => {
          await trace(snapshot!.incident.id, name, args, result);
        },
      },
    });
  } catch (error) {
    return markNeedsHuman(
      snapshot,
      "gemini",
      error instanceof Error ? error.message : "ADK turn failed.",
    );
  }

  const qosPatch: Record<string, unknown> = {
    adk: turn.blob,
    geminiText: turn.geminiText || snapshot.interaction.raw?.geminiText,
  };
  if (turn.qosRows) {
    qosPatch.qosRows = turn.qosRows;
    qosPatch.qosMode = turn.qosMode;
  }
  if (turn.dashboardUrl) qosPatch.dashboardUrl = turn.dashboardUrl;

  await mergeInteractionRaw(snapshot.interaction, qosPatch, {
    geminiInteractionId: turn.blob.sessionId,
    lastPollAt: nowIso(),
  });

  snapshot = (await getSnapshot(id)) ?? snapshot;
  if (!snapshot.interaction) return snapshot;
  if (snapshot.incident.killed) {
    return markNeedsHuman(snapshot, "playbook", "Kill switch engaged — failover blocked.");
  }

  if (turn.needsHuman) {
    return markNeedsHuman(snapshot, "gemini", turn.needsHuman.reason);
  }
  if (turn.verdict) {
    return applyIsolateVerdict(snapshot, turn.verdict);
  }

  return getSnapshot(id);
}

export async function simulateFailover(incidentId: string, operator = "crew") {
  const snapshot = await getSnapshot(incidentId);
  if (!snapshot?.interaction) return null;
  if (snapshot.incident.killed) {
    throw new Error("Kill switch engaged — failover blocked.");
  }
  if (!snapshot.findings[0]) {
    throw new Error("No Gemini isolate verdict yet — refusing simulated drain.");
  }
  const gate = validateIsolate({
    suspectEdge: snapshot.findings[0].suspectEdge,
    simulated: true,
    killed: snapshot.incident.killed,
  });
  if (!gate.ok) {
    throw new Error(gate.reason);
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

  const blob = adkFromRaw(snapshot.interaction.raw);
  await mergeInteractionRaw(snapshot.interaction, {
    needsHumanReason: "Kill switch engaged — failover blocked.",
    adk: blob ? { ...blob, cancelled: true } : undefined,
  });

  await store.updateIncident(incidentId, {
    killed: true,
    status: "needs-human",
  });
  await store.setStep(snapshot.interaction.id, "needs_human", "cancelled");
  await audit(incidentId, operator, "kill-switch", {
    message: "ADK session cancelled. No failover. Incident marked needs-human.",
  });

  return getSnapshot(incidentId);
}

export { grafanaMode, geminiMode };
