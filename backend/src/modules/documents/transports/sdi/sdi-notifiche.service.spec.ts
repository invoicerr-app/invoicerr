/**
 * `SdiNotificheService` in isolation — `conformity/authority-events.persistence.ts` is mocked
 * wholesale (the same "mock the persistence boundary, never the ORM underneath it" discipline
 * `conformity-sweep-runner.spec.ts` already holds for the identical module). Facts proven:
 *
 *  1. A notifica for a KNOWN `IdentificativoSdI` (a `DocumentInstance.transportRef` this codebase
 *     actually has, for the "sdi" channel) is journaled into `DocumentAuthorityEvent`, on THAT
 *     document's own (companyId, documentId) — never a different one. Proven on BOTH routes: the
 *     `:token` route (`findOwnedDocumentByTransportRef`, scoped by the token's own company) and the
 *     legacy route (`findDocumentByTransportRef` + the `idTrasmittente`/`NomeFile` content check).
 *  2. A notifica for an UNKNOWN reference journals NOTHING — `createAuthorityEvents` must never be
 *     called at all, on ANY document (an implementation that "journals onto an arbitrary document
 *     instead" is exactly the bug this test exists to catch; asserting `not.toHaveBeenCalled()` — not
 *     merely "not called with THIS specific id" — is what makes that mutation bite).
 *  3. THE CROSS-TENANT CASE — a notifica carrying a `transportRef` that genuinely belongs to a
 *     DIFFERENT company than the one the caller is scoped to (by token, or — on the legacy route — by
 *     `idTrasmittente`) is refused exactly the same way as an unknown reference: nothing journaled,
 *     no webhook, no live event. This is the mutation the endpoint's own pre-fix shape would have let
 *     through (see `sdi-notifiche.service.ts`'s own header).
 */
import { vi, type Mock } from 'vitest';
import * as persistence from '../../conformity/authority-events.persistence';
import * as documentPersistence from '../../persistence';
import { SDI_PROVIDER_ID, SdiNotificheService } from './sdi-notifiche.service';

vi.mock('../../conformity/authority-events.persistence');
// Needed ONLY for the "webhooks" describe block below:
// `dispatchDocumentAuthorityEventWebhook` (`queue/document-authority-webhook.ts`) re-fetches the row
// via `findOwnedDocument` before dispatching `DOCUMENT_AUTHORITY_EVENT` — every test ABOVE that block
// never configures a `webhookDispatcher`, so that fetch never runs for them.
vi.mock('../../persistence');

const mockedFindDocument = persistence.findDocumentByTransportRef as Mock;
const mockedFindOwnedDocumentByTransportRef = persistence.findOwnedDocumentByTransportRef as Mock;
const mockedCreateEvents = persistence.createAuthorityEvents as Mock;

/** The exact `NomeFile` shape `sdi-transport.ts#send` builds: `${idTrasmittente}_…` — see this
 *  file's own header, fact 3, and `sdi-notifiche.service.ts#resolveDocumentLegacy`'s own header. */
const RC_XML = (
  idSdI: string,
  nomeFile = 'IT01234567890_0000000001.xml',
) => `<?xml version="1.0" encoding="UTF-8"?>
  <soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">
    <soap:Body>
      <ns:ricevutaConsegna xmlns:ns="http://www.fatturapa.gov.it/sdi/ws/trasmissione/v1.0/types">
        <ns:IdentificativoSdI>${idSdI}</ns:IdentificativoSdI>
        <ns:NomeFile>${nomeFile}</ns:NomeFile>
        <ns:File>PGZvbz48L2Zvbz4=</ns:File>
      </ns:ricevutaConsegna>
    </soap:Body>
  </soap:Envelope>`;

/** A minimal `ChannelCredentialsService` double — only the two methods `sdi-notifiche.service.ts`
 *  actually calls (`resolveActive` for the legacy content check, `resolvePushToken` for the token
 *  route). Real class behavior (encryption, the "at most one active environment" invariant) is
 *  `channels.service.spec.ts`'s own job — this file only proves what THIS service does with the
 *  answers it gets back. */
