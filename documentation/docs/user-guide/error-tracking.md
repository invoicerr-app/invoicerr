---
sidebar_position: 0.75
---

# Error tracking

Invoicerr can report unexpected errors to any Sentry-compatible server, such as a self-hosted
[GlitchTip](https://glitchtip.com/) or Sentry. It is off by default: nothing is sent anywhere until
you set a DSN.

| Variable | Description |
| --- | --- |
| `SENTRY_DSN` | Optional. The backend project's DSN. The API and the queue worker report errors that end in a 5xx response, crash the process or fail its startup. |
| `SENTRY_FRONTEND_DSN` | Optional. The browser project's DSN, published to the page through `/config.json` (a browser DSN is public by design). Its origin is added to the page's `connect-src` Content Security Policy at container start. |
| `SENTRY_ENVIRONMENT` | Optional. The environment name shown on each event (`production`, `staging`...). Defaults to `NODE_ENV` for the backend and `production` for the browser. |

Use two projects, one per DSN, so backend and browser errors stay apart. The release shown on each
event is the image's version.

:::info[What is sent, and what never is]
Only errors are reported: no performance tracing, no session replay, no breadcrumbs. Before an event
leaves the API, the worker or the browser, Invoicerr removes:

- the user, including any IP address and the `{{auto}}` marker that asks the server to infer one;
- request bodies, cookies, headers, and URL query strings and fragments;
- emails, tokens and other secrets from error messages, with the same rules as the application logs.

The browser SDK also tells the server never to infer an IP address from the connection. The server
still sees the connection itself, so to keep IP addresses out entirely, put a proxy in front of the
tracker that removes `X-Forwarded-For`, `X-Real-IP`, `Forwarded` and `CF-Connecting-IP` before they
reach it.
:::

## Docker

Add the variables to the `invoicerr` service in `docker-compose.yml`:

```yaml
environment:
  SENTRY_DSN: https://<key>@errors.example.com/1
  SENTRY_FRONTEND_DSN: https://<key>@errors.example.com/2
  SENTRY_ENVIRONMENT: production
```

With `docker-compose.scale.yml`, set `SENTRY_DSN` on the worker service too.

## Kubernetes

Pass the same variables through the chart's `app.extraEnv`:

```yaml
app:
  extraEnv:
    - name: SENTRY_DSN
      value: https://<key>@errors.example.com/1
    - name: SENTRY_FRONTEND_DSN
      value: https://<key>@errors.example.com/2
    - name: SENTRY_ENVIRONMENT
      value: production
```
