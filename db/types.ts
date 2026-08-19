export type IncidentStatus =
  | "detecting"
  | "diagnosing"
  | "isolating"
  | "resolved"
  | "needs-human";

export type InteractionStatus =
  | "queued"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "failed";

export type AgentStep =
  | "start"
  | "alerts"
  | "metrics"
  | "logs"
  | "dashboards"
  | "finding"
  | "grafana_incident"
  | "awaiting_failover"
  | "simulating"
  | "resolving"
  | "complete"
  | "needs_human";

export type ActionType = "simulate-failover" | "kill";
export type ActionStatus = "proposed" | "simulated" | "blocked" | "cancelled";

export type IsolatePlan = {
  suspectEdge: string;
  drainTo: string[];
  reason: string;
  simulated: boolean;
};

export type IncidentRecord = {
  id: string;
  grafanaIncidentId: string | null;
  alertName: string;
  showName: string;
  region: string;
  status: IncidentStatus;
  onAir: boolean;
  suspectEdge: string | null;
  isolatePlan: IsolatePlan | Record<string, unknown> | null;
  killed: boolean;
  createdAt: string;
  updatedAt: string;
};

export type InteractionRecord = {
  id: string;
  incidentId: string;
  geminiInteractionId: string;
  background: boolean;
  status: InteractionStatus;
  step: AgentStep;
  lastPollAt: string | null;
  raw: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type FindingRecord = {
  id: string;
  incidentId: string;
  suspectEdge: string;
  summary: string;
  confidence: string;
  evidence: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type ActionRecord = {
  id: string;
  incidentId: string;
  type: ActionType;
  status: ActionStatus;
  fromEdge: string | null;
  toEdges: string[] | null;
  operator: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type AuditEventRecord = {
  id: string;
  incidentId: string;
  actor: string;
  action: string;
  detail: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
};

export type McpTraceEntry = {
  at: string;
  tool: string;
  mode: "mcp" | "fixture";
  args: Record<string, unknown>;
  result: unknown;
  label?: string;
};

export type IncidentSnapshot = {
  incident: IncidentRecord;
  interaction: InteractionRecord | null;
  findings: FindingRecord[];
  actions: ActionRecord[];
  auditEvents: AuditEventRecord[];
  mcpTrace: McpTraceEntry[];
  grafanaMode: "mcp" | "fixture";
  geminiMode: "live" | "local-playbook";
};
