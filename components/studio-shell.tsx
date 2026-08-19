import type { ReactNode } from "react";
import { ShowChrome } from "@/components/show-chrome";

export function StudioShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col bg-[radial-gradient(circle_at_top,oklch(0.22_0.03_80)_0%,transparent_42%)]">
      <ShowChrome />
      <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col px-4 py-6">{children}</main>
    </div>
  );
}
