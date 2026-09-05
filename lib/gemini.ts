/**
 * Gemini configuration for CineOps One.
 *
 * Diagnosis is owned by `@google/adk` LlmAgent (lib/cineops-agent.ts).
 * @google/genai is the model backend ADK uses (GEMINI_API_KEY or Vertex).
 */
export const GEMINI_MODEL = "gemini-2.5-flash";

export function isVertexConfigured() {
  const flag = (process.env.GOOGLE_GENAI_USE_VERTEXAI ?? "").toLowerCase();
  const on = flag === "true" || flag === "1";
  return on && Boolean(process.env.GOOGLE_CLOUD_PROJECT && process.env.GOOGLE_CLOUD_LOCATION);
}

export function isGeminiConfigured() {
  return Boolean(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENAI_API_KEY ||
      isVertexConfigured(),
  );
}

export function geminiMode(): "live" | "local-playbook" {
  return isGeminiConfigured() ? "live" : "local-playbook";
}

export async function cancelBackgroundInteraction(id: string) {
  return { cancelled: true, local: id.startsWith("local-") };
}
