/**
 * The ONE `@Public()` route for the SdI push notifiche — same reasoning
 * `public/public-documents.controller.ts`'s own header already gives for keeping an unauthenticated
 * route in a controller of its own: "does this controller require a session" stays a per-FILE fact.
 * `@Public()` here is `@thallesp/nestjs-better-auth`'s own decorator (the one actually wired to
 * `AuthGuard` — see that controller's own header on why NOT `@/decorators/public.decorator.ts`).
 *
 * SdI POSTs `text/xml` (SOAP 1.1), never `application/json` — `main.ts` applies a single global
 * `bodyParser.json()` ahead of routing, which SKIPS (never consumes the stream for) any request whose
 * Content-Type isn't `application/json`, so the raw body is read directly off the request stream here
 * — `readRawBody` below, the same "read the stream by hand" shape `webhooks.controller.ts`'s own
 * HMAC-verification comment describes for its OWN (JSON, `rawBody`-captured) case, adapted for a
 * content type that never reaches that capture in the first place.
 *
 * ## Two routes, one handler — `notifiche` (legacy) and `notifiche/:token` (per-company)
 *
 * `sdi-notifiche.service.ts`'s own header has the full "why": resolving a document by
 * `IdentificativoSdI` alone, with no notion of which tenant is asking, let any caller past the shared
 * secret below forge an authority event onto a DIFFERENT company's document. `:token` is the fix —
 * `CompanyChannelConfig.pushToken`, a per-(company, provider, environment) value a company pastes
 * into the reception-endpoint field AdE's own Sistema di Accreditamento already asks for at SDICoop
 * channel setup ("service endpoints for reception", `documentation/docs/developer-guide/credentials-guide.md` §4) — so the URL
 * a company registers becomes `.../public/sdi/notifiche/<their own token>`, and the service scopes
 * its lookup to exactly that company. The bare `notifiche` route (no token) stays mounted, unchanged
 * in shape, for a company that already registered THAT URL before this fix shipped — see
 * `sdi-notifiche.service.ts#resolveDocumentLegacy` for the content-based check it now runs instead of
 * a blind lookup. Both routes share every other control on this file (the secret, the content-type
 * gate, the body cap) — only WHICH document the notifica is allowed to resolve to differs.
 *
 * ## Why this route checks a shared secret BEFORE touching the body at all
 *
 * `@Public()` used to mean "no check whatsoever" here: `sdi-notifiche.service.ts`'s own
 * `findDocumentByTransportRef` resolves the target document by `IdentificativoSdI` ALONE, with no
 * notion of which tenant is asking — and that identifier is SdI's own, handed back on deposit, never
 * treated as a secret anywhere in this codebase. Anyone who learns one (it is not guessable, but it is
 * also not confidential) could POST a forged `<notificaScarto>`/`<ricevutaConsegna>`/… and have this
 * endpoint journal a fabricated `DocumentAuthorityEvent` — and fire that tenant's own outbound webhook
 * — for a real document that never actually saw that outcome. `isAuthenticated` below is the interim
 * control until server-side mTLS is wired (see `sdi-notifiche.service.ts`'s own header for that plan):
 * a shared secret, agreed out of band with whoever operates this deployment, carried in a header SdI's
 * own transport does not otherwise use. DENIES BY DEFAULT — `SDI_NOTIFICHE_SHARED_SECRET` unset (true
 * for every deployment today; this channel is "dormant" per `sdi-notifiche.service.ts`'s own header,
 * nothing yet points real SdI traffic at it) means every request is refused, never the previous
 * "wide open until someone bothers to configure something" default. `timingSafeEqual` (never `===`)
 * for the actual comparison — the same discipline `documents/signatures/otp.ts` already holds, so a
 * response-time side channel cannot narrow the secret one byte at a time.
 *
 * The Content-Type gate right after it exists for a second, independent reason: `main.ts`'s global
 * `bodyParser.json()` DOES consume the stream for an `application/json` request before this handler
 * ever runs. Falling through to `readRawBody` for such a request would attach `'data'`/`'end'`
 * listeners to a stream that has already ended — `'end'` never fires again for a late listener, so the
 * returned promise never settles and the connection (and whatever handle it holds) leaks forever. This
 * codebase has no per-route body-size limit here (the global JSON parser's own 1 MB cap does not apply
 * to a non-JSON Content-Type at all), so `readRawBody`'s own hard byte cap below is what actually
 * bounds a `text/xml`/`application/soap+xml` request.
 */
