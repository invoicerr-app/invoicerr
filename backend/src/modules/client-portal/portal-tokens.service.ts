import { Injectable, NotFoundException } from '@nestjs/common';

import { MailService } from '@/mail/mail.service';
import { logger } from '@/logger/logger.service';
import { resolveRecipientLanguage } from '@/modules/documents/rendering/language/resolve-recipient-language';
import { RenderLanguage } from '@/modules/documents/rendering/language/supported-languages';
import prisma from '@/prisma/prisma.service';
import { withDerivedContactFields } from '@/modules/clients/primary-contact';

import { buildPortalInviteEmail } from './portal-invite-email';
import { generatePortalToken } from './portal-token';
import {
  createPortalToken,
  findOwnedPortalToken,
  listPortalTokens,
  PortalTokenRecord,
  revokeAllPortalTokens,
  revokePortalToken,
} from './portal-token.persistence';

/** 30 days — the same default `share-links/share-links.service.ts#DEFAULT_TTL_MS` picked for the
 *  identical reason: long enough that "list the active invite, revoke it" stays a meaningful staff
 *  action instead of racing an expiry that already happened, short enough that an abandoned,
 *  never-revoked invite does not stand open forever. A client who lets this window lapse simply asks
 *  the company for a fresh invite (`create` below) — there is no self-service renewal today, a
 *  deliberate scope cut (see this feature's own report) rather than a gap discovered later. */
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * WHY the invite email was, or was not, sent — the two `false`-shaped outcomes `emailed` used to
 * conflate into one indistinguishable value. Distinguishing them here (rather than just in a log
 * line) is what lets `PortalAccessController`'s caller show the RIGHT message: "this client has no
 * email on file, add one" is actionable for staff, "the invite email failed to send" (e.g. SMTP is
 * down) is a completely different problem with a completely different fix — showing the "no email
 * on file" text for the second case sends staff chasing a client-record problem that does not exist.
 */
export type PortalInviteEmailStatus = 'sent' | 'no_contact_email' | 'send_failed';

export interface CreatedPortalAccess {
  id: string;
  /** The RAW token — exposed exactly ONCE, same "never re-consultable" contract
   *  `share-links/share-links.service.ts#CreatedShareLink` already documents. */
  token: string;
  /** "/portal/:token" — the frontend's own bootstrap route (`pages/portal/[token].tsx`), which
   *  captures the token and never re-shows it in the address bar afterwards. */
  path: string;
  expiresAt: Date;
  /** Whether an invite email was actually sent — `true` iff `emailStatus === 'sent'`. Kept as a
   *  plain boolean (rather than dropped in favor of `emailStatus` alone) for callers that only ever
   *  cared about yes/no; a failed or skipped send (logged, never thrown: the staff caller still gets
   *  the token/path back and can hand it to the client through any other channel, the same "the
   *  primary action never fails because a side-channel email did" contract share-link creation
   *  already holds) sets this `false` — see `emailStatus` for WHY. */
  emailed: boolean;
  /** WHY `emailed` is `false`, when it is — see `PortalInviteEmailStatus`'s own header. */
  emailStatus: PortalInviteEmailStatus;
}

export interface PortalAccessSummary {
  id: string;
  createdAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastUsedAt: Date | null;
  /** Derived, never stored — see `share-links.service.ts#ShareLinkSummary`'s identical field. */
  active: boolean;
}

function toSummary(record: PortalTokenRecord, now: Date): PortalAccessSummary {
  return {
    id: record.id,
    createdAt: record.createdAt,
    expiresAt: record.expiresAt,
    revokedAt: record.revokedAt,
    lastUsedAt: record.lastUsedAt,
    active: !record.revokedAt && record.expiresAt > now,
  };
}

/**
 * The staff-facing CRUD half of the client portal — "invite this client", "see who has an active
 * invite", "revoke it" — on the model of `ShareLinksService`: a small class reusing an existing
 * tenant-scoped 404 (here, `Client.findFirst` by `companyId`) rather than re-implementing it.
 */
@Injectable()
export class PortalTokensService {
  constructor(private readonly mailService: MailService) {}

  /** 404s (rather than returning null) when `clientId` doesn't exist or belongs to another company —
   *  the two cases are indistinguishable from the outside, the same discipline every other tenant-
   *  scoped read in this codebase already holds. */
  private async findOwnedClientOrThrow(companyId: string, clientId: string) {
    // Includes `contacts` and derives the legacy flat fields (#415) - `create()` below reads
    // `client.contactEmail` exactly as it always has, now resolved from the PRIMARY contact.
    const client = await prisma.client.findFirst({
      where: { id: clientId, companyId },
      include: { contacts: { orderBy: [{ isPrimary: 'desc' }, { position: 'asc' }] } },
    });
    if (!client) {
      throw new NotFoundException(`Client "${clientId}" not found for this company.`);
    }
    return withDerivedContactFields(client);
  }