function fakeChannelCredentials(overrides: { resolveActive?: Mock; resolvePushToken?: Mock } = {}) {
  return {
    resolveActive: overrides.resolveActive ?? vi.fn().mockResolvedValue(null),
    resolvePushToken: overrides.resolvePushToken ?? vi.fn().mockResolvedValue(null),
  };
}

/** A `resolveActive` double whose config carries exactly the `idTrasmittente` `RC_XML`'s own default
 *  `NomeFile` prefix expects — the legacy route's "legitimate notifica" case. */
function channelCredentialsWithIdTrasmittente(idTrasmittente: string) {
  return fakeChannelCredentials({
    resolveActive: vi.fn().mockResolvedValue({ config: { idTrasmittente } }),
  });
}

describe('SdiNotificheService.handleNotifica — legacy route (no token)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('journals an RC notifica for a KNOWN IdentificativoSdI onto its own (companyId, documentId), never another', async () => {
    mockedFindDocument.mockResolvedValue({ id: 'doc-42', companyId: 'company-42' });
    mockedCreateEvents.mockResolvedValue(1);
    const channelCredentials = channelCredentialsWithIdTrasmittente('IT01234567890');

    const service = new SdiNotificheService(undefined, undefined, channelCredentials as never);
    const result = await service.handleNotifica(RC_XML('123456789012'));

    expect(result).toEqual({ journaled: true, notificaType: 'RC', identificativoSdI: '123456789012' });
    expect(mockedFindDocument).toHaveBeenCalledWith(SDI_PROVIDER_ID, '123456789012');
    expect(channelCredentials.resolveActive).toHaveBeenCalledWith('company-42', SDI_PROVIDER_ID);
    expect(mockedCreateEvents).toHaveBeenCalledTimes(1);
    expect(mockedCreateEvents).toHaveBeenCalledWith(
      'company-42',
      'doc-42',
      SDI_PROVIDER_ID,
      expect.arrayContaining([expect.objectContaining({ statusCode: 'it:RC' })]),
    );
  });

  it('an unknown IdentificativoSdI journals NOTHING, on ANY document', async () => {
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

  // THE MUTATION TARGET (legacy route): `transportRef` alone used to be enough — a forged notifica
  // for a `IdentificativoSdI` that genuinely belongs to another company's document was journaled onto
  // it with no further check. `resolveDocumentLegacy`'s own content check is what now stands in for
  // the URL-level scoping the token route gets — see `sdi-notifiche.service.ts`'s own header.
  describe("the second line of defense — NomeFile must match the resolved company's own idTrasmittente", () => {
    it('refuses when the resolved document\'s own company has NO "sdi" channel connected at all', async () => {
      mockedFindDocument.mockResolvedValue({ id: 'doc-victim', companyId: 'company-victim' });
      const channelCredentials = fakeChannelCredentials(); // resolveActive() -> null, unconfigured

      const service = new SdiNotificheService(undefined, undefined, channelCredentials as never);
      const result = await service.handleNotifica(RC_XML('123456789012'));

      expect(result).toEqual({ journaled: false, notificaType: 'RC', identificativoSdI: '123456789012' });
      expect(mockedCreateEvents).not.toHaveBeenCalled();
    });

    it("refuses when NomeFile does not start with that company's own idTrasmittente — a forger who guessed the ref but not the identifier", async () => {
      mockedFindDocument.mockResolvedValue({ id: 'doc-victim', companyId: 'company-victim' });
      // The victim's REAL idTrasmittente is nothing like the forged notifica's own NomeFile prefix.
      const channelCredentials = channelCredentialsWithIdTrasmittente('IT99999999999');

      const service = new SdiNotificheService(undefined, undefined, channelCredentials as never);
      const result = await service.handleNotifica(RC_XML('123456789012', 'IT01234567890_0000000001.xml'));

      expect(result).toEqual({ journaled: false, notificaType: 'RC', identificativoSdI: '123456789012' });
      expect(mockedCreateEvents).not.toHaveBeenCalled();
    });
  });
});

