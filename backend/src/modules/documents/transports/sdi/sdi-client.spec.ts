/**
 * `SdiClient.mapNotifica` in isolation — this function is REPRISED (see `sdi-client.ts`'s own header)
 * but had NO test coverage of its own before this file: nothing in this codebase called it yet, so a
 * wrong mapping (see the AT correction below) shipped unnoticed. The "sdi-pec" transport
 * (`transports/sdi-pec/pec-notifiche.service.ts`) is the first real caller — it reuses this exact
 * function so the SOAP (SDICoop) and PEC routes never carry two different opinions about what the
 * same six notifica types mean, since the underlying message format is identical for both channels
 * (see `transports/sdi-pec/pec-protocol.ts`'s own header).
 */
import { SdiClient, SdiNotifica } from './sdi-client';

function notifica(overrides: Partial<SdiNotifica>): SdiNotifica {
  return { type: 'RC', idSdI: 123456789012, dataOraRicezione: '2026-09-13T10:00:00Z', ...overrides };
}

describe('SdiClient.mapNotifica', () => {
  it('RC (ricevuta di consegna) — CLEARED, terminal success', () => {
    expect(SdiClient.mapNotifica(notifica({ type: 'RC' }), 'ref-1').status).toBe('CLEARED');
  });

  it('NS (notifica di scarto) — REJECTED, and carries the rejection detail when present', () => {
    const result = SdiClient.mapNotifica(
      notifica({ type: 'NS', descrizioneErrore: 'Codice 00001 - Nome file non valido' }),
      'ref-1',
    );
    expect(result.status).toBe('REJECTED');
    expect(result.notes.join(' ')).toContain('Codice 00001');
  });

  it('MC (mancata consegna) — PENDING, not terminal (SdI retries for 15 days)', () => {
    expect(SdiClient.mapNotifica(notifica({ type: 'MC' }), 'ref-1').status).toBe('PENDING');
  });

  it('NE with EC01 (buyer accepted) — CLEARED', () => {
    expect(SdiClient.mapNotifica(notifica({ type: 'NE', esitoCommittente: 'EC01' }), 'ref-1').status).toBe(
      'CLEARED',
    );
  });

  it('NE with EC02 (buyer refused) — REJECTED', () => {
    expect(SdiClient.mapNotifica(notifica({ type: 'NE', esitoCommittente: 'EC02' }), 'ref-1').status).toBe(
      'REJECTED',
    );
  });

  it('NE with neither EC01 nor EC02 — PENDING, never guessed as success or failure', () => {
    expect(SdiClient.mapNotifica(notifica({ type: 'NE' }), 'ref-1').status).toBe('PENDING');
  });

  it('DT (decorrenza termini) — CLEARED, SdI deems it delivered', () => {
    expect(SdiClient.mapNotifica(notifica({ type: 'DT' }), 'ref-1').status).toBe('CLEARED');
  });

  it(
    'AT (attestazione di avvenuta trasmissione) — CLEARED, because SdI RECEIVED the invoice and ' +
      'only delivery to the buyer failed; the note carries the seller obligation no status can',
    () => {
      const result = SdiClient.mapNotifica(notifica({ type: 'AT' }), 'ref-1');
      // Specifiche tecniche SdI v1.8.1 section 1.10: «l'avvenuta ricezione della fattura e
      // l'impossibilità di recapitare il file al destinatario». Nothing was rejected -- calling it
      // REJECTED would push a user to reissue an invoice that legally already exists.
      expect(result.status).toBe('CLEARED');
      expect(result.notes.join(' ')).toMatch(/impossibilit.* di recapito/);
      expect(result.notes.join(' ')).toMatch(/seller must tell the buyer/);
    },
  );

  it('an unknown notifica type is PENDING, never silently guessed as a terminal outcome', () => {
    const result = SdiClient.mapNotifica(notifica({ type: 'ZZ' as never }), 'ref-1');
    expect(result.status).toBe('PENDING');
    expect(result.notes.join(' ')).toContain('unknown notifica type: ZZ');
  });

  it('every result carries channel: "SDI" and the ref it was given, regardless of outcome', () => {
    for (const type of ['RC', 'NS', 'MC', 'NE', 'DT', 'AT'] as const) {
      const result = SdiClient.mapNotifica(notifica({ type }), 'my-ref');
      expect(result.channel).toBe('SDI');
      expect(result.ref).toBe('my-ref');
    }
  });
});
