import { fileStore } from "./file-store";
import { postgresStore } from "./postgres";
import type { IncidentSnapshot } from "./types";
import { isGeminiConfigured } from "@/lib/gemini";
import { isGrafanaMcpLive } from "@/lib/grafana-mcp";

function hasPostgres() {
  const url = process.env.DATABASE_URL ?? "";
  return url.startsWith("postgres://") || url.startsWith("postgresql://");
}

let usePostgres = hasPostgres();
let warned = false;

async function withStore<T>(fn: (store: typeof fileStore) => Promise<T>): Promise<T> {
  if (usePostgres) {
    try {
      return await fn(postgresStore as unknown as typeof fileStore);
    } catch (error) {
      if (!warned) {
        console.warn(
          "[cineops] Neon/Postgres unavailable — falling back to local file store (.data/cineops.json)",
          error instanceof Error ? error.message : error,
        );
        warned = true;
      }
      usePostgres = false;
    }
  }
  return fn(fileStore);
}

export const store = {
  createIncident: (row: Parameters<typeof fileStore.createIncident>[0]) =>
    withStore((s) => s.createIncident(row)),
  updateIncident: (id: string, patch: Parameters<typeof fileStore.updateIncident>[1]) =>
    withStore((s) => s.updateIncident(id, patch)),
  getIncident: (id: string) => withStore((s) => s.getIncident(id)),
  listIncidents: () => withStore((s) => s.listIncidents()),
  createInteraction: (row: Parameters<typeof fileStore.createInteraction>[0]) =>
    withStore((s) => s.createInteraction(row)),
  updateInteraction: (id: string, patch: Parameters<typeof fileStore.updateInteraction>[1]) =>
    withStore((s) => s.updateInteraction(id, patch)),
  getInteraction: (id: string) => withStore((s) => s.getInteraction(id)),
  getInteractionByIncident: (incidentId: string) =>
    withStore((s) => s.getInteractionByIncident(incidentId)),
  createFinding: (row: Parameters<typeof fileStore.createFinding>[0]) =>
    withStore((s) => s.createFinding(row)),
  listFindings: (incidentId: string) => withStore((s) => s.listFindings(incidentId)),
  createAction: (row: Parameters<typeof fileStore.createAction>[0]) =>
    withStore((s) => s.createAction(row)),
  updateAction: (id: string, patch: Parameters<typeof fileStore.updateAction>[1]) =>
    withStore((s) => s.updateAction(id, patch)),
  listActions: (incidentId: string) => withStore((s) => s.listActions(incidentId)),
  createAudit: (row: Parameters<typeof fileStore.createAudit>[0]) =>
    withStore((s) => s.createAudit(row)),
  listAudit: (incidentId: string) => withStore((s) => s.listAudit(incidentId)),
  appendMcpTrace: (incidentId: string, entry: Parameters<typeof fileStore.appendMcpTrace>[1]) =>
    withStore((s) => s.appendMcpTrace(incidentId, entry)),
  listMcpTrace: (incidentId: string) => withStore((s) => s.listMcpTrace(incidentId)),
  setStep: (
    interactionId: string,
    step: Parameters<typeof fileStore.setStep>[1],
    status?: Parameters<typeof fileStore.setStep>[2],
  ) => withStore((s) => s.setStep(interactionId, step, status)),
  tryBeginTick: (interactionId: string) => withStore((s) => s.tryBeginTick(interactionId)),
  endTick: (interactionId: string) => withStore((s) => s.endTick(interactionId)),
  dbMode: () => (usePostgres ? "neon" : "file"),
};

export async function getSnapshot(incidentId: string): Promise<IncidentSnapshot | null> {
  const incident = await store.getIncident(incidentId);
  if (!incident) return null;
  const [interaction, findings, actions, auditEvents, mcpTrace] = await Promise.all([
    store.getInteractionByIncident(incidentId),
    store.listFindings(incidentId),
    store.listActions(incidentId),
    store.listAudit(incidentId),
    store.listMcpTrace(incidentId),
  ]);
  return {
    incident,
    interaction,
    findings,
    actions,
    auditEvents,
    mcpTrace,
    grafanaMode: isGrafanaMcpLive() ? "mcp" : "fixture",
    geminiMode: isGeminiConfigured() ? "live" : "local-playbook",
  };
}

export function newId() {
  return crypto.randomUUID();
}

export function nowIso() {
  return new Date().toISOString();
}
