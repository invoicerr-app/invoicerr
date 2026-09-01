/**
 * REAL round-trip against SdI's `SdIRiceviFile.RiceviFile` — root TODO item 10, wave 2, SdI channel.
 * Status: **implemented-awaiting-accreditation** — this spec has NEVER been executed against the true
 * AdE endpoint: no environment available in this checkout holds real AdE (Agenzia delle Entrate)
 * intermediary accreditation (see `sdicoop-client.ts`'s own header, and `CREDENTIALS_GUIDE.md` §4 for
 * the accreditation procedure, re-verified 2026-09-01). `SdiCoopClient` was built directly from the
 * published WSDL/XSD/instructions (cited in full in that file's own header) — the FIRST real
 * collaudo run against this spec MAY reveal envelope discrepancies this codebase could not anticipate
 * from reading alone; that is exactly what running this spec for the first time is FOR.
 *
 * Gated `SDI_LIVE=1` + `SDI_ID_TRASMITTENTE`/`SDI_ENDPOINT`/`SDI_CERTIFICATE`/`SDI_CERT_PASSWORD`
 * (`../live-gate.ts`), run the same way every other channel's own live spec is:
 *
 *   SDI_LIVE=1 SDI_ID_TRASMITTENTE=IT01234567890 \
 *     SDI_ENDPOINT=https://<collaudo-endpoint-assigned-at-accreditation>/ricevi_file \
 *     SDI_CERTIFICATE=<base64-pfx> SDI_CERT_PASSWORD=<password> \
 *     npx jest sdicoop.live --no-coverage
 *
 * Skips cleanly (silently unless the flag is set, then one stderr line) whenever the flag or any
 * credential is absent — which is EVERY run today. No sandbox or fake SOAP endpoint is fabricated to
 * force a green run; see `CREDENTIALS_GUIDE.md` §4 for how to actually obtain collaudo access.
 *
 * HARD-SUCCESS CONTRACT (the same discipline `ksef-live.spec.ts`/the old `sdi-live.spec.ts` already
 * enforced): a response with no usable `IdentificativoSdI`, a `soap:Fault`, or a business `<Errore>`
 * (EI01/EI02/EI03) are ALL failures here — `SdiCoopClient.submit()` already throws named errors for
 * every one of those (`sdicoop-client.ts#parseRiceviFileResponse`), so this spec only needs to assert
 * the promise RESOLVES and that `idSdI` is a positive number — never a soft pass on a caught error.
 */
import { buildInvoiceDescriptor } from '../../descriptors/invoice.descriptor';
import { clientToFormatParty, companyToFormatParty } from '../../formats/party-snapshot';
import { fatturapaFormatProvider } from '../../formats/national/fatturapa-provider';
import { liveDescribe } from '../live-gate';
import { SdiCoopClient } from './sdicoop-client';

const describeLive = liveDescribe('SDI_LIVE', [
  'SDI_ID_TRASMITTENTE',
  'SDI_ENDPOINT',
  'SDI_CERTIFICATE',
  'SDI_CERT_PASSWORD',
]);

describeLive('SdI SdICoop live round-trip (collaudo)', () => {
  it('submits a real FatturaPA test file and receives a non-empty IdentificativoSdI', async () => {
    const idTrasmittente = process.env.SDI_ID_TRASMITTENTE!;
    const endpoint = process.env.SDI_ENDPOINT!;
    const certificate = process.env.SDI_CERTIFICATE!;
    const certificatePassword = process.env.SDI_CERT_PASSWORD!;

    const company = {
      name: 'Rossi SRL',
      address: 'Via Roma 10',
      city: 'Milano',
      postalCode: '20100',
      country: 'Italy',
      partyIdentifiers: [{ scheme: 'VAT', value: idTrasmittente }],
    };
    const client = {
      name: 'Bianchi SpA',
      address: 'Corso Italia 20',
      city: 'Roma',
      postalCode: '00100',
      country: 'Italy',
      partyIdentifiers: [{ scheme: 'VAT', value: 'IT98765432109' }],
    };
    const document = {
      id: 'sdicoop-live-test-0001',
      typeId: 'invoice',
      status: 'sending',
      data: { client: 'client-1' },
      createdAt: new Date(),
      updatedAt: new Date(),
      displayNumber: 'FT-COLLAUDO-0001',
    };

    const buildResult = await fatturapaFormatProvider.build(
      buildInvoiceDescriptor(),
      document,
      companyToFormatParty(company),
      clientToFormatParty(client),
    );
    expect(buildResult.validation.valid).toBe(true); // fail loud if the XSD gate itself regressed

    const sdiCoopClient = new SdiCoopClient({ endpoint });
    const filename = `${idTrasmittente}_${document.id.slice(-10).replace(/[^a-zA-Z0-9]/g, '0')}.xml`;

    const result = await sdiCoopClient.submit({
      idTrasmittente,
      xmlBytes: Buffer.from(buildResult.bytes),
      filename,
      certificate,
      certificatePassword,
    });

    expect(result.idSdI).toBeGreaterThan(0);
    expect(Number.isFinite(result.idSdI)).toBe(true);
  }, 60_000);
});