  /**
   * Mints a fresh invite. Best-effort emails it to the client's own `contactEmail` when one is on
   * file — see `CreatedPortalAccess.emailed`'s own header for why a failed (or skipped) send never
   * fails this call: the staff caller can always copy `path` from the response, same as a share link.
   */
  async create(companyId: string, clientId: string): Promise<CreatedPortalAccess> {
    const client = await this.findOwnedClientOrThrow(companyId, clientId);
    const company = await prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      // `language` — the FALLBACK step of this invite's own recipient-language resolution below, for
      // a client who never set their own `Client.language`.
      select: { name: true, language: true },
    });

    const { token, tokenHash } = generatePortalToken();
    const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS);
    const record = await createPortalToken({ companyId, clientId, tokenHash, expiresAt });

    const path = `/portal/${token}`;
    // Per-recipient document language — the SAME resolution order a document's own PDF/send-email
    // uses (`rendering/language/resolve-recipient-language.ts`): the invited client's own
    // `Client.language` wins when set, else this company's own `Company.language`, else the shared
    // default. `findOwnedClientOrThrow` returns the full `Client` row (no `select`), so `client.language`
    // is already in hand here.
    const language = resolveRecipientLanguage(client.language, company.language);
    const emailStatus = await this.tryEmailInvite(
      companyId,
      client.contactEmail,
      company.name,
      path,
      language,
    );

    return {
      id: record.id,
      token,
      path,
      expiresAt: record.expiresAt,
      emailed: emailStatus === 'sent',
      emailStatus,
    };
  }

  async list(companyId: string, clientId: string): Promise<PortalAccessSummary[]> {
    await this.findOwnedClientOrThrow(companyId, clientId);
    const records = await listPortalTokens(companyId, clientId);
    const now = new Date();
    return records.map((record) => toSummary(record, now));
  }

  async revoke(companyId: string, clientId: string, tokenId: string): Promise<{ revoked: true }> {
    await this.findOwnedClientOrThrow(companyId, clientId);
    const owned = await findOwnedPortalToken(companyId, clientId, tokenId);
    if (!owned) {
      throw new NotFoundException(`Portal access "${tokenId}" not found for this client.`);
    }
    await revokePortalToken(owned.id);
    return { revoked: true };
  }

  /** Revokes every currently-active invite for this client — "cut off portal access entirely",
   *  distinct from revoking one row: a client with several outstanding links (a resend, a regenerate)
   *  is fully locked out by one call, never a per-row loop the frontend would have to drive itself. */
  async revokeAll(companyId: string, clientId: string): Promise<{ revoked: true }> {
    await this.findOwnedClientOrThrow(companyId, clientId);
    await revokeAllPortalTokens(companyId, clientId);
    return { revoked: true };
  }

  /** `appUrl` — same `process.env.APP_URL` source `signatures.service.ts#sendSignatureRequestEmail`
   *  already reads, the frontend's own origin (never the backend's — see that file's header). */
  private buildPortalUrl(path: string): string {
    const appUrl = process.env.APP_URL || '';
    return `${appUrl}${path}`;
  }

  private async tryEmailInvite(
    companyId: string,
    contactEmail: string | null,
    companyName: string,
    path: string,
    language: RenderLanguage,
  ): Promise<PortalInviteEmailStatus> {
    if (!contactEmail) return 'no_contact_email';
    const parts = buildPortalInviteEmail({ companyName, portalUrl: this.buildPortalUrl(path), language });
    try {
      // The company → instance → named refusal cascade (`MailService#sendForCompany`) — a company with
      // its own mail server sends its portal invites through it, never the instance's, exactly like a
      // document send. A refusal here (including the named "no mail server configured" one) is caught
      // right below like any other send failure: see `PortalInviteEmailStatus`'s own header for why
      // this never fails the surrounding `create()` call.
      await this.mailService.sendForCompany(companyId, {
        to: contactEmail,
        subject: parts.subject,
        text: parts.text,
        html: parts.html,
      });
      return 'sent';
    } catch (error) {
      logger.error('Failed to send the client portal invite email — the invite link was still created', {
        category: 'client-portal',
        companyId,
        details: { recipient: contactEmail, message: error instanceof Error ? error.message : String(error) },
      });
      return 'send_failed';
    }
  }
}
