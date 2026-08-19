export const SHOW = {
  name: "Night Premiere",
  slug: "night-premiere",
  region: "EU-West",
  regionSlug: "eu-west",
  onAir: true,
} as const;

export const EDGES = ["eu-west-edge-1", "eu-west-edge-2", "eu-west-edge-3"] as const;
export const SUSPECT_EDGE = "eu-west-edge-3";
export const DRAIN_TARGETS = ["eu-west-edge-1", "eu-west-edge-2"] as const;

export const NIGHT_PREMIERE_ALERT = {
  status: "firing",
  labels: {
    alertname: "NightPremiereBufferRatio",
    show: SHOW.slug,
    region: SHOW.regionSlug,
    severity: "critical",
  },
  annotations: {
    summary: "Buffer ratio spike on Night Premiere EU-West",
    description:
      "cineops_buffer_ratio and cineops_origin_5xx elevated. Suspect edge pool eu-west-edge-3.",
  },
  startsAt: new Date().toISOString(),
  generatorURL: "https://grafana.example/d/night-premiere-qos",
};

export function nightPremiereWebhookPayload() {
  return {
    status: "firing",
    receiver: "cineops-one",
    alerts: [NIGHT_PREMIERE_ALERT],
    commonLabels: NIGHT_PREMIERE_ALERT.labels,
    commonAnnotations: NIGHT_PREMIERE_ALERT.annotations,
    title: "[FIRING] Night Premiere QoS — EU-West",
  };
}
