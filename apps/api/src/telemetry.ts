import { NodeSDK } from '@opentelemetry/sdk-node';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { metrics } from '@opentelemetry/api';
import { MeterProvider } from '@opentelemetry/sdk-metrics';

const prometheusExporter = new PrometheusExporter({ port: 9464 });

const meterProvider = new MeterProvider({
  readers: [prometheusExporter],
});

metrics.setGlobalMeterProvider(meterProvider);

const sdk = new NodeSDK({
  metricReader: prometheusExporter,
});

sdk.start();

// Create custom Finch meters
const meter = metrics.getMeter('finch');

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
