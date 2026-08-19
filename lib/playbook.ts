import { DRAIN_TARGETS, EDGES, SUSPECT_EDGE } from "@/lib/show";
import type { IsolatePlan } from "@/db/types";

const ALLOWED = new Set<string>(EDGES);

export function assertEuWestEdge(edge: string) {
  if (!ALLOWED.has(edge)) {
    throw new Error(
      `Playbook refused: ${edge} is outside eu-west-edge-*. CineOps One only acts on Night Premiere EU-West edges.`,
    );
  }
  return edge;
}

export function drainPlan(fromEdge: string): IsolatePlan {
  const edge = assertEuWestEdge(fromEdge);
  if (edge !== SUSPECT_EDGE) {
    throw new Error(`Playbook refused: isolate is bounded to ${SUSPECT_EDGE} for this demo.`);
  }
  return {
    suspectEdge: edge,
    drainTo: [...DRAIN_TARGETS],
    reason:
      "Outlier buffer ratio, origin 5xx, and edge latency on eu-west-edge-3. Simulated drain to eu-west-edge-1/2. No live CDN patch.",
    simulated: true,
  };
}

export function pickSuspectEdge(series: { edge: string; bufferRatio: number; origin5xx: number }[]) {
  const ranked = series
    .filter((row) => ALLOWED.has(row.edge))
    .sort((a, b) => b.bufferRatio + b.origin5xx - (a.bufferRatio + a.origin5xx));
  const top = ranked[0]?.edge ?? SUSPECT_EDGE;
  return assertEuWestEdge(top);
}
