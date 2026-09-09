import type { EdgeQos } from "@/lib/grafana-fixtures";
import { SHOW } from "@/lib/show";

function emptyEdgeQos(edge: string, metric: Record<string, unknown>): EdgeQos {
  return {
    edge,
    region: String(metric.region ?? SHOW.regionSlug),
    show: String(metric.show ?? SHOW.slug),
    bufferRatio: 0,
    origin5xx: 0,
    edgeLatencyMs: 0,
  };
}

function looksLikeEdgeQos(row: unknown): row is EdgeQos {
  return Boolean(row && typeof row === "object" && typeof (row as EdgeQos).edge === "string");
}

function promSampleValue(row: Record<string, unknown>): number {
  if (Array.isArray(row.value) && row.value.length >= 2) return Number(row.value[1]);
  if (Array.isArray(row.values) && row.values.length > 0) {
    const last = row.values[row.values.length - 1];
    if (Array.isArray(last) && last.length >= 2) return Number(last[1]);
  }
  return Number.NaN;
}

function applyPromMetric(target: EdgeQos, metricName: string, value: number) {
  if (!Number.isFinite(value)) return;
  if (metricName.includes("buffer_ratio")) target.bufferRatio = value;
  else if (metricName.includes("origin_5xx")) target.origin5xx = value;
  else if (metricName.includes("latency")) target.edgeLatencyMs = value;
}

export function mergeQosRows(existing: unknown[] | null | undefined, incoming: EdgeQos[]): EdgeQos[] {
  const byEdge = new Map<string, EdgeQos>();
  for (const row of existing ?? []) {
    if (looksLikeEdgeQos(row)) byEdge.set(row.edge, { ...row });
  }
  for (const row of incoming) {
    const current = byEdge.get(row.edge) ?? emptyEdgeQos(row.edge, row as unknown as Record<string, unknown>);
    if (row.bufferRatio) current.bufferRatio = row.bufferRatio;
    if (row.origin5xx) current.origin5xx = row.origin5xx;
    if (row.edgeLatencyMs) current.edgeLatencyMs = row.edgeLatencyMs;
    current.region = row.region || current.region;
    current.show = row.show || current.show;
    byEdge.set(row.edge, current);
  }
  return [...byEdge.values()];
}

function qosFromPromSeries(series: unknown[]): EdgeQos[] {
  const byEdge = new Map<string, EdgeQos>();
  for (const item of series) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    const metric =
      row.metric && typeof row.metric === "object" ? (row.metric as Record<string, unknown>) : {};
    const edge = String(metric.edge ?? "").trim();
    if (!edge) continue;
    const current = byEdge.get(edge) ?? emptyEdgeQos(edge, metric);
    applyPromMetric(current, String(metric.__name__ ?? ""), promSampleValue(row));
    byEdge.set(edge, current);
  }
  return [...byEdge.values()];
}

function qosFromUnknown(payload: unknown): EdgeQos[] {
  if (!payload) return [];
  if (Array.isArray(payload)) {
    if (payload.every(looksLikeEdgeQos)) return payload;
    return qosFromPromSeries(payload);
  }
  if (typeof payload !== "object") return [];
  const obj = payload as Record<string, unknown>;
  const nestedResult = obj.result;
  if (Array.isArray(nestedResult) && nestedResult.every(looksLikeEdgeQos)) return nestedResult;
  const structured = obj.structuredContent;
  if (structured && typeof structured === "object") {
    const fromStructured = qosFromUnknown(structured);
    if (fromStructured.length) return fromStructured;
  }
  const data = obj.data;
  if (Array.isArray(data)) return qosFromPromSeries(data);
  if (data && typeof data === "object") {
    const result = (data as { result?: unknown }).result;
    if (Array.isArray(result)) return qosFromPromSeries(result);
  }
  return [];
}

export function qosFromToolResult(result: { result: unknown }): EdgeQos[] {
  return qosFromUnknown(result.result);
}
