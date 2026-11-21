---
sidebar_position: 0.75
---

# Error tracking

Invoicerr can report unexpected errors to any Sentry-compatible server, such as a self-hosted
[GlitchTip](https://glitchtip.com/) or Sentry. It is off by default: nothing is sent anywhere until
you set a DSN, and nothing is sent from a user's browser until that user agrees.

| Variable | Description |
| --- | --- |
| `SENTRY_DSN` | Optional. The backend project's DSN. The API and the queue worker report errors that end in a 5xx response, crash the process or fail its startup. |
| `SENTRY_FRONTEND_DSN` | Optional. The browser project's DSN. It is never published in `/config.json` or in the bundle: the API hands it only to a signed-in user who agreed to error reports. Its origin is added to the page's `connect-src` Content Security Policy at container start. |
| `SENTRY_ENVIRONMENT` | Optional. The environment name shown on each event (`production`, `staging`...). Defaults to `NODE_ENV` for the backend and `production` for the browser. |

The release shown on each event is the image's version.

## Consent

**Server errors** are the operator's choice, made for the instance as a whole (legitimate interest):
setting `SENTRY_DSN` turns them on. They carry nothing that identifies the user who made the request,
and nothing is ever reported from the pages that serve people outside the account or not signed in
yet: the client portal, public signature and document links, sign-in, and the legal pages.

**Browser errors** need each user's own consent, and are off until they give it:

- After signing in, a banner asks the question, with **Allow** and **Don't allow** side by side, the
  same size and style. Nothing is loaded before sign-in, and the error-reporting code is not even
  downloaded before a "yes".
- The answer can be changed at any time in **Account > Preferences > Error reports**. Withdrawing
  stops reporting in that browser at once.
- Every answer is stored as a new row, never overwritten, in the `error_tracking_consent` table:
  user, decision (`granted`, `refused` or `withdrawn`), date, version of the text shown, and where it
  was given (`banner` or `settings`). A withdrawal is the `decidedAt` of its `withdrawn` row. No IP
  address or browser detail is stored with it.
- An answer, "yes" or "no", is asked again after six months, and whenever the text changes.
- The browser never reports from the portal, signature, sign-in or legal pages, even if the user
  agreed.

The banner and the setting only appear when `SENTRY_FRONTEND_DSN` is set.

## What is sent, and what never is

Only errors are reported: no performance tracing, no session replay, no breadcrumbs, no unhandled
promise rejections. Before an event leaves the API, the worker or the browser, Invoicerr removes:

- the user, including any IP address and the `{{auto}}` marker that asks the server to infer one;
- request bodies, cookies, headers, and URL query strings and fragments; on the server the request
  URL goes entirely (only the method and the route template, such as `/api/clients/:id`, remain);
- access tokens in the path of a URL (client portal and signature links);
- emails, IBANs, phone numbers, SIREN/SIRET numbers, IP addresses, tokens and other secrets from
  error messages and extra data, with the same rules as the application logs
  (`backend/src/logger/redaction-rules.ts`, shared by the server and the browser);
- the message of a database error, of which only the error name and code are kept;
- every context except the runtime, OS, browser and trace ids.

Tags sent with each event:

| Tag | Where | Value |
| --- | --- | --- |
| `role` | Server | `api` or `worker` |
| `route` | Server | The route template of the failed request, such as `/api/clients/:id` |

The `release` and `environment` fields are also set on every event. The browser sends no tags.

## Setting up the tracker

Use **two projects**, one per DSN, so backend and browser errors stay apart and the browser key
(which a consenting user's browser can read) gives access to nothing else. For the browser project:

- **Allowed origins.** Restrict the project to your instance's origin (`https://invoicerr.example.com`)
  where your server supports it (in Sentry: *Project Settings > Security Headers > Allowed Domains*),
  so the key cannot be used from another site.
- **Rate limit.** Set a rate limit on the browser key (in Sentry: *Client Keys > Configure > Rate
  Limiting*), or an event quota in GlitchTip, so a misbehaving page or a copied key cannot flood the
  project.

**IP addresses.** No event carries one, but the tracker sees the connection it receives events on.
Either turn off IP address storage in the tracker (in Sentry: *Project Settings > Security & Privacy
> Prevent Storing of IP Addresses*; in GlitchTip, check your version's organization settings for IP
address scrubbing), or put a proxy in front of the tracker, a *tunnel*, that removes
`X-Forwarded-For`, `X-Real-IP`, `Forwarded` and `CF-Connecting-IP` before they reach it and does not
log the client address. Do one of the two on a hosted instance.

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
