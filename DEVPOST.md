# Devpost — CineOps One (Grafana track)

Paste into the Devpost project form. Track: **Grafana**.

## Tagline

Grafana-powered Gemini agent that keeps live premieres on air.

## Built with

Next.js, Google Cloud / Gemini (`@google/genai` Interactions API), Grafana Cloud MCP (`mcp-grafana`), PostgreSQL (Neon), Drizzle, Tailwind, Shadcn.

## Description

CineOps One is a studio-ops console for live cinema and OTT broadcasts. When Grafana detects buffering or origin errors during a premiere, a Gemini agent on Google Cloud starts a **background** Interaction, queries **Grafana Cloud MCP** for metrics, logs, and traces, isolates the failing edge, and writes the outcome into a Grafana Incident so the broadcast crew is not stuck in a manual dashboard hunt.

### Features

- Live incident board mapped to Grafana alerts and Grafana Incidents
- Background Gemini Interaction (`background: true`) for multi-step diagnosis
- Direct Grafana MCP tool calls: alerts, Prometheus, Loki, dashboards, Incident create/update/resolve
- Isolate recommendation with a human kill switch
- Simulated drain only (no unsupervised CDN patching)
- Interaction IDs and snapshots stored in Postgres (Neon) or local file fallback

### Data sources

- Grafana Cloud (Prometheus/Loki-style metrics and logs, alert rules, Incident)
- Synthetic Night Premiere QoS series for the demo show (`cineops_*`)
- App metadata in PostgreSQL

### Findings and learnings

- One partner track is enough: Grafana MCP covers detect, diagnose, and close.
- Grafana Cloud AI Observability does not replace the MCP server connection.
- Background interactions matter; a single request/response cannot finish a real diagnostic loop.
- The crew needs Grafana Incident as the system of record, not only a chat transcript.
- Unsupervised live routing patches are unsafe for a broadcast demo; a simulated drain plus kill switch is the honest v1.
- Vercel serverless cannot spawn `uvx mcp-grafana`; production needs `GRAFANA_MCP_TRANSPORT=http` against a hosted MCP process.

## Submission checklist

- [x] Partner track = **Grafana**
- [x] Hosted project URL (Vercel) — https://cineops-one.vercel.app
- [x] Public GitHub with LICENSE — https://github.com/Mammajam/cineops-one
- [x] Runtime proof: `@google/genai` + Grafana MCP imports/calls (see README)
- [ ] Demo video ≤ 3 minutes, English, YouTube/Vimeo public, working product
- [x] Description includes findings/learnings (above)

## Demo video outline (≤3:00)

See README “3-minute demo script”. Film the running console — not a cinematic trailer.
