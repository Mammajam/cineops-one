# Devpost — CineOps One (Grafana track)

Paste into the Devpost project form. Track: **Grafana**.

## Tagline

Grafana-powered Gemini agent that keeps live premieres on air.

## Built with

Next.js, Google Cloud / Gemini (`@google/adk` `LlmAgent`, `@google/genai` model backend), Grafana Cloud MCP (`mcp-grafana`), PostgreSQL (Neon), Drizzle, Tailwind, Shadcn.

## Description

CineOps One is a studio-ops console for live cinema and OTT broadcasts. When Grafana detects buffering or origin errors during a premiere, a Gemini **`LlmAgent`** on Google ADK queries **Grafana Cloud MCP** for metrics, logs, and dashboards, **returns the isolate verdict**, and the playbook only gates on-air safety (EU-West edges, simulated drain, kill switch) before writing the outcome into a Grafana Incident.

The playbook does not pick the failing edge. Fixture-only MCP is not an isolate win — that path is **`needs-human`**.

### Features

- Live incident board mapped to Grafana alerts and Grafana Incidents
- `@google/adk` `LlmAgent` that **chooses** Grafana MCP tools and calls `submit_isolate_verdict` or `mark_needs_human`
- Direct Grafana MCP tool calls: alerts, Prometheus, Loki, dashboards, Incident create/update/resolve
- Playbook is an on-air gate only (allowlisted EU-West edges, simulated drain, kill switch)
- Simulated drain only (no unsupervised CDN patching)
- ADK session IDs and snapshots stored in Postgres (Neon) or local file fallback

### Data sources

- Grafana Cloud (Prometheus/Loki-style metrics and logs, alert rules, Incident)
- Synthetic Night Premiere QoS series for the demo show (`cineops_*`)
- App metadata in PostgreSQL

### Findings and learnings

- One partner track is enough: Grafana MCP covers detect, diagnose, and close.
- Grafana Cloud AI Observability does not replace the MCP server connection.
- Gemini must own the isolate verdict; a hardcoded playbook edge is a fake win.
- Fixture MCP is useful for a click-path, but it must stop at `needs-human`.
- The crew needs Grafana Incident as the system of record, not only a chat transcript.
- Unsupervised live routing patches are unsafe for a broadcast demo; a simulated drain plus kill switch is the honest v1.
- Vercel serverless cannot spawn `uvx mcp-grafana`; production needs `GRAFANA_MCP_TRANSPORT=http` against a hosted Streamable HTTP MCP process.
- Concurrent GET polls must not advance the agent; serialize ticks with compare-and-set.

## Submission checklist

- [x] Partner track = **Grafana**
- [x] Hosted project URL (Vercel) — https://cineops-one.vercel.app
- [x] Public GitHub with LICENSE — https://github.com/Mammajam/cineops-one
- [x] Runtime proof: `@google/adk` `LlmAgent` + Grafana MCP imports/calls (see README)
- [ ] Demo video ≤ 3 minutes, English, YouTube/Vimeo public, working product
- [x] Description includes findings/learnings (above)

## Demo video outline (≤3:00)

See README “3-minute demo script”. Film the running console — not a cinematic trailer. Point at the ADK session ID, `mode=mcp` traces, and the Gemini isolate line. Only mention fixture if it happened (then the status must be `needs-human`).
