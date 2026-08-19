export default function NotFound() {
  return (
    <div className="space-y-2">
      <h1 className="text-xl font-semibold">Incident not on this board</h1>
      <p className="text-sm text-muted-foreground">
        The Night Premiere rail does not have that incident. Return to the studio-ops console and run
        the demo.
      </p>
    </div>
  );
}
