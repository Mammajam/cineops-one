import { boolean, index, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const incidents = pgTable(
  "incidents",
  {
    id: text("id").primaryKey(),
    grafanaIncidentId: text("grafana_incident_id"),
    alertName: text("alert_name").notNull(),
    showName: text("show_name").notNull(),
    region: text("region").notNull(),
    status: text("status").notNull(),
    onAir: boolean("on_air").notNull().default(true),
    suspectEdge: text("suspect_edge"),
    isolatePlan: jsonb("isolate_plan").$type<Record<string, unknown> | null>(),
    killed: boolean("killed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("incidents_status_idx").on(table.status),
    index("incidents_show_idx").on(table.showName),
  ],
);

export const interactions = pgTable(
  "interactions",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id),
    geminiInteractionId: text("gemini_interaction_id").notNull(),
    background: boolean("background").notNull().default(true),
    status: text("status").notNull(),
    step: text("step").notNull().default("start"),
    lastPollAt: timestamp("last_poll_at", { withTimezone: true }),
    raw: jsonb("raw").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("interactions_incident_idx").on(table.incidentId),
    index("interactions_gemini_idx").on(table.geminiInteractionId),
  ],
);

export const findings = pgTable(
  "findings",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id),
    suspectEdge: text("suspect_edge").notNull(),
    summary: text("summary").notNull(),
    confidence: text("confidence").notNull(),
    evidence: jsonb("evidence").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("findings_incident_idx").on(table.incidentId)],
);

export const actions = pgTable(
  "actions",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id),
    type: text("type").notNull(),
    status: text("status").notNull(),
    fromEdge: text("from_edge"),
    toEdges: jsonb("to_edges").$type<string[]>(),
    operator: text("operator").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("actions_incident_idx").on(table.incidentId)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    incidentId: text("incident_id")
      .notNull()
      .references(() => incidents.id),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    detail: jsonb("detail").$type<Record<string, unknown> | null>(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("audit_events_incident_idx").on(table.incidentId)],
);
