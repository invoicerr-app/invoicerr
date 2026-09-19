/**
 * How many reverse-proxy hops in front of this process Express should trust when resolving `req.ip`
 * from `X-Forwarded-For` (`app.set('trust proxy', n)`, wired in `create-app.ts`) — see that file's own
 * comment for what "hops" means to Express/`proxy-addr` and why the number has to match reality
 * exactly, not merely be "big enough".
 *
 * This is the other half of `nginx.conf`'s own `X-Forwarded-For` handling: nginx now APPENDS its own
 * directly-observed peer address (`$proxy_add_x_forwarded_for`) to whatever it received rather than
 * overwriting it, so the header grows by exactly one entry per real HTTP-aware hop in front of this
 * container. `req.ip` is resolved by counting back through that chain from nginx's own entry (always
 * last, always trusted) — this value says how many entries back that walk is allowed to go.
 *
 * Default `1`: the only topology this app has ever shipped with out of the box (`docker-compose.yml`,
 * one container) has exactly ONE such hop — nginx itself, proxying to the same container's Node
 * process over loopback — so an operator who sets nothing gets EXACTLY today's behaviour, unchanged.
 * Two situations call for raising it:
 *   - a self-hosted operator puts their OWN reverse proxy, CDN or load balancer in front (Cloudflare,
 *     their own nginx/Caddy, a cloud LB that speaks HTTP) — one more trusted hop each;
 *   - `deploy/helm/invoicerr` ships an Ingress (`ingress.enabled: true` by default) IN FRONT of the
 *     exact same in-pod nginx `docker-compose.yml` already has — two hops, not one — hence that
 *     chart's own `app.trustProxyHops` value defaults to `2` rather than leaving this unset.
 *
 * Getting this wrong in either direction is silent: too LOW collapses every client behind the
 * untrusted hop's own address (every rate limiter and audit log then shares one
 * bucket); too HIGH lets whatever a client puts in `X-Forwarded-For` itself be trusted as the real
 * client address (the exact spoof `nginx.conf`'s own header already warns about). There is no way to
 * detect either mistake from inside this process — it depends entirely on the real network path,
 * which is why this is a knob, not something this code could infer.
 *
 * A pure L4/TCP load balancer that never speaks HTTP (so never sets `X-Forwarded-For` at all) is NOT
 * an "HTTP-aware hop" in this sense — no value of this setting recovers a client address nothing ever
 * forwarded. That needs the balancer itself reconfigured (the PROXY protocol, or made to set the
 * header), entirely outside this application — see §5 of the analysis this fix answers.
 */
export function resolveTrustProxyHops(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.TRUST_PROXY_HOPS;
  if (raw === undefined || raw.trim() === '') return 1;

  const parsed = Number.parseInt(raw, 10);
  // A malformed value (empty after trim already handled above, non-numeric, negative) falls back to
  // the safe single-container default rather than handing Express something nonsensical — a typo in
  // this variable must not silently turn into "trust nothing" (every request resolves to nginx's own
  // loopback address, which is arguably WORSE than the pre-fix hardcoded `1`, since at least that one
  // was always correct for the one topology this app shipped with by default).
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : 1;
}
