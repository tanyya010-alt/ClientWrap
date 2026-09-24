/** Service-type templates used by onboarding and "new client" to pre-configure metrics. */

export interface MetricPreset {
  key: string;
  label: string;
  unit: string;
  agg: "sum" | "last" | "avg";
  better: "up" | "down";
}

export interface ServiceTemplate {
  key: string;
  name: string;
  description: string;
  serviceDescription: string;
  metrics: MetricPreset[];
  sampleFeeCents: number;
  invoiceItem: string;
}

export const SERVICE_TEMPLATES: ServiceTemplate[] = [
  {
    key: "automation",
    name: "Automation agency",
    description: "Workflows, integrations and AI automations.",
    serviceDescription: "Workflow automation retainer",
    metrics: [
      { key: "hours_saved", label: "Hours saved", unit: "hours", agg: "sum", better: "up" },
      { key: "tasks_automated", label: "Tasks automated", unit: "runs", agg: "sum", better: "up" },
      { key: "error_rate", label: "Error rate", unit: "%", agg: "avg", better: "down" },
      { key: "cost_saved", label: "Cost saved", unit: "USD", agg: "sum", better: "up" },
    ],
    sampleFeeCents: 250000,
    invoiceItem: "Automation retainer",
  },
  {
    key: "seo",
    name: "SEO",
    description: "Organic traffic, rankings and leads.",
    serviceDescription: "SEO retainer",
    metrics: [
      { key: "organic_sessions", label: "Organic sessions", unit: "sessions", agg: "sum", better: "up" },
      { key: "keywords_top10", label: "Keywords in top 10", unit: "keywords", agg: "last", better: "up" },
      { key: "leads", label: "Leads from organic", unit: "leads", agg: "sum", better: "up" },
      { key: "backlinks", label: "New backlinks", unit: "links", agg: "sum", better: "up" },
    ],
    sampleFeeCents: 180000,
    invoiceItem: "SEO retainer",
  },
  {
    key: "coaching",
    name: "Coaching",
    description: "Sessions, goals and client progress.",
    serviceDescription: "1:1 coaching program",
    metrics: [
      { key: "sessions", label: "Sessions held", unit: "sessions", agg: "sum", better: "up" },
      { key: "goals_completed", label: "Goals completed", unit: "goals", agg: "sum", better: "up" },
      { key: "confidence_score", label: "Confidence score", unit: "/10", agg: "last", better: "up" },
      { key: "revenue", label: "Client revenue", unit: "USD", agg: "sum", better: "up" },
    ],
    sampleFeeCents: 90000,
    invoiceItem: "Coaching program (monthly)",
  },
  {
    key: "design",
    name: "Design",
    description: "Deliverables, revisions and conversion.",
    serviceDescription: "Design retainer",
    metrics: [
      { key: "deliverables", label: "Deliverables shipped", unit: "assets", agg: "sum", better: "up" },
      { key: "revision_rounds", label: "Revision rounds", unit: "rounds", agg: "avg", better: "down" },
      { key: "turnaround_days", label: "Avg. turnaround", unit: "days", agg: "avg", better: "down" },
      { key: "conversion_rate", label: "Landing-page conversion", unit: "%", agg: "last", better: "up" },
    ],
    sampleFeeCents: 150000,
    invoiceItem: "Design retainer",
  },
  {
    key: "general",
    name: "Other services",
    description: "Start blank and add your own metrics.",
    serviceDescription: "Monthly services",
    metrics: [
      { key: "deliverables", label: "Deliverables", unit: "items", agg: "sum", better: "up" },
      { key: "hours", label: "Hours worked", unit: "hours", agg: "sum", better: "up" },
    ],
    sampleFeeCents: 100000,
    invoiceItem: "Monthly services",
  },
];

export function getTemplate(key: string | null | undefined): ServiceTemplate {
  return SERVICE_TEMPLATES.find((t) => t.key === key) ?? SERVICE_TEMPLATES[SERVICE_TEMPLATES.length - 1];
}

export function metricConfigFromTemplate(t: ServiceTemplate): Record<string, Omit<MetricPreset, "key"> & { position: number }> {
  return Object.fromEntries(t.metrics.map(({ key, ...rest }, i) => [key, { ...rest, position: i }]));
}

/**
 * Metric config lives in JSONB, which does not preserve key order, so each metric carries a
 * `position`. Always iterate metrics through this helper.
 */
export function orderedMetrics<T extends { position?: number; label?: string }>(cfg: Record<string, T> | null | undefined): [string, T][] {
  return Object.entries(cfg ?? {}).sort(
    ([ka, a], [kb, b]) => (a.position ?? 999) - (b.position ?? 999) || String(a.label ?? ka).localeCompare(String(b.label ?? kb)),
  );
}
