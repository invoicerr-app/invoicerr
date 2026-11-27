/**
 * The Express route TEMPLATE (`/api/clients/:id`), never the concrete URL: the template says which
 * endpoint answered without carrying which record, and a raw path carries ids and public share tokens.
 * Undefined when no route matched. Shared by the metrics labels and the error tracker's route tag, so
 * the two can never disagree. Kept free of prom-client and Sentry imports.
 */
export function routeTemplateOf(
  request: { baseUrl?: string; route?: { path?: unknown } } | undefined,
): string | undefined {
  const path = request?.route?.path;
  if (typeof path !== 'string') return undefined;
  return `${request?.baseUrl ?? ''}${path}`;
}
