import { neon } from "@neondatabase/serverless";
import { desc, eq, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";
import type {
  ActionRecord,
  AgentStep,
  AuditEventRecord,
  FindingRecord,
  IncidentRecord,
  InteractionRecord,
  IsolatePlan,
  McpTraceEntry,
} from "./types";

function client() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  return drizzle(neon(url), { schema });
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : value;
}

function asDate(value: string | Date | null | undefined) {
  if (!value) return undefined;
  return value instanceof Date ? value : new Date(value);
}

function toDbPatch<T extends object>(patch: T) {
  const rest = { ...patch } as Record<string, unknown>;
  if ("createdAt" in rest) rest.createdAt = asDate(rest.createdAt as string);
  if ("updatedAt" in rest) rest.updatedAt = asDate(rest.updatedAt as string);
  if ("lastPollAt" in rest) rest.lastPollAt = asDate(rest.lastPollAt as string | null);
  return rest;
}

function mapIncident(row: typeof schema.incidents.$inferSelect): IncidentRecord {
  return {
    id: row.id,
    grafanaIncidentId: row.grafanaIncidentId,
    alertName: row.alertName,
    showName: row.showName,
    region: row.region,
    status: row.status as IncidentRecord["status"],
    onAir: row.onAir,
    suspectEdge: row.suspectEdge,
    isolatePlan: (row.isolatePlan as IsolatePlan | null) ?? null,
    killed: row.killed,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
  };
}

function mapInteraction(row: typeof schema.interactions.$inferSelect): InteractionRecord {
  return {
    id: row.id,
    incidentId: row.incidentId,
    geminiInteractionId: row.geminiInteractionId,
    background: row.background,
    status: row.status as InteractionRecord["status"],
    step: row.step as AgentStep,
    lastPollAt: iso(row.lastPollAt),
    raw: row.raw,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
  };
}

function mapFinding(row: typeof schema.findings.$inferSelect): FindingRecord {
  return {
    id: row.id,
    incidentId: row.incidentId,
    suspectEdge: row.suspectEdge,
    summary: row.summary,
    confidence: row.confidence,
    evidence: row.evidence,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
  };
}

function mapAction(row: typeof schema.actions.$inferSelect): ActionRecord {
  return {
    id: row.id,
    incidentId: row.incidentId,
    type: row.type as ActionRecord["type"],
    status: row.status as ActionRecord["status"],
    fromEdge: row.fromEdge,
    toEdges: row.toEdges,
    operator: row.operator,
    detail: row.detail,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
  };
}

function mapAudit(row: typeof schema.auditEvents.$inferSelect): AuditEventRecord {
  return {
    id: row.id,
    incidentId: row.incidentId,
    actor: row.actor,
    action: row.action,
    detail: row.detail,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
  };
}

function tracesFromRaw(raw: Record<string, unknown> | null): McpTraceEntry[] {
  const traces = raw?.mcpTrace;
  return Array.isArray(traces) ? (traces as McpTraceEntry[]) : [];
}

