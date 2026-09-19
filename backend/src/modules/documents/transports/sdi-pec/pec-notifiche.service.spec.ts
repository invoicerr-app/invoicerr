/**
 * `PecNotificheService` in isolation — `conformity/authority-events.persistence` is mocked wholesale,
 * the same "mock the persistence boundary, never the ORM underneath it" discipline
 * `sdi/sdi-notifiche.service.spec.ts` already holds for its own (SOAP-push) sibling. Proves:
 *
 *  1. A notifica attachment for a KNOWN NomeFile is journaled onto that document's own
 *     (companyId, documentId), with the CORRECT internal status for each terminal type — including
 *     AT, which used to be (wrongly) mapped to CLEARED before this task's own primary-source
 *     correction (see `sdi/sdi-client.ts`'s "CORRECTION" header).
 *  2. An unknown NomeFile journals NOTHING, on ANY document.
 *  3. A message with no recognizable notifica attachment (the PEC protocol's own "ricevuta di
 *     accettazione"/"ricevuta di consegna", or anything unrelated) is handled as a quiet no-op, never
 *     an error and never a lookup on Prisma at all.
 *  4. The reply-address learning: `ChannelCredentialsService.upsertChannelConfig` is called with the
 *     message's own `from` address merged into the existing "sdi-pec" config — and is NOT called
 *     again once that address is already the one on file.
 */
import { vi, type Mock } from 'vitest';
import * as persistence from '../../conformity/authority-events.persistence';
import { PecInboundMessage } from './pec-inbox-port';
import { PecNotificheService, SDI_PEC_PROVIDER_ID } from './pec-notifiche.service';

vi.mock('../../conformity/authority-events.persistence');

const mockedFindDocument = persistence.findOwnedDocumentByTransportRef as Mock;
const mockedCreateEvents = persistence.createAuthorityEvents as Mock;

