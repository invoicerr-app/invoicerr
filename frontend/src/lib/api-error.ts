/**
 * The JSON body and the message of a failed API response, read the one way every transport here
 * reads them (`apiFetch`, `portalApiFetch`, the `usePost`-style method hooks). Nest exceptions reply
 * with a JSON body carrying a human-readable `message` (and sometimes a `code`); the body is parsed
 * best-effort from a clone, so the response itself stays readable, and the message falls back to
 * `${method} ${url} failed` when the body has none. Lives here rather than in `use-fetch.ts` because
 * some specs mock that whole module.
 */
export async function readApiError(
  res: Response,
  method: string,
  url: string,
): Promise<{ body: Record<string, unknown> | undefined; message: string }> {
  const body = await res
    .clone()
    .json()
    .catch(() => undefined)
  const message = typeof body?.message === "string" ? body.message : `${method} ${url} failed`
  return { body, message }
}
