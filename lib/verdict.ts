import { z } from "zod";

export const isolateVerdictSchema = z.object({
  suspectEdge: z.string().min(1),
  confidence: z.enum(["high", "medium", "low", "needs-human"]),
  evidence: z.string().min(1),
  action: z.enum(["simulate-drain", "needs-human"]),
});

export type IsolateVerdict = z.infer<typeof isolateVerdictSchema>;

export function parseIsolateVerdict(raw: unknown): IsolateVerdict | null {
  const parsed = isolateVerdictSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function verdictNeedsHuman(verdict: IsolateVerdict) {
  return verdict.confidence === "needs-human" || verdict.action === "needs-human";
}
