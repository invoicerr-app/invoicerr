export function getIdentifier(
  entity: { partyIdentifiers?: { scheme: string; value: string }[] } | null | undefined,
  scheme: string,
): string | undefined {
  return entity?.partyIdentifiers?.find((pi) => pi.scheme === scheme)?.value;
}

export function augmentWithIdentifiers<T extends { partyIdentifiers?: { scheme: string; value: string }[] }>(
  entity: T,
): T & { legalId: string; VAT: string } {
  return {
    ...entity,
    legalId: getIdentifier(entity, 'LEGAL_ID') ?? '',
    VAT: getIdentifier(entity, 'VAT') ?? '',
  };
}