export const postgresStore = {
  async createIncident(row: IncidentRecord) {
    const db = client();
    const [created] = await db
      .insert(schema.incidents)
      .values({
        ...row,
        createdAt: asDate(row.createdAt),
        updatedAt: asDate(row.updatedAt),
      })
      .returning();
    return mapIncident(created);
  },
  async updateIncident(id: string, patch: Partial<IncidentRecord>) {
    const db = client();
    const [updated] = await db
      .update(schema.incidents)
      .set({ ...toDbPatch(patch), updatedAt: new Date() })
      .where(eq(schema.incidents.id, id))
      .returning();
    return updated ? mapIncident(updated) : null;
  },
  async getIncident(id: string) {
    const db = client();
    const [row] = await db.select().from(schema.incidents).where(eq(schema.incidents.id, id));
    return row ? mapIncident(row) : null;
  },
  async listIncidents() {
    const db = client();
    const rows = await db.select().from(schema.incidents).orderBy(desc(schema.incidents.createdAt));
    return rows.map(mapIncident);
  },
  async createInteraction(row: InteractionRecord) {
    const db = client();
    const [created] = await db
      .insert(schema.interactions)
      .values({
        ...row,
        lastPollAt: asDate(row.lastPollAt),
        createdAt: asDate(row.createdAt),
        updatedAt: asDate(row.updatedAt),
      })
      .returning();
    return mapInteraction(created);
  },
  async updateInteraction(id: string, patch: Partial<InteractionRecord>) {
    const db = client();
    const [updated] = await db
      .update(schema.interactions)
      .set({ ...toDbPatch(patch), updatedAt: new Date() })
      .where(eq(schema.interactions.id, id))
      .returning();
    return updated ? mapInteraction(updated) : null;
  },
  async getInteraction(id: string) {
    const db = client();
    const rows = await db
      .select()
      .from(schema.interactions)
      .where(
        or(eq(schema.interactions.id, id), eq(schema.interactions.geminiInteractionId, id)),
      );
    return rows[0] ? mapInteraction(rows[0]) : null;
  },
  async getInteractionByIncident(incidentId: string) {
    const db = client();
    const [row] = await db
      .select()
      .from(schema.interactions)
      .where(eq(schema.interactions.incidentId, incidentId));
    return row ? mapInteraction(row) : null;
  },
  async createFinding(row: FindingRecord) {
    const db = client();
    const [created] = await db
      .insert(schema.findings)
      .values({
        ...row,
        createdAt: asDate(row.createdAt),
        updatedAt: asDate(row.updatedAt),
      })
      .returning();
    return mapFinding(created);
  },
  async listFindings(incidentId: string) {
    const db = client();
    const rows = await db.select().from(schema.findings).where(eq(schema.findings.incidentId, incidentId));
    return rows.map(mapFinding);
  },
  async createAction(row: ActionRecord) {
    const db = client();
    const [created] = await db
      .insert(schema.actions)
      .values({
        ...row,
        createdAt: asDate(row.createdAt),
        updatedAt: asDate(row.updatedAt),
      })
      .returning();
    return mapAction(created);
  },
  async updateAction(id: string, patch: Partial<ActionRecord>) {
    const db = client();
    const [updated] = await db
      .update(schema.actions)
      .set({ ...toDbPatch(patch), updatedAt: new Date() })
      .where(eq(schema.actions.id, id))
      .returning();
    return updated ? mapAction(updated) : null;
  },
  async listActions(incidentId: string) {
    const db = client();
    const rows = await db.select().from(schema.actions).where(eq(schema.actions.incidentId, incidentId));
    return rows.map(mapAction);
  },
  async createAudit(row: AuditEventRecord) {
    const db = client();
    const [created] = await db
      .insert(schema.auditEvents)
      .values({
        ...row,
        createdAt: asDate(row.createdAt),
        updatedAt: asDate(row.updatedAt),
      })
      .returning();
    return mapAudit(created);
  },
  async listAudit(incidentId: string) {
    const db = client();
    const rows = await db
      .select()
      .from(schema.auditEvents)
      .where(eq(schema.auditEvents.incidentId, incidentId))
      .orderBy(schema.auditEvents.createdAt);
    return rows.map(mapAudit);
  },
  async appendMcpTrace(incidentId: string, entry: McpTraceEntry) {
    const db = client();
    const interaction = await this.getInteractionByIncident(incidentId);
    if (!interaction) return entry;
    const traces = tracesFromRaw(interaction.raw);
    traces.push(entry);
    await db
      .update(schema.interactions)
      .set({
        raw: { ...(interaction.raw ?? {}), mcpTrace: traces },
        updatedAt: new Date(),
      })
      .where(eq(schema.interactions.id, interaction.id));
    return entry;
  },
  async listMcpTrace(incidentId: string) {
    const interaction = await this.getInteractionByIncident(incidentId);
    return tracesFromRaw(interaction?.raw ?? null);
  },
  async setStep(interactionId: string, step: AgentStep, status?: InteractionRecord["status"]) {
    const db = client();
    const [updated] = await db
      .update(schema.interactions)
      .set({
        step,
        ...(status ? { status } : {}),
        lastPollAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.interactions.id, interactionId))
      .returning();
    return updated ? mapInteraction(updated) : null;
  },
};
