---
sidebar_position: 0.75
---

# Monitoring

Invoicerr exposes two standard signals for your own monitoring stack: a Prometheus metrics endpoint
and OpenTelemetry traces over OTLP. Both are off by default. Nothing is sent anywhere unless you point
it at a collector you run yourself.

## Prometheus metrics

| Variable | Description |
| --- | --- |
| `METRICS_ENABLED` | `true` turns on the endpoint. Any other value, or unset, keeps it off (it answers 404). |
| `METRICS_TOKEN` | Bearer token the scraper must send. Required when `NODE_ENV=production`: without it the endpoint stays off and a warning is logged at boot. |

The API serves `GET /api/metrics`. A dedicated worker (`ROLE=worker`) serves the same format on its
health port, `GET :3001/metrics`, with the same two variables.

```yaml
scrape_configs:
  - job_name: invoicerr
    metrics_path: /api/metrics
    authorization:
      credentials: <METRICS_TOKEN>
    static_configs:
      - targets: ["invoicerr.example.com"]
```

What you get:

- `http_request_duration_seconds` (histogram), labelled by `method`, `route` and `status_code`. The
  route is the template (`/api/clients/:id`), never the raw path.
- `invoicerr_http_server_errors_total`, the 5xx responses by `method` and `route`. Alert on its rate
  to learn about an outage before a customer does.
- The standard Node.js process metrics: CPU, memory, event loop lag, garbage collection, open handles
  and `process_start_time_seconds`, labelled `service="invoicerr-api"` or `service="invoicerr-worker"`.

Prometheus' own `up` series for this target is the uptime signal.

## OpenTelemetry traces

Tracing starts when `OTEL_EXPORTER_OTLP_ENDPOINT` (or `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`) is set,
and the SDK is not loaded otherwise. Every standard `OTEL_*` variable applies, for example:

| Variable | Description |
| --- | --- |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | Your collector's OTLP/HTTP address, e.g. `http://otel-collector:4318`. |
| `OTEL_EXPORTER_OTLP_HEADERS` | Optional headers, e.g. `Authorization=Bearer xyz`. |
| `OTEL_SERVICE_NAME` | Optional. Defaults to `invoicerr-api`, or `invoicerr-worker` with `ROLE=worker`. |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | Optional sampling, e.g. `parentbased_traceidratio` and `0.1`. |
| `OTEL_SDK_DISABLED` | `true` turns tracing off even with an endpoint set. |

Incoming HTTP requests, Nest handlers, PostgreSQL queries and Redis commands are traced. An unhandled
error is recorded on its span, so any OTLP backend you host (Grafana Tempo, Jaeger, SigNoz and the
like) also serves as error reporting.

:::info[What leaves the process]
Spans go through the same redaction as the application logs. Incoming request URLs are dropped (the
`http.route` template is kept), outgoing requests keep only the remote origin, SQL is sent without its bound
values, Redis commands without their arguments, and exception messages are filtered for email
addresses and secrets. Request and response bodies and headers are never recorded. Only metrics and
traces are exported: logs stay in the database.
:::