describe('SdiNotificheService.handleNotifica — :token route (per-company, recommended)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("resolves a document scoped to the token's own company, never a bare transportRef lookup", async () => {
    const channelCredentials = fakeChannelCredentials({
      resolvePushToken: vi.fn().mockResolvedValue({ companyId: 'company-42', environment: 'TEST' }),
    });
    mockedFindOwnedDocumentByTransportRef.mockResolvedValue({ id: 'doc-42', companyId: 'company-42' });
    mockedCreateEvents.mockResolvedValue(1);

    const service = new SdiNotificheService(undefined, undefined, channelCredentials as never);
    const result = await service.handleNotifica(RC_XML('123456789012'), 'company-42-token');

    expect(result).toEqual({ journaled: true, notificaType: 'RC', identificativoSdI: '123456789012' });
    expect(channelCredentials.resolvePushToken).toHaveBeenCalledWith(SDI_PROVIDER_ID, 'company-42-token');
    expect(mockedFindOwnedDocumentByTransportRef).toHaveBeenCalledWith(
      'company-42',
      SDI_PROVIDER_ID,
      '123456789012',
    );
    // The token route never falls back to the unscoped lookup — proving that is what makes the
    // cross-tenant test below actually bite (an implementation that "tries the token, then falls
    // back to the bare lookup on a miss" would defeat the whole point of this route).
    expect(mockedFindDocument).not.toHaveBeenCalled();
  });

  it('refuses an unknown/inactive/wrong-provider token — nothing journaled, no lookup attempted', async () => {
    const channelCredentials = fakeChannelCredentials(); // resolvePushToken() -> null

    const service = new SdiNotificheService(undefined, undefined, channelCredentials as never);
    const result = await service.handleNotifica(RC_XML('123456789012'), 'not-a-real-token');

    expect(result).toEqual({ journaled: false, notificaType: 'RC', identificativoSdI: '123456789012' });
    expect(mockedFindOwnedDocumentByTransportRef).not.toHaveBeenCalled();
    expect(mockedCreateEvents).not.toHaveBeenCalled();
  });

  // THE PRIMARY CROSS-TENANT TEST: `company-attacker`'s own token is valid and resolves — but the
  // `IdentificativoSdI` in the forged notifica actually belongs to `company-victim`'s real document.
  // `findOwnedDocumentByTransportRef` is scoped to `company-attacker`, so it finds nothing — exactly
  // as it must, whether or not `company-victim`'s document (or ref) exists at all anywhere else.
  it('refuses a notifica whose transportRef belongs to a DIFFERENT company than the token identifies', async () => {
    const channelCredentials = fakeChannelCredentials({
      resolvePushToken: vi.fn().mockResolvedValue({ companyId: 'company-attacker', environment: 'TEST' }),
    });
    // Scoped lookup for `company-attacker` finds nothing — the mock never returns `company-victim`'s
    // document, because a real, correctly-scoped `findOwnedDocumentByTransportRef` never would either.
    mockedFindOwnedDocumentByTransportRef.mockResolvedValue(null);

    const service = new SdiNotificheService(undefined, undefined, channelCredentials as never);
    const result = await service.handleNotifica(RC_XML('123456789012'), 'company-attacker-token');

    expect(result).toEqual({ journaled: false, notificaType: 'RC', identificativoSdI: '123456789012' });
    expect(mockedFindOwnedDocumentByTransportRef).toHaveBeenCalledWith(
      'company-attacker',
      SDI_PROVIDER_ID,
      '123456789012',
    );
    expect(mockedCreateEvents).not.toHaveBeenCalled();
  });
});

