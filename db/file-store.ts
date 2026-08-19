import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type {
  ActionRecord,
  AgentStep,
  AuditEventRecord,
  FindingRecord,
  IncidentRecord,
  InteractionRecord,
  McpTraceEntry,
} from "./types";

type FileDb = {
  incidents: IncidentRecord[];
  interactions: InteractionRecord[];
  findings: FindingRecord[];
  actions: ActionRecord[];
  auditEvents: AuditEventRecord[];
  mcpTraces: Record<string, McpTraceEntry[]>;
};

const DATA_PATH = path.join(process.cwd(), ".data", "cineops.json");

let queue: Promise<void> = Promise.resolve();

function emptyDb(): FileDb {
  return {
    incidents: [],
    interactions: [],
    findings: [],
    actions: [],
    auditEvents: [],
    mcpTraces: {},
  };
}

async function readDb(): Promise<FileDb> {
  try {
    const raw = await readFile(DATA_PATH, "utf8");
    return { ...emptyDb(), ...JSON.parse(raw) } as FileDb;
  } catch {
    return emptyDb();
  }
}

async function writeDb(db: FileDb): Promise<void> {
  await mkdir(path.dirname(DATA_PATH), { recursive: true });
  await writeFile(DATA_PATH, JSON.stringify(db, null, 2), "utf8");
}

function mutate<T>(fn: (db: FileDb) => T | Promise<T>): Promise<T> {
  const run = queue.then(async () => {
    const db = await readDb();
    const result = await fn(db);
    await writeDb(db);
    return result;
  });
  queue = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export const fileStore = {
  async createIncident(row: IncidentRecord) {
    return mutate((db) => {
      db.incidents.unshift(row);
      return row;
    });
  },
  async updateIncident(id: string, patch: Partial<IncidentRecord>) {
    return mutate((db) => {
      const row = db.incidents.find((item) => item.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updatedAt: new Date().toISOString() });
      return row;
    });
  },
  async getIncident(id: string) {
    const db = await readDb();
    return db.incidents.find((item) => item.id === id) ?? null;
  },
  async listIncidents() {
    const db = await readDb();
    return [...db.incidents].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  },
  async createInteraction(row: InteractionRecord) {
    return mutate((db) => {
      db.interactions.unshift(row);
      return row;
    });
  },
  async updateInteraction(id: string, patch: Partial<InteractionRecord>) {
    return mutate((db) => {
      const row = db.interactions.find((item) => item.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updatedAt: new Date().toISOString() });
      return row;
    });
  },
  async getInteraction(id: string) {
    const db = await readDb();
    return (
      db.interactions.find(
        (item) => item.id === id || item.geminiInteractionId === id,
      ) ?? null
    );
  },
  async getInteractionByIncident(incidentId: string) {
    const db = await readDb();
    return db.interactions.find((item) => item.incidentId === incidentId) ?? null;
  },
  async createFinding(row: FindingRecord) {
    return mutate((db) => {
      db.findings.unshift(row);
      return row;
    });
  },
  async listFindings(incidentId: string) {
    const db = await readDb();
    return db.findings.filter((item) => item.incidentId === incidentId);
  },
  async createAction(row: ActionRecord) {
    return mutate((db) => {
      db.actions.unshift(row);
      return row;
    });
  },
  async updateAction(id: string, patch: Partial<ActionRecord>) {
    return mutate((db) => {
      const row = db.actions.find((item) => item.id === id);
      if (!row) return null;
      Object.assign(row, patch, { updatedAt: new Date().toISOString() });
      return row;
    });
  },
  async listActions(incidentId: string) {
    const db = await readDb();
    return db.actions.filter((item) => item.incidentId === incidentId);
  },
  async createAudit(row: AuditEventRecord) {
    return mutate((db) => {
      db.auditEvents.unshift(row);
      return row;
    });
  },
  async listAudit(incidentId: string) {
    const db = await readDb();
    return db.auditEvents
      .filter((item) => item.incidentId === incidentId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  },
  async appendMcpTrace(incidentId: string, entry: McpTraceEntry) {
    return mutate((db) => {
      db.mcpTraces[incidentId] = db.mcpTraces[incidentId] ?? [];
      db.mcpTraces[incidentId].push(entry);
      return entry;
    });
  },
  async listMcpTrace(incidentId: string) {
    const db = await readDb();
    return db.mcpTraces[incidentId] ?? [];
  },
  async setStep(interactionId: string, step: AgentStep, status?: InteractionRecord["status"]) {
    return mutate((db) => {
      const row = db.interactions.find((item) => item.id === interactionId);
      if (!row) return null;
      row.step = step;
      row.lastPollAt = new Date().toISOString();
      if (status) row.status = status;
      row.updatedAt = new Date().toISOString();
      return row;
    });
  },
};
