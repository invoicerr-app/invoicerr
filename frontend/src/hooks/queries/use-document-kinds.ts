import { useApiQuery } from "@/hooks/use-api-query"

/**
 * What a document KIND is in a given country, as the compliance engine reports it.
 *
 * `legalDocument` is a product fact: the kind is numbered from the legal series, issued,
 * transmitted and archived. `availability` is the country fact — whether the jurisdiction permits
 * the kind at all — and `UNVERIFIED` is its honest default while `openQuestion` says what would
 * have to be sourced. Mirrors `DocumentKindRule` in
 * backend/src/compliance/profiles/schema.ts.
 */
export interface DocumentKindRule {
  /**
   * Deliberately a plain string and not the frontend `DocumentKind` enum: the list of kinds is
   * data owned by the country profiles, so a build of this SPA must be able to render a kind it
   * has never heard of rather than drop it.
   */
  kind: string
  legalDocument: boolean
  availability: "AVAILABLE" | "REQUIRED" | "FORBIDDEN" | "UNVERIFIED"
  openQuestion?: string
}

/**
 * Which document kinds a country's businesses use. Static reference data — the endpoint is public
 * and reads nothing from the session, exactly like `useRequiredIdentifiers`.
 *
 * Without a country the query stays disabled and callers get `undefined`: an unknown country must
 * render as "we were told nothing", never as a guess.
 */
export function useDocumentKinds(countryCode: string | undefined | null) {
  const url = countryCode
    ? `/api/compliance/document-kinds?countryCode=${encodeURIComponent(countryCode)}`
    : null

  return useApiQuery<DocumentKindRule[]>(["document-kinds", countryCode], url!, {
    enabled: !!url,
  })
}
