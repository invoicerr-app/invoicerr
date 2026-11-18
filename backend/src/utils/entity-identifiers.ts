export function getIdentifier(
  entity: { partyIdentifiers?: { scheme: string; value: string }[] } | null | undefined,
  scheme: string,
): string | undefined {
  return entity?.partyIdentifiers?.find((pi) => pi.scheme === scheme)?.value;
}