function notificaXml(root: string, idSdI: string, nomeFile: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
    <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
      <soap:Body>
        <ns:${root} xmlns:ns="http://www.fatturapa.gov.it/sdi/ws/trasmissione/v1.0/types">
          <ns:IdentificativoSdI>${idSdI}</ns:IdentificativoSdI>
          <ns:NomeFile>${nomeFile}</ns:NomeFile>
          <ns:File>PGZvbz48L2Zvbz4=</ns:File>
        </ns:${root}>
      </soap:Body>
    </soap:Envelope>`;
}

function message(overrides: Partial<PecInboundMessage> = {}): PecInboundMessage {
  return {
    id: 'msg-1',
    from: 'sdi07@pec.fatturapa.it',
    subject: 'Ricevuta di consegna',
    attachments: [],
    ...overrides,
  };
}

function buildChannelCredentials(overrides?: { resolveActive?: Mock; upsertChannelConfig?: Mock }) {
  return {
    resolveActive:
      overrides?.resolveActive ??
      vi.fn().mockResolvedValue({
        providerId: SDI_PEC_PROVIDER_ID,
        channel: 'SDI-PEC',
        environment: 'TEST',
        isActive: true,
        config: { pecAddress: 'me@pec.example.it', idTrasmittente: 'IT01234567890' },
      }),
    upsertChannelConfig: overrides?.upsertChannelConfig ?? vi.fn().mockResolvedValue({}),
  };
}

describe('PecNotificheService.handleMessage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ['ricevutaConsegna', 'RC', 'CLEARED'],
    ['notificaScarto', 'NS', 'REJECTED'],
    ['notificaMancataConsegna', 'MC', 'PENDING'],
    ['notificaDecorrenzaTermini', 'DT', 'CLEARED'],
    ['attestazioneTrasmissioneFattura', 'AT', 'CLEARED'],
  ] as const)('journals a %s (%s) notifica onto its own document, mapped to the correct internal status (%s)', async (root, notificaType, internalStatus) => {
    mockedFindDocument.mockResolvedValue({ id: 'doc-42', companyId: 'company-42', typeId: 'invoice' });
    mockedCreateEvents.mockResolvedValue(1);
    const channelCredentials = buildChannelCredentials();
    const service = new PecNotificheService(channelCredentials as never);

    const result = await service.handleMessage(
      'company-42',
      message({
        attachments: [
          {
            filename: 'IT01234567890_00001.xml',
            content: Buffer.from(notificaXml(root, '123456789012', 'IT01234567890_00001.xml')),
          },
        ],
      }),
    );

    expect(result).toEqual({
      handled: true,
      notificaType,
      nomeFile: 'IT01234567890_00001.xml',
      identificativoSdI: '123456789012',
      internalStatus,
    });
    expect(mockedFindDocument).toHaveBeenCalledWith(
      'company-42',
      SDI_PEC_PROVIDER_ID,
      'IT01234567890_00001.xml',
    );
    expect(mockedCreateEvents).toHaveBeenCalledWith(
      'company-42',
      'doc-42',
      SDI_PEC_PROVIDER_ID,
      expect.arrayContaining([
        expect.objectContaining({
          statusCode: `it:${notificaType}`,
          rawPayload: expect.objectContaining({ channel: 'pec', mappedStatus: internalStatus }),
        }),
      ]),
    );
  });

  // The AT case's explanatory note ("SdI accepted the invoice but could not deliver it [...] the
  // seller must tell the buyer") used to be computed by `SdiClient.mapNotifica` and then discarded —
  // only `outcome.status` reached `rawPayload.mappedStatus`, so a CLEARED verdict with a real
  // follow-up obligation reached the document screen with NO indication of that obligation at all.
  it("carries the AT notifica's own follow-up instruction through to the journaled reason", async () => {
    mockedFindDocument.mockResolvedValue({ id: 'doc-42', companyId: 'company-42', typeId: 'invoice' });
    mockedCreateEvents.mockResolvedValue(1);
    const service = new PecNotificheService(buildChannelCredentials() as never);

    await service.handleMessage(
      'company-42',
      message({
        attachments: [
          {
            filename: 'IT01234567890_00001.xml',
            content: Buffer.from(
              notificaXml('attestazioneTrasmissioneFattura', '123456789012', 'IT01234567890_00001.xml'),
            ),
          },
        ],
      }),
    );

    expect(mockedCreateEvents).toHaveBeenCalledWith(
      'company-42',
      'doc-42',
      SDI_PEC_PROVIDER_ID,
      expect.arrayContaining([
        expect.objectContaining({ reason: expect.stringContaining('the seller must tell the buyer') }),
      ]),
    );
  });

  // RC adds nothing past `mapNotifica`'s own three boilerplate notes — `reason` must stay unset
  // rather than surfacing "idSdI: …; notifica: RC; data: …" as if it were an explanation.
  it('leaves reason unset for a plain RC (nothing beyond the boilerplate notes)', async () => {
    mockedFindDocument.mockResolvedValue({ id: 'doc-42', companyId: 'company-42', typeId: 'invoice' });
    mockedCreateEvents.mockResolvedValue(1);
    const service = new PecNotificheService(buildChannelCredentials() as never);

    await service.handleMessage(
      'company-42',
      message({
        attachments: [
          {
            filename: 'IT01234567890_00001.xml',
            content: Buffer.from(notificaXml('ricevutaConsegna', '123456789012', 'IT01234567890_00001.xml')),
          },
        ],
      }),
    );

    expect(mockedCreateEvents).toHaveBeenCalledWith(
      'company-42',
      'doc-42',
      SDI_PEC_PROVIDER_ID,
      expect.arrayContaining([expect.objectContaining({ reason: undefined })]),
    );
  });

  it('an unknown NomeFile journals NOTHING, on ANY document', async () => {
    mockedFindDocument.mockResolvedValue(null);
    const channelCredentials = buildChannelCredentials();
    const service = new PecNotificheService(channelCredentials as never);

    const result = await service.handleMessage(
      'company-42',
      message({
        attachments: [
          {
            filename: 'IT01234567890_99999.xml',
            content: Buffer.from(notificaXml('ricevutaConsegna', '999999999999', 'IT01234567890_99999.xml')),
          },
        ],
      }),
    );

    expect(result).toEqual({
      handled: false,
      notificaType: 'RC',
      nomeFile: 'IT01234567890_99999.xml',
      identificativoSdI: '999999999999',
    });
    expect(mockedCreateEvents).not.toHaveBeenCalled();
  });

  it('a message with no recognizable notifica attachment is a quiet no-op — never looks up a document', async () => {
    const channelCredentials = buildChannelCredentials();
    const service = new PecNotificheService(channelCredentials as never);

    const result = await service.handleMessage(
      'company-42',
      message({
        attachments: [{ filename: 'daticert.xml', content: Buffer.from('<not-a-known-notifica/>') }],
      }),
    );

    expect(result).toEqual({ handled: false });
    expect(mockedFindDocument).not.toHaveBeenCalled();
    expect(mockedCreateEvents).not.toHaveBeenCalled();
  });

  it('a message with zero attachments (a bare PEC protocol receipt) is a quiet no-op too', async () => {
    const channelCredentials = buildChannelCredentials();
    const service = new PecNotificheService(channelCredentials as never);

    const result = await service.handleMessage('company-42', message({ attachments: [] }));

    expect(result).toEqual({ handled: false });
  });

  describe('learning the reply address', () => {
    it('merges the message\'s own "from" address into the existing "sdi-pec" config', async () => {
      mockedFindDocument.mockResolvedValue({ id: 'doc-42', companyId: 'company-42', typeId: 'invoice' });
      mockedCreateEvents.mockResolvedValue(1);
      const channelCredentials = buildChannelCredentials();
      const service = new PecNotificheService(channelCredentials as never);

      await service.handleMessage(
        'company-42',
        message({
          from: 'sdi07@pec.fatturapa.it',
          attachments: [
            {
              filename: 'IT01234567890_00001.xml',
              content: Buffer.from(
                notificaXml('ricevutaConsegna', '123456789012', 'IT01234567890_00001.xml'),
              ),
            },
          ],
        }),
      );

      expect(channelCredentials.upsertChannelConfig).toHaveBeenCalledWith(
        'company-42',
        SDI_PEC_PROVIDER_ID,
        expect.objectContaining({
          environment: 'TEST',
          isActive: true,
          config: expect.objectContaining({
            pecAddress: 'me@pec.example.it',
            sdiReplyAddress: 'sdi07@pec.fatturapa.it',
          }),
        }),
      );
    });

    it('never re-writes the config when the learned address is already the one on file', async () => {
      mockedFindDocument.mockResolvedValue({ id: 'doc-42', companyId: 'company-42', typeId: 'invoice' });
      mockedCreateEvents.mockResolvedValue(1);
      const channelCredentials = buildChannelCredentials({
        resolveActive: vi.fn().mockResolvedValue({
          providerId: SDI_PEC_PROVIDER_ID,
          channel: 'SDI-PEC',
          environment: 'TEST',
          isActive: true,
          config: { sdiReplyAddress: 'sdi07@pec.fatturapa.it' },
        }),
      });
      const service = new PecNotificheService(channelCredentials as never);

      await service.handleMessage(
        'company-42',
        message({
          from: 'sdi07@pec.fatturapa.it',
          attachments: [
            {
              filename: 'IT01234567890_00001.xml',
              content: Buffer.from(
                notificaXml('ricevutaConsegna', '123456789012', 'IT01234567890_00001.xml'),
              ),
            },
          ],
        }),
      );

      expect(channelCredentials.upsertChannelConfig).not.toHaveBeenCalled();
    });

    // THE MUTATION TARGET: this service used to learn the reply address from the `From` of ANY
    // message that merely PARSED as one of the six known notifica shapes — no domain check, no
    // message-kind restriction, no requirement that the notifica reconcile with a real document
    // first. A third party who knows this mailbox's address (or simply forges a From header, since
    // SMTP does not authenticate it on its own) could redirect every future FatturaPA submission —
    // full client data, amounts, fiscal identifiers — to an address of their own choosing.
    it('never learns from a message whose "From" is NOT under SdI\'s own domain, even for a hint type', async () => {
      mockedFindDocument.mockResolvedValue({ id: 'doc-42', companyId: 'company-42', typeId: 'invoice' });
      mockedCreateEvents.mockResolvedValue(1);
      const channelCredentials = buildChannelCredentials();
      const service = new PecNotificheService(channelCredentials as never);

      await service.handleMessage(
        'company-42',
        message({
          from: 'attacker@evil.example.com',
          attachments: [
            {
              filename: 'IT01234567890_00001.xml',
              content: Buffer.from(
                notificaXml('ricevutaConsegna', '123456789012', 'IT01234567890_00001.xml'),
              ),
            },
          ],
        }),
      );

      expect(channelCredentials.upsertChannelConfig).not.toHaveBeenCalled();
    });

    it("never learns from a notifica type the specification does not document as carrying a reply address (DT), even from SdI's own domain", async () => {
      mockedFindDocument.mockResolvedValue({ id: 'doc-42', companyId: 'company-42', typeId: 'invoice' });
      mockedCreateEvents.mockResolvedValue(1);
      const channelCredentials = buildChannelCredentials();
      const service = new PecNotificheService(channelCredentials as never);

      await service.handleMessage(
        'company-42',
        message({
          from: 'sdi07@pec.fatturapa.it',
          attachments: [
            {
              filename: 'IT01234567890_00001.xml',
              content: Buffer.from(
                notificaXml('notificaDecorrenzaTermini', '123456789012', 'IT01234567890_00001.xml'),
              ),
            },
          ],
        }),
      );

      expect(channelCredentials.upsertChannelConfig).not.toHaveBeenCalled();
    });

    it("never learns from a notifica that failed to reconcile with a known document, even from SdI's own domain with a hint type", async () => {
      mockedFindDocument.mockResolvedValue(null);
      const channelCredentials = buildChannelCredentials();
      const service = new PecNotificheService(channelCredentials as never);

      await service.handleMessage(
        'company-42',
        message({
          from: 'sdi07@pec.fatturapa.it',
          attachments: [
            {
              filename: 'IT01234567890_99999.xml',
              content: Buffer.from(
                notificaXml('ricevutaConsegna', '999999999999', 'IT01234567890_99999.xml'),
              ),
            },
          ],
        }),
      );

      expect(channelCredentials.upsertChannelConfig).not.toHaveBeenCalled();
    });

    it('never crashes when the "sdi-pec" channel has since been disconnected', async () => {
      mockedFindDocument.mockResolvedValue({ id: 'doc-42', companyId: 'company-42', typeId: 'invoice' });
      mockedCreateEvents.mockResolvedValue(1);
      const channelCredentials = buildChannelCredentials({
        resolveActive: vi.fn().mockResolvedValue(null),
      });
      const service = new PecNotificheService(channelCredentials as never);

      await expect(
        service.handleMessage(
          'company-42',
          message({
            attachments: [
              {
                filename: 'IT01234567890_00001.xml',
                content: Buffer.from(
                  notificaXml('ricevutaConsegna', '123456789012', 'IT01234567890_00001.xml'),
                ),
              },
            ],
          }),
        ),
      ).resolves.toMatchObject({ handled: true });
      expect(channelCredentials.upsertChannelConfig).not.toHaveBeenCalled();
    });
  });
});
