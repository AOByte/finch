import { metrics, type Meter } from '@opentelemetry/api';

// Only start the full SDK + Prometheus exporter outside of test environments.
// In tests, the noop meter provider is used (counters/histograms are no-ops).
const isTest = process.env.NODE_ENV === 'test' || process.env.VITEST === 'true';

let meter: Meter;

if (!isTest) {
  /* eslint-disable @typescript-eslint/no-require-imports */
  const { PrometheusExporter } = require('@opentelemetry/exporter-prometheus');
  const { MeterProvider } = require('@opentelemetry/sdk-metrics');
  /* eslint-enable @typescript-eslint/no-require-imports */

  const prometheusExporter = new PrometheusExporter({ port: 9464 });
  const meterProvider = new MeterProvider({ readers: [prometheusExporter] });
  metrics.setGlobalMeterProvider(meterProvider);
  meter = meterProvider.getMeter('finch');
} else {
  meter = metrics.getMeter('finch');
}

export const finchGateFiresTotal = meter.createCounter('finch_gate_fires_total', {
  description: 'Total number of gate fires',
});

export const finchLlmTokensTotal = meter.createCounter('finch_llm_tokens_total', {
  description: 'Total LLM tokens consumed',
});

export const finchPhaseDurationSeconds = meter.createHistogram('finch_phase_duration_seconds', {
  description: 'Duration of pipeline phases in seconds',
});

export const finchRuleViolationsTotal = meter.createCounter('finch_rule_violations_total', {
  description: 'Total rule violations detected',
});

export const finchMemoryQueryMs = meter.createHistogram('finch_memory_query_ms', {
  description: 'Duration of memory queries in milliseconds',
});
