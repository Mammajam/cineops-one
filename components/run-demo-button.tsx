"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import type { IncidentSnapshot } from "@/db/types";

export function RunDemoButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run() {
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/demo/run", { method: "POST" });
      if (!response.ok) throw new Error("Demo start failed");
      const snapshot = (await response.json()) as IncidentSnapshot;
      router.push(`/incidents/${snapshot.incident.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Demo start failed");
      setPending(false);
    }
  }

  return (
    <div className="flex flex-col items-start gap-2">
      <Button size="lg" onClick={run} disabled={pending}>
        {pending ? "Opening Night Premiere…" : "Run Night Premiere incident"}
      </Button>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
