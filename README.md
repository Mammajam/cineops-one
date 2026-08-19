# CineOps One

Studio-ops console for a live cinema premiere. Grafana fires a QoS alert; a Gemini background Interaction queries **Grafana Cloud MCP**, isolates `eu-west-edge-3`, simulates a drain to `eu-west-edge-1/2`, and writes the outcome into a Grafana Incident.

**Track:** Grafana only. **AI:** Google Gemini (`@google/genai`) only. No ClickHouse, Parallel, Replit, IBM, OpenAI, Anthropic, or Vercel AI SDK as the agent runtime.

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

1. Run `npm run mcp:grafana` (or host `mcp-grafana` on Cloud Run / Fly).
2. Set `GRAFANA_MCP_TRANSPORT=http` and `GRAFANA_MCP_URL=https://your-mcp-host/mcp`.

Without Grafana/Gemini keys the labeled fixture / local playbook path still runs the Night Premiere demo for judges who need a working click-path.

## Run locally

```powershell
cd agenticCinemaHackathon
copy .env.example .env.local
# Fill DATABASE_URL (Neon). Optional: GEMINI_API_KEY + Grafana keys for live MCP.
npm install
npm run db:push
npm run seed:grafana
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). Chrome should read **Night Premiere · EU-West · ON AIR**. Click **Run Night Premiere incident**.

| Name | Purpose |
| --- | --- |
| `DATABASE_URL` | Neon Postgres. File store fallback if missing/unreachable. |
| `GEMINI_API_KEY` | `@google/genai` Interactions API. Local playbook if missing. |
| `GRAFANA_URL` | Grafana Cloud instance URL (UI / API base) |
| `GRAFANA_SERVICE_ACCOUNT_TOKEN` | Service account token for `mcp-grafana` |
| `GRAFANA_MCP_TRANSPORT` | `stdio` (local `uvx mcp-grafana`) or `http` (hosted MCP) |
| `GRAFANA_MCP_URL` | Streamable HTTP MCP endpoint when transport is `http` |

`npm run seed:grafana` is a **safe no-op** when Grafana env is missing.  
`npm run mcp:grafana` starts official `mcp-grafana` over HTTP/SSE for serverless clients.

## Runtime proof (file:line)

Google Gemini Interactions API (`background: true`):

- Import `@google/genai`: [`lib/gemini.ts:8`](lib/gemini.ts)
- `ai.interactions.create` with `background: true`: [`lib/gemini.ts:137`](lib/gemini.ts)–[`lib/gemini.ts:140`](lib/gemini.ts)
- Poll: [`lib/gemini.ts:147`](lib/gemini.ts)
- Cancel (kill switch): [`lib/gemini.ts:198`](lib/gemini.ts)

Official Grafana MCP (`mcp-grafana` via MCP SDK):

- Import MCP client + stdio/HTTP transports: [`lib/grafana-mcp.ts:12`](lib/grafana-mcp.ts)–[`lib/grafana-mcp.ts:14`](lib/grafana-mcp.ts)
- Spawn `uvx mcp-grafana`: [`lib/grafana-mcp.ts:76`](lib/grafana-mcp.ts)
- HTTP transport + `GRAFANA_MCP_URL`: [`lib/grafana-mcp.ts:54`](lib/grafana-mcp.ts)
- `client.callTool`: [`lib/grafana-mcp.ts:133`](lib/grafana-mcp.ts)
- Tools used: `alerting_manage_rules`, `query_prometheus`, `query_loki_logs`, `search_dashboards`, `create_incident`, `add_activity_to_incident`

Fixture path (labeled in the UI as **Grafana fixture / demo**): [`lib/grafana-fixtures.ts`](lib/grafana-fixtures.ts)

Bounded playbook (EU-West edges only, simulated drain): [`lib/playbook.ts`](lib/playbook.ts)

Agent orchestration: [`lib/agent-loop.ts`](lib/agent-loop.ts)

## 3-minute demo script (English, no trailer)

Do not record a cinematic intro. Film the running console.

1. **0:00–0:20** — Open the hosted or local URL. Point at chrome: show **Night Premiere**, region **EU-West**, **ON AIR**. Say this is a studio-ops board, not a generic cluster dashboard.
2. **0:20–0:40** — Click **Run Night Premiere incident**. Explain this injects the Grafana QoS webhook payload (buffer ratio + origin 5xx).
3. **0:40–1:20** — On the incident page, show the **Interaction ID**, agent status, and **MCP tool trace** (`query_prometheus`, `query_loki_logs`, `search_dashboards`). If Grafana env is unset, call out the yellow **FIXTURE / DEMO MODE** label and that the live MCP client remains in `lib/grafana-mcp.ts`.
4. **1:20–2:00** — Isolate verdict: **eu-west-edge-3**. Evidence table: buffer ratio / 5xx / latency vs edge-1/2. Grafana dashboard deeplink.
5. **2:00–2:30** — Demo auto-simulates drain to `eu-west-edge-1/2`. Mention the kill switch still works and that this is simulated, not a live CDN patch. Grafana Incident created then resolved with the Interaction ID.
6. **2:30–3:00** — Timeline + resolved status. Optional: start a second run and hit **Kill switch** to show `needs-human`.

## Architecture

```
Crew console → Next.js routes → Neon/file store
                          → Gemini Interactions (background)
                          → grafana/mcp-grafana → Grafana Cloud
```

Bounded action: only `eu-west-edge-*`. v1 never patches production routing.

## License

MIT. See [LICENSE](LICENSE).
