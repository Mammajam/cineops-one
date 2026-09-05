import { EDGES } from "@/lib/show";
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
  const drainTo = EDGES.filter((item) => item !== edge);
  return {
    suspectEdge: edge,
    drainTo,
    reason: `Simulated drain of ${edge} to ${drainTo.join(" / ")}. No live CDN patch.`,
    simulated: true,
  };
}

export type IsolateValidation =
  | { ok: true; plan: IsolatePlan }
  | { ok: false; reason: string };

export function validateIsolate(input: {
  suspectEdge: string;
  simulated?: boolean;
  killed?: boolean;
}): IsolateValidation {
  if (input.killed) {
    return { ok: false, reason: "Kill switch engaged — failover blocked." };
  }
  if (input.simulated === false) {
    return { ok: false, reason: "Playbook refused: only a simulated drain is allowed." };
  }
  try {
    const plan = drainPlan(input.suspectEdge);
    return { ok: true, plan };
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : "Playbook refused isolate.",
    };
  }
}
