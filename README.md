# CineOps One

Studio-ops console for a live cinema premiere. Grafana fires a QoS alert; a Gemini **`@google/adk` `LlmAgent`** chooses **Grafana Cloud MCP** tools, returns an isolate verdict, and the playbook gates a **simulated** drain into a Grafana Incident.

Gemini owns diagnosis. The playbook never picks the edge. Fixture-only MCP, low confidence, or a playbook refuse becomes **`needs-human`** — never a fake high-confidence isolate.

**Track:** Grafana only. **AI:** Google ADK / Gemini (`@google/adk`, `@google/genai`) only. No ClickHouse, Parallel, Replit, IBM, OpenAI, Anthropic, or Vercel AI SDK as the agent runtime.

Devpost paste-ready copy: [DEVPOST.md](DEVPOST.md).

## Hosted URL

**Production:** [https://cineops-one.vercel.app](https://cineops-one.vercel.app)

**Public repo:** [https://github.com/Mammajam/cineops-one](https://github.com/Mammajam/cineops-one)

Redeploy after env changes:

```powershell
npx vercel env pull .env.local
npx vercel --prod
```

**Serverless note:** Vercel cannot spawn `uvx mcp-grafana`. For production MCP:

1. Run `npm run mcp:grafana` (or host `mcp-grafana` on Cloud Run / Fly) with Streamable HTTP on `/mcp`.
2. Set `GRAFANA_MCP_TRANSPORT=http` and `GRAFANA_MCP_URL=https://your-mcp-host/mcp`.

A **successful isolate** requires live Grafana MCP **and** Gemini. Without those keys the click-path still opens Night Premiere, but the incident is labeled **`needs-human`** (fixture is not an isolate win).

## Run locally

```powershell
cd cineops-one
copy .env.example .env.local
# Fill DATABASE_URL (Neon). For a successful isolate: GEMINI_API_KEY + Grafana keys + GRAFANA_MCP_TRANSPORT=http.
npm install
npm run db:push
npm run seed:grafana
npm run push:qos
npm run mcp:grafana
# other terminal:
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Chrome should read **Night Premiere · EU-West · ON AIR**. Click **Run Night Premiere incident**.

Local with HTTP MCP: `GRAFANA_MCP_TRANSPORT=http` and `GRAFANA_MCP_URL=http://127.0.0.1:8000/mcp` while `npm run mcp:grafana` is running.

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon Postgres. File store fallback if missing/unreachable. |
| `GEMINI_API_KEY` | Gemini API key for `@google/adk` `LlmAgent`. `needs-human` if missing. |
| `GOOGLE_GENAI_USE_VERTEXAI` | `true` to use Vertex instead of an API key |
| `GOOGLE_CLOUD_PROJECT` | Vertex project (required with Vertex) |
| `GOOGLE_CLOUD_LOCATION` | Vertex location (required with Vertex) |
| `GRAFANA_URL` | Grafana Cloud instance URL (UI / API base) |
| `GRAFANA_SERVICE_ACCOUNT_TOKEN` | Service account token for `mcp-grafana` (Editor+) |
| `GRAFANA_MCP_TRANSPORT` | `stdio` (local `uvx mcp-grafana`) or `http` (hosted MCP) |
| `GRAFANA_MCP_URL` | Streamable HTTP MCP endpoint when transport is `http`. **Required in http mode** — no localhost fallback on Vercel. |
| `GRAFANA_METRICS_WRITE_URL` | Grafana Cloud Influx/Prometheus write URL for `npm run push:qos` |
| `GRAFANA_METRICS_USER` / `GRAFANA_METRICS_PASSWORD` | Optional basic auth for metrics write |

`npm run seed:grafana` upserts the Night Premiere dashboard/alert (safe no-op without Grafana env).  
`npm run push:qos` writes `cineops_*` samples (edge-3 is the usual demo outlier; Gemini still owns the verdict).  
`npm run mcp:grafana` starts official `mcp-grafana` over Streamable HTTP (`/mcp`).

## Runtime proof (file:line)

Google ADK `LlmAgent` (Gemini chooses MCP tools + isolate verdict):

- Import `@google/adk` `LlmAgent` / `FunctionTool` / `Runner`: [`lib/cineops-agent.ts:8`](lib/cineops-agent.ts)–[`lib/cineops-agent.ts:16`](lib/cineops-agent.ts)
- Grafana MCP wrappers as `FunctionTool`s: [`lib/cineops-agent.ts:161`](lib/cineops-agent.ts)
- `submit_isolate_verdict` / `mark_needs_human`: [`lib/cineops-agent.ts:225`](lib/cineops-agent.ts)–[`lib/cineops-agent.ts:247`](lib/cineops-agent.ts)
- `new LlmAgent` + one-turn `Runner.runAsync`: [`lib/cineops-agent.ts:250`](lib/cineops-agent.ts)–[`lib/cineops-agent.ts:272`](lib/cineops-agent.ts)
- Tick loop + playbook gate: [`lib/agent-loop.ts`](lib/agent-loop.ts)

Official Grafana MCP (`mcp-grafana` via MCP SDK):

- Import MCP client + stdio/HTTP transports: [`lib/grafana-mcp.ts:12`](lib/grafana-mcp.ts)–[`lib/grafana-mcp.ts:14`](lib/grafana-mcp.ts)
- Fail closed when `GRAFANA_MCP_TRANSPORT=http` and URL is missing: [`lib/grafana-mcp.ts:40`](lib/grafana-mcp.ts)–[`lib/grafana-mcp.ts:52`](lib/grafana-mcp.ts)
- Spawn `uvx mcp-grafana`: [`lib/grafana-mcp.ts:94`](lib/grafana-mcp.ts)
- Streamable HTTP helper: [`scripts/run-mcp-grafana-http.mjs:36`](scripts/run-mcp-grafana-http.mjs)
- `client.callTool`: [`lib/grafana-mcp.ts:151`](lib/grafana-mcp.ts)
- Tools used: `alerting_manage_rules`, `query_prometheus`, `query_loki_logs`, `search_dashboards`, `create_incident`, `add_activity_to_incident`

Playbook is an on-air **gate** only (EU-West allowlist + simulated drain): [`lib/playbook.ts:30`](lib/playbook.ts) (`validateIsolate`)

Serialized ticks (GET is snapshot-only; POST is one ADK turn): [`app/api/interactions/[id]/tick/route.ts:6`](app/api/interactions/[id]/tick/route.ts)

Fixture path (labeled; **not** an isolate win): [`lib/grafana-fixtures.ts`](lib/grafana-fixtures.ts)

## 3-minute demo script (English, no trailer)

Do not record a cinematic intro. Film the running console.

1. **0:00–0:20** — Open the hosted or local URL. Point at chrome: show **Night Premiere**, region **EU-West**, **ON AIR**. Say this is a studio-ops board, not a generic cluster dashboard.
2. **0:20–0:40** — Click **Run Night Premiere incident**. Explain this injects the Grafana QoS webhook payload (buffer ratio + origin 5xx).
3. **0:40–1:20** — On the incident page, show the **Interaction / ADK session ID** (not `local-*` on a live run), agent status, and **MCP tool trace** with `mode=mcp`. If Grafana or Gemini is unset, call out **needs-human** — fixture is not a fake isolate.
4. **1:20–2:00** — Gemini isolate line from the finding (edge from the data, not a hardcoded edge-3). Evidence table only if MCP rows exist. Grafana dashboard deeplink.
5. **2:00–2:30** — After a gated Gemini verdict the demo auto-simulates drain to the other two EU-West edges. Mention the kill switch still works and that this is simulated, not a live CDN patch. Grafana Incident created then resolved with the session ID.
6. **2:30–3:00** — Timeline + resolved status. Optional: start a second run and hit **Kill switch** to show `needs-human`.

## Architecture

```
Crew console → Next.js routes → Neon/file store
                          → @google/adk LlmAgent (Gemini)
                          → grafana/mcp-grafana → Grafana Cloud
                          → playbook gate (eu-west + simulated drain)
```

Bounded action: only `eu-west-edge-*`. v1 never patches production routing.

## License

MIT. See [LICENSE](LICENSE).
