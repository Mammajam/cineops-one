# Devpost — CineOps One (Grafana track)

Paste into the Devpost project form. Track: **Grafana**.

## Tagline

Grafana-powered Gemini agent that keeps live premieres on air.

## Built with

Next.js, Google Cloud / Gemini 3.5 Flash (`@google/adk` `LlmAgent`, `@google/genai` model backend), Grafana Cloud MCP (`mcp-grafana`), PostgreSQL (Neon), Drizzle, Tailwind, Shadcn.

## Inspiration for this project

A live cinema premiere has one job: stay on air. Buffering, origin 5xx, or a bad edge during Night Premiere is not a generic cluster incident — it is a show that millions of people are watching *right now*. Studio crews already live in Grafana for QoS, but diagnosis still jumps between dashboards, logs, and a paging channel, and the unsafe instinct is to auto-patch CDN routing.

We wanted a console that looks like a broadcast board (**Night Premiere · EU-West · ON AIR**), not another ops dashboard. Grafana should detect. Gemini should read the live evidence and own the isolate. The playbook should only say whether that action is safe enough to simulate. The system of record should be a Grafana Incident, not a chat transcript.

## What the project does.

CineOps One is a studio-ops console for a live premiere. When Grafana fires a Night Premiere QoS alert (buffer ratio and origin 5xx), a Gemini **3.5 Flash** `@google/adk` `LlmAgent` chooses Grafana Cloud MCP tools, reads alerts / Prometheus / Loki / dashboards, and returns an **isolate verdict**. The playbook then gates on-air safety: only `eu-west-edge-*`, simulated drain only, kill switch honored. A successful run writes the outcome into a Grafana Incident.

The playbook never picks the failing edge. Fixture-only MCP, missing Gemini, low confidence, or a playbook refuse becomes **`needs-human`** — never a fake high-confidence isolate. The crew can still click through the Night Premiere path; the board just refuses to pretend it isolated live.

## How the project was built.

Crew UI is Next.js (App Router) + React, Tailwind, and shadcn — a dark cinema-ops shell with an incident board, MCP tool trace, kill switch, and Grafana dashboard deeplink. Session snapshots live in Neon Postgres (Drizzle) with a file-store fallback.

Diagnosis is Google-only: `@google/adk` `LlmAgent` + `@google/genai` on **Gemini 3.5 Flash** (API key or Vertex). Grafana MCP tools are wrapped as ADK `FunctionTool`s so Gemini chooses them. The agent finishes with `submit_isolate_verdict` or `mark_needs_human`.

Observability is Grafana-only: official `mcp-grafana` over stdio locally or Streamable HTTP in production (`alerting_manage_rules`, `query_prometheus`, `query_loki_logs`, `search_dashboards`, `create_incident`, `add_activity_to_incident`). Seed scripts upsert the Night Premiere dashboard/alert; `push:qos` writes synthetic `cineops_*` series. The tick API is POST-one-turn / GET-snapshot-only so polling cannot advance the agent.

## Challenges we experienced in the project.

Honest isolate was harder than a pretty console. A hardcoded `eu-west-edge-3` would demo well and fail the track. We had to make Gemini own the edge from PromQL/Loki, and treat fixture MCP as a labeled click-path that stops at `needs-human`.

Vercel cannot spawn `uvx mcp-grafana`. Production needs `GRAFANA_MCP_TRANSPORT=http` against a hosted Streamable HTTP MCP process, and we fail closed if that URL is missing — no localhost fallback on serverless.

Concurrent GET polls were advancing the agent. We serialized ticks with compare-and-set: GET is snapshot-only; POST is one ADK turn. Grafana Cloud AI Observability also does not replace a live MCP connection. And unsupervised CDN patches are unsafe for a broadcast demo, so v1 is simulated drain plus a kill switch — not a live routing write.

## Accomplishments that we're proud of for this project.

We shipped a Grafana-track product that refuses to fake the win. Live isolate requires live Grafana MCP **and** Gemini. The chrome says ON AIR. The MCP trace shows `mode=mcp`. The isolate line comes from the data. The playbook only gates. Grafana Incident is where the run is recorded and resolved, with the ADK session ID on the activity.

We are also proud of the boring safety: EU-West allowlist, simulated-only drain, kill switch → `needs-human`, and a demo that still works when keys are missing without lying about confidence.

## What we learned in terms of the Grafana Track.

One partner track is enough. Grafana MCP covers detect, diagnose, and close: alerting, Prometheus, Loki, dashboards, and Incident. We did not need a second observability vendor.

The crew needs Grafana Incident as the system of record, not only a model transcript. Tool traces with `mode=mcp` vs fixture are what make a judge (and a studio operator) trust the run. Grafana Cloud UI is not the MCP server — the agent has to call `mcp-grafana`. Bounded action (`eu-west-edge-*` only) is a feature of the track, not a missing feature of the demo.

## What's next for CineOps One in terms of scale in the future.

v1 is one show, one region, three edges, simulated drain. Next is more premieres and regions with the same gate: Gemini still owns the isolate; playbooks stay allowlisted per show.

Scale also means a always-on hosted `mcp-grafana` (Cloud Run / Fly) so every Vercel isolate is live MCP, not a laptop `uvx`. We want richer Grafana IRM (severity, roles, post-incident review) and multi-edge evidence packs that stay in the Incident timeline. Live CDN drain stays behind a human-armed control — the honest next step is a supervised, region-scoped action, not unsupervised routing at premiere scale.

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
