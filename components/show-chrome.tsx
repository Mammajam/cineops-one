import { SHOW } from "@/lib/show";

export function ShowChrome() {
  return (
    <header className="border-b border-border bg-card/80 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 py-3">
        <div className="flex items-baseline gap-3">
          <span className="font-mono text-[11px] tracking-[0.22em] text-primary">
            CINEOPS ONE
          </span>
          <span className="text-xs text-muted-foreground">studio-ops · crew mode</span>
        </div>
        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-foreground">
          <span>{SHOW.name}</span>
          <span className="text-muted-foreground">·</span>
          <span>{SHOW.region}</span>
          <span className="text-muted-foreground">·</span>
          <span className="inline-flex items-center gap-2 text-destructive">
            <span className="on-air-dot size-2 rounded-full bg-destructive" />
            ON AIR
          </span>
        </div>
      </div>
    </header>
  );
}