import { timingSafeEqual } from 'node:crypto';

import { Controller, HttpCode, Param, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';

import { Public } from '@thallesp/nestjs-better-auth';

import { logger } from '@/logger/logger.service';

import { SdiNotificheService } from './sdi-notifiche.service';

/** SdI's own largest routine payload (a full FatturaPA XML echoed back inside a notifica) is well
 *  under 1 MB in practice; this is a generous, still-finite ceiling — protecting the process's memory
 *  from an unbounded `Buffer.concat`, never a realistic transmission limit. */
const MAX_NOTIFICA_BODY_BYTES = 5 * 1024 * 1024;

/** The header a shared secret (see this file's own header) travels in — deliberately not a standard
 *  SOAP/HTTP header SdI's own transport would ever set on its own, so its mere presence already means
 *  "someone who knows our out-of-band secret", never an accident of a generic SOAP client. */
const SDI_NOTIFICA_SECRET_HEADER = 'x-sdi-notifica-secret';

const ALLOWED_NOTIFICA_CONTENT_TYPES = ['text/xml', 'application/xml', 'application/soap+xml'];

/** True only when `SDI_NOTIFICHE_SHARED_SECRET` is configured AND the request carries the exact same
 *  value in `SDI_NOTIFICA_SECRET_HEADER` — see this file's own header for why an UNSET secret means
 *  "refuse everything", not "accept everything". */
function isAuthenticated(req: Request): boolean {
  const expected = process.env.SDI_NOTIFICHE_SHARED_SECRET;
  if (!expected) return false;

  const provided = req.headers[SDI_NOTIFICA_SECRET_HEADER];
  if (typeof provided !== 'string' || provided.length === 0) return false;

  // `timingSafeEqual` throws on a length mismatch rather than returning false — checked explicitly
  // first, which itself leaks only the (already public) LENGTH of the secret, never any of its bytes.
  const expectedBuf = Buffer.from(expected, 'utf-8');
  const providedBuf = Buffer.from(provided, 'utf-8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

/** Whether `req`'s own Content-Type is one this endpoint ever legitimately receives — checked BEFORE
 *  `readRawBody` is ever called, see this file's own header on why falling through for e.g.
 *  `application/json` would hang the connection rather than merely misparse. Compared with `startsWith`
 *  so a charset suffix (`text/xml; charset=UTF-8`, what SdI actually sends) still matches. */
function hasAllowedContentType(req: Request): boolean {
  const contentType = (req.headers['content-type'] ?? '').toString().toLowerCase();
  return ALLOWED_NOTIFICA_CONTENT_TYPES.some((allowed) => contentType.startsWith(allowed));
}

/** Reads the ENTIRE request body as a UTF-8 string, up to `MAX_NOTIFICA_BODY_BYTES` — beyond that the
 *  socket is destroyed and the promise rejects, rather than growing an unbounded `Buffer.concat` for as
 *  long as a caller cares to keep streaming (this route has no reverse-proxy in front of it that is
 *  guaranteed to cap request size for every deployment topology — see this file's own header). Express's
 *  own `Request` is a Node `IncomingMessage` (a Readable stream) — consuming it this way works whether
 *  or not any prior middleware already inspected it, PROVIDED that middleware didn't already consume
 *  the stream (the global `bodyParser.json()` in `main.ts` doesn't, for a non-JSON Content-Type — see
 *  this file's own header, and `hasAllowedContentType` above for why that case never reaches here). */
function readRawBody(req: Request): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    req.on('data', (chunk: Buffer | string) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      total += buf.length;
      if (total > MAX_NOTIFICA_BODY_BYTES) {
        req.destroy();
        reject(new Error(`SdI notifica body exceeded ${MAX_NOTIFICA_BODY_BYTES} bytes.`));
        return;
      }
      chunks.push(buf);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

@ApiExcludeController()
@Controller('public/sdi')
export class SdiNotificheController {
  constructor(private readonly sdiNotificheService: SdiNotificheService) {}

  /**
   * `POST /public/sdi/notifiche/:token` — the RECOMMENDED route: `token` is a company's own
   * `CompanyChannelConfig.pushToken`, pasted into AdE's own accreditation portal as this channel's
   * reception endpoint (see this file's own header). Everything else is identical to the legacy route
   * below — same secret, same content-type gate, same body cap — only the resolved document's tenant
   * scope differs (`sdi-notifiche.service.ts#resolveDocumentForToken`).
   */
  @Public()
  @Post('notifiche/:token')
  @HttpCode(200)
  async receiveNotificaForToken(@Req() req: Request, @Param('token') token: string): Promise<void> {
    await this.handle(req, token);
  }

  /**
   * `TrasmissioneFatture`'s six one-way operations (RicevutaConsegna/NotificaMancataConsegna/
   * NotificaScarto/NotificaEsito/NotificaDecorrenzaTermini/AttestazioneTrasmissioneFattura) all land
   * on this SAME endpoint — the SOAP root element itself (parsed by `sdi-notifiche.ts#parseSdiNotifica`)
   * disambiguates which one fired, never the URL path. Every read spec for these six operations ends
   * with "non prevede Response SOAP" (see `sdi-notifiche.ts`'s own header) — an empty 200 is the
   * simplest, safest reading of that: no known caller (real or future) needs a response BODY, and 200
   * (never a 4xx/5xx) is what keeps a malformed or unrecognized notifica from being retried forever
   * (`@HttpCode(200)`, always, even on an internal error or a rejected caller below — this ONE route is
   * deliberately never allowed to answer anything else, including to something that failed
   * authentication: a 401/403 would confirm to a prober that the endpoint exists and is listening for
   * exactly this shape at all).
   *
   * The LEGACY route — kept mounted, unchanged in shape, for a company that registered THIS URL with
   * AdE before the `:token` route above existed (see this file's own header). Never removed and never
   * gated behind "has anyone migrated yet": SdI must keep being answered 200 either way, and this
   * route's own reduced trust now lives in `sdi-notifiche.service.ts#resolveDocumentLegacy`, not here.
   */
  @Public()
  @Post('notifiche')
  @HttpCode(200)
  async receiveNotifica(@Req() req: Request): Promise<void> {
    await this.handle(req, undefined);
  }

  /** Shared by both routes above — see each route's own header for what `token` changes. */
  private async handle(req: Request, token: string | undefined): Promise<void> {
    if (!isAuthenticated(req)) {
      logger.warn('SdI notifica: rejected — missing or mismatched shared secret', {
        category: 'documents',
      });
      return;
    }

    if (!hasAllowedContentType(req)) {
      logger.warn('SdI notifica: rejected — unexpected Content-Type', {
        category: 'documents',
        details: { contentType: req.headers['content-type'] },
      });
      return;
    }

    let rawXml: string;
    try {
      rawXml = await readRawBody(req);
    } catch (err) {
      logger.error('SdI notifica: failed to read the request body', {
        category: 'documents',
        details: { message: err instanceof Error ? err.message : String(err) },
      });
      return;
    }

    try {
      await this.sdiNotificheService.handleNotifica(rawXml, token);
    } catch (err) {
      // A genuine infrastructure failure (e.g. the database unreachable) — logged loudly, but this
      // route still answers 200: see this file's own header on why SdI must never be driven to retry
      // forever by a fault that is entirely on OUR side, not the notifica's own content.
      logger.error('SdI notifica: unexpected failure while handling it', {
        category: 'documents',
        details: { message: err instanceof Error ? err.message : String(err) },
      });
    }
  }
}
