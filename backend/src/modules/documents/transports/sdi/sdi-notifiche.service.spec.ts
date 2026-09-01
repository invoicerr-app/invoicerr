/**
 * `SdiNotificheService` in isolation — `conformity/authority-events.persistence.ts` is mocked
 * wholesale (the same "mock the persistence boundary, never the ORM underneath it" discipline
 * `conformity-sweep-runner.spec.ts` already holds for the identical module). Two facts proven:
 *
 *  1. A notifica for a KNOWN `IdentificativoSdI` (a `DocumentInstance.transportRef` this codebase
 *     actually has, for the "sdi" channel) is journaled into `DocumentAuthorityEvent`, on THAT
 *     document's own (companyId, documentId) — never a different one.
 *  2. MUTATION TARGET #2 (this task's own brief): a notifica for an UNKNOWN reference journals
 *     NOTHING — `createAuthorityEvents` must never be called at all, on ANY document (an implementation
 *     that "journals onto an arbitrary document instead" is exactly the bug this test exists to catch;
 *     asserting `not.toHaveBeenCalled()` — not merely "not called with THIS specific id" — is what
 *     makes that mutation bite).
 */
import * as persistence from '../../conformity/authority-events.persistence';
import { SDI_PROVIDER_ID, SdiNotificheService } from './sdi-notifiche.service';

jest.mock('../../conformity/authority-events.persistence');

const mockedFindDocument = persistence.findDocumentByTransportRef as jest.Mock;
const mockedCreateEvents = persistence.createAuthorityEvents as jest.Mock;

const RC_XML = (idSdI: string) => `<?xml version="1.0" encoding="UTF-8"?>
  <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <ns:ricevutaConsegna xmlns:ns="http://www.fatturapa.gov.it/sdi/ws/trasmissione/v1.0/types">
        <ns:IdentificativoSdI>${idSdI}</ns:IdentificativoSdI>
        <ns:NomeFile>IT01234567890_0000000001.xml</ns:NomeFile>
        <ns:File>PGZvbz48L2Zvbz4=</ns:File>
      </ns:ricevutaConsegna>
    </soap:Body>
  </soap:Envelope>`;

describe('SdiNotificheService.handleNotifica', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('journals an RC notifica for a KNOWN IdentificativoSdI onto its own (companyId, documentId), never another', async () => {
    mockedFindDocument.mockResolvedValue({ id: 'doc-42', companyId: 'company-42' });
    mockedCreateEvents.mockResolvedValue(1);

    const service = new SdiNotificheService();
    const result = await service.handleNotifica(RC_XML('123456789012'));

    expect(result).toEqual({ journaled: true, notificaType: 'RC', identificativoSdI: '123456789012' });
    expect(mockedFindDocument).toHaveBeenCalledWith(SDI_PROVIDER_ID, '123456789012');
    expect(mockedCreateEvents).toHaveBeenCalledTimes(1);
    expect(mockedCreateEvents).toHaveBeenCalledWith(
      'company-42',
      'doc-42',
      SDI_PROVIDER_ID,
      expect.arrayContaining([expect.objectContaining({ statusCode: 'it:RC' })]),
    );
  });

  it('MUTATION TARGET #2 — an unknown IdentificativoSdI journals NOTHING, on ANY document', async () => {
    mockedFindDocument.mockResolvedValue(null);

    const service = new SdiNotificheService();
    const result = await service.handleNotifica(RC_XML('999999999999'));

    expect(result).toEqual({ journaled: false, notificaType: 'RC', identificativoSdI: '999999999999' });
    expect(mockedCreateEvents).not.toHaveBeenCalled();
  });

  it('a malformed/unrecognized body journals nothing and never even looks up a document', async () => {
    const service = new SdiNotificheService();
    const result = await service.handleNotifica('<not-a-known-notifica/>');

    expect(result).toEqual({ journaled: false });
    expect(mockedFindDocument).not.toHaveBeenCalled();
    expect(mockedCreateEvents).not.toHaveBeenCalled();
  });
});
