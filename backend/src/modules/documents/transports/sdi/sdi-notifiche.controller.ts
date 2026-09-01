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
 * See `sdi-notifiche.service.ts`'s own header for the "why 200 always, why no per-route mTLS yet"
 * reasoning — this controller's OWN job is limited to reading the body and delegating; every business
 * decision (parse, reconcile, journal, log) lives in the service, so this file has as little logic to
 * get wrong as possible.
 */
import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import { Request } from 'express';

import { Public } from '@thallesp/nestjs-better-auth';

import { logger } from '@/logger/logger.service';

import { SdiNotificheService } from './sdi-notifiche.service';

/** Reads the ENTIRE request body as a UTF-8 string. Express's own `Request` is a Node
 *  `IncomingMessage` (a Readable stream) — consuming it this way works whether or not any prior
 *  middleware already inspected it, PROVIDED that middleware didn't already consume the stream (the
 *  global `bodyParser.json()` in `main.ts` doesn't, for a non-JSON Content-Type — see this file's own
 *  header). */
function readRawBody(req: Request): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer | string) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
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
   * `TrasmissioneFatture`'s six one-way operations (RicevutaConsegna/NotificaMancataConsegna/
   * NotificaScarto/NotificaEsito/NotificaDecorrenzaTermini/AttestazioneTrasmissioneFattura) all land
   * on this SAME endpoint — the SOAP root element itself (parsed by `sdi-notifiche.ts#parseSdiNotifica`)
   * disambiguates which one fired, never the URL path. Every read spec for these six operations ends
   * with "non prevede Response SOAP" (see `sdi-notifiche.ts`'s own header) — an empty 200 is the
   * simplest, safest reading of that: no known caller (real or future) needs a response BODY, and 200
   * (never a 4xx/5xx) is what keeps a malformed or unrecognized notifica from being retried forever
   * (`@HttpCode(200)`, always, even on an internal error below — this ONE route is deliberately never
   * allowed to answer anything else).
   */
  @Public()
  @Post('notifiche')
  @HttpCode(200)
  async receiveNotifica(@Req() req: Request): Promise<void> {
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
      await this.sdiNotificheService.handleNotifica(rawXml);
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