// `DOCUMENT_AUTHORITY_EVENT`, dispatched via `dispatchDocumentAuthorityEventWebhook`
// at the SAME "genuinely new row" gate (`count > 0`) the existing SSE nudge already uses.
// `webhookDispatcher` is this service's 2nd constructor arg — every test ABOVE this block constructs
// the service with zero/one/three args and must keep passing unchanged.
describe('SdiNotificheService — webhooks and live events', () => {
  const mockedFindOwnedDocument = documentPersistence.findOwnedDocument as Mock;

  beforeEach(() => {
    vi.clearAllMocks();
    mockedFindOwnedDocument.mockResolvedValue({ id: 'doc-42', typeId: 'invoice', status: 'sent' });
  });

  it('dispatches DOCUMENT_AUTHORITY_EVENT for a genuinely journaled RC notifica (legacy route)', async () => {
    mockedFindDocument.mockResolvedValue({ id: 'doc-42', companyId: 'company-42', typeId: 'invoice' });
    mockedCreateEvents.mockResolvedValue(1);
    const channelCredentials = channelCredentialsWithIdTrasmittente('IT01234567890');
    const webhooks = { dispatch: vi.fn().mockResolvedValue(undefined) };

    const service = new SdiNotificheService(undefined, webhooks, channelCredentials as never);
    await service.handleNotifica(RC_XML('123456789012'));

    expect(webhooks.dispatch).toHaveBeenCalledTimes(1);
    expect(webhooks.dispatch).toHaveBeenCalledWith('DOCUMENT_AUTHORITY_EVENT', {
      documentId: 'doc-42',
      typeId: 'invoice',
      companyId: 'company-42',
      occurredAt: expect.any(String),
      document: { id: 'doc-42', typeId: 'invoice', status: 'sent' },
      providerId: SDI_PROVIDER_ID,
      statusCode: 'it:RC',
    });
  });

  it('never dispatches for an unknown IdentificativoSdI — nothing was journaled', async () => {
    mockedFindDocument.mockResolvedValue(null);
    const webhooks = { dispatch: vi.fn() };

    const service = new SdiNotificheService(undefined, webhooks);
    await service.handleNotifica(RC_XML('999999999999'));

    expect(webhooks.dispatch).not.toHaveBeenCalled();
  });

  // THE CROSS-TENANT WEBHOOK/LIVE-EVENT PROOF: even though `company-victim`'s document genuinely
  // exists and genuinely carries this `transportRef`, a caller scoped to `company-attacker` (by
  // token) must trigger NEITHER the webhook NOR the SSE publish — both live behind the SAME
  // `count > 0` gate `createAuthorityEvents` never reaches once resolution itself has failed.
  it('never dispatches a webhook and never publishes a live event for a cross-tenant notifica', async () => {
    const channelCredentials = fakeChannelCredentials({
      resolvePushToken: vi.fn().mockResolvedValue({ companyId: 'company-attacker', environment: 'TEST' }),
    });
    mockedFindOwnedDocumentByTransportRef.mockResolvedValue(null);
    const eventsPublisher = { publish: vi.fn() };
    const webhooks = { dispatch: vi.fn() };

    const service = new SdiNotificheService(eventsPublisher as never, webhooks, channelCredentials as never);
    await service.handleNotifica(RC_XML('123456789012'), 'company-attacker-token');

    expect(mockedCreateEvents).not.toHaveBeenCalled();
    expect(eventsPublisher.publish).not.toHaveBeenCalled();
    expect(webhooks.dispatch).not.toHaveBeenCalled();
  });

  it('never touches webhookDispatcher at all when absent — every pre-existing caller keeps working unchanged', async () => {
    mockedFindDocument.mockResolvedValue({ id: 'doc-42', companyId: 'company-42', typeId: 'invoice' });
    mockedCreateEvents.mockResolvedValue(1);
    const channelCredentials = channelCredentialsWithIdTrasmittente('IT01234567890');

    const service = new SdiNotificheService(undefined, undefined, channelCredentials as never); // no webhookDispatcher
    await expect(service.handleNotifica(RC_XML('123456789012'))).resolves.toEqual({
      journaled: true,
      notificaType: 'RC',
      identificativoSdI: '123456789012',
    });
  });
});
