import { ResolvedChannelConfig } from '@/modules/company/channels/channels.service';
import { assertDemoSendingAllowed } from '@/modules/demo/demo-blocked';

import { DocumentInstanceResult } from '../actions/action-registry';
import { ArchivedArtifactInput } from '../archive/hashing';
import { DocumentTypeDescriptor } from '../descriptors/types';
import { DocumentFormatBuildOptions } from '../formats/format-provider';

/**
 * Issue #499 - what a transport that BUILDS a structured format (Factur-X, FatturaPA, Peppol BIS...)
 * builds from, when that is not the delivered document itself. The credit note's "send"
 * (`actions/credit-note-actions.ts`) is the one caller that sets it: a credit note owns neither a
 * client nor priced lines (`credit-note.descriptor.ts`, "Two shapes, one type"), so its electronic
 * form is built from the invoice it corrects, priced with the invoice descriptor and marked as a
 * credit note (`formats/credit-note-source.ts`), exactly as its own "download-xml" builds it
 * (`documents.service.ts#downloadDocumentFormat`). `document` keeps the credit note's own id and
 * number; only its `data` is the invoice-shaped, tax-resolved build input.
 */
export interface TransportFormatSource {
  descriptor: DocumentTypeDescriptor;
  document: DocumentInstanceResult;
  options?: DocumentFormatBuildOptions;
}

/**
 * The build input of a format-building transport: `ctx.formatSource` when the caller set one, the
 * delivered document built with the invoice descriptor otherwise (every invoice, exactly as before
 * issue #499). One helper so the seven transports that build a format cannot each read it differently.
 */
export function formatBuildInputOf(
  ctx: DocumentTransportContext,
  invoiceDescriptor: DocumentTypeDescriptor,
): Required<Pick<TransportFormatSource, 'descriptor' | 'document'>> & Pick<TransportFormatSource, 'options'> {
  return {
    descriptor: ctx.formatSource?.descriptor ?? invoiceDescriptor,
    document: ctx.formatSource?.document ?? ctx.document,
    options: ctx.formatSource?.options,
  };
}

/** Everything a transport needs to deliver one document — deliberately NOT an email-shaped context
 *  (no `to`, no `subject`): a transport decides for itself how to address and format the delivery
 *  from the company/document it is handed, the same way a 'reference' field kind never assumes what
 *  its target entity looks like. `text` is OPTIONAL and, as of the built-in "email" transport,
 *  unused: that transport now composes its own subject/body from the document type's `email`
 *  template (descriptors/types.ts, actions/send-document-email.ts) and attaches the rendered PDF
 *  itself, rather than trusting a plain-text body an action pre-built. Left here, optional, for a
 *  hypothetical transport that still wants a caller-supplied plain-text fallback — a transport is
 *  free to use it, wrap it, or ignore it entirely. */
export interface DocumentTransportContext {
  companyId: string;
  document: DocumentInstanceResult;
  /** Plain data (not an i18n key), the same convention as DocumentTypeDescriptor.label — e.g. "Invoice". */
  label: string;
  text?: string;
  /**
   * OPTIONAL — a `formats/format-registry.ts` id this send must build INSTEAD OF whatever a transport
   * builds by DEFAULT. Exists for exactly one reason today: B2G routing (`b2g-routing/schema.ts`'s own
   * `B2gRoutingRuleFact.formatSyntax`) already decides, per COUNTRY, both the transport AND the format
   * a government recipient is owed — but a transport can be format-fixed (`transports/pdp-transport.ts`
   * only ever builds Factur-X, `sdi-transport.ts` only FatturaPA) while the SAME channel could
   * legitimately carry more than one content format. `actions/invoice-actions.ts`'s
   * `resolveB2gInvoiceTransport` sets this to `rule.formatSyntax` whenever a B2G rule is what selected
   * the transport for this send — NEVER for the seller-country mandate or the company's own free
   * choice, and never for a B2G rule whose format happens to equal the transport's own default
   * (chorus-pro/facturx, sdi/fatturapa, face/facturae, anaf/ubl — setting it there is harmless, just
   * redundant, since none of those transports ever reads this field at all).
   *
   * A transport is free to IGNORE this field entirely — the same "optional, ignored by default"
   * contract `text` above already holds — and EVERY transport registered today does exactly that: a
   * fixed-format transport builds its one format regardless of what this names, with NO change in
   * behavior and NO error. The one transport that used to understand this concept, "peppol"
   * (`b2g-routing/data/de.json` named it with `formatSyntax: "xrechnung"` — Germany's federal portal
   * accepted Peppol as a content-agnostic CHANNEL but § 4 Abs. 1 ERechV requires XRechnung, not generic
   * Peppol BIS, as CONTENT), was removed from the product on 2026-09-15 — see that JSON file's own
   * `notes` for the full, dated history. This field is left in place, dormant, for a future transport
   * that legitimately needs to build more than one format: whichever one implements it must still
   * never SILENTLY substitute its own default when it cannot honor a requested override — a named
   * refusal, the same discipline the removed `peppol-transport.ts#resolveFormatForSend` held (a
   * government invoice silently leaving in the wrong format would be worse than a block).
   */
  formatOverride?: string;
  /** Issue #499 - see `TransportFormatSource`. Absent for an invoice. */
  formatSource?: TransportFormatSource;
}

export interface DocumentTransportResult {
  /** Human-facing outcome string — same convention as ActionResult.message. */
  message: string;
  /** An authority/platform-assigned reference the transport got back on delivery — e.g. the PDP
   *  deposit id (`transports/pdp-transport.ts`). Optional: the "email" transport has no such concept
   *  and never sets it. When present, `actions/async-send.ts`'s phase-2 delivery persists it onto
   *  `DocumentInstance.transportRef` (see that column's own schema comment) on the SAME write that
   *  moves the record to "sent". */
  reference?: string;
  /**
   * This transport's OWN registered id (e.g. "pdp", "ksef") — set by every transport that has one
   * (never by "email", which has no provider-side conformity concept at all). Serves post-deposit
   * conformity tracking (`conformity/`): `actions/async-send.ts`'s
   * phase-2 delivery persists this onto `DocumentInstance.channelProviderId` on the SAME write as
   * `reference` above — the conformity sweep needs to know which channel THIS document actually went
   * through, which `Company.invoiceTransportId` alone cannot answer (it is the company's CURRENT
   * choice, free to change after this document was sent). A transport that registers no poller for
   * this id (e.g. "sdi" — push-only SOAP notifiche, see `conformity/pollers/`'s own header) still
   * sets this for the record's own honesty; the sweep simply never selects it, since eligibility is
   * gated on the POLLER REGISTRY knowing the id, not on this column's mere presence.
   */
  providerId?: string;
  /**
   * Legal archiving — the artifacts THIS transport actually delivered, in
   * delivery order: the human-readable PDF (already signed if it was — see
   * `signing/sign-instance-pdf.ts`) for "email", or the structured format actually
   * deposited/submitted for "pdp"/"ksef"/"sdi" (Factur-X/FA(3)/FatturaPA — see each transport's own
   * `send()`) — never both invented for a transport that only ever delivers one kind. Absent (or
   * empty) means nothing conservable came out of this delivery - not a failure, simply nothing to
   * archive. (The credit note's "send" used to be that case; since issue #499 it always archives at
   * least its rendered PDF, see `credit-note-actions.ts`.) `actions/async-send.ts`'s phase-2 delivery archives EXACTLY this list, immutably and
   * hash-wrapped (`archive/hashing.ts`), the moment delivery succeeds — see `archive/archive-on-send.ts`.
   */
  artifacts?: ArchivedArtifactInput[];
}

/**
 * What a THIRD PARTY implements to make a new way of delivering a document. Registered under an id
 * (TransportRegistry.register) that a company then CHOOSES (Company.invoiceTransportId) — the
 * registry never picks one on a company's behalf, and never falls back to one when none is chosen.
 * See invoice-actions.ts's "send" for the one caller today.
 */
export interface DocumentTransport {
  send(ctx: DocumentTransportContext): Promise<DocumentTransportResult>;
  /**
   * An OPTIONAL extra gate `invoice-actions.ts`'s own phase-1 preflight runs, in addition to (never
   * instead of) `resolveInvoiceTransport`'s "is a transport even chosen and registered" check — for a
   * transport whose OWN readiness is a separate fact the registry cannot see (e.g. "pdp": a company
   * can pick `invoiceTransportId: 'pdp'` without ever having connected PDP credentials —
   * `transports/pdp-transport.ts`'s own header). Absent for the "email" transport: nothing about an
   * email address is knowable before a specific document names a client, so there is nothing this
   * hook could check ahead of `send()` itself. Throwing here runs BEFORE the record is ever persisted
   * or queued — the exact same "blocked, and says so, before touching anything" behavior a missing/
   * unregistered transport already gets (see `async-send.ts`'s own `preflight` parameter).
   */
  preflight?(companyId: string): Promise<void>;
  /**
   * Issue #499 - whether this transport can deliver a CREDIT NOTE. A credit note is an invoice in law
   * (CGI art. 289, I, 5), so it travels on the channel the company's invoices travel on
   * (`credit-note-actions.ts`); a channel that cannot carry one refuses the send by name rather than
   * issuing a credit note nobody receives. A transport declaring it reads the buyer, and builds any
   * format, from `ctx.formatSource` (`formatBuildInputOf`), which the credit note's send always sets.
   */
  deliversCreditNotes?: boolean;
  /**
   * Issue #526 (scope addition) - the exact config keys this transport's OWN connect form must
   * collect, replacing what used to be hard-coded, independently, in the frontend's
   * `PROVIDER_FIELDS` (`channels.settings.tsx`) - a second copy of the same shape every transport's
   * own `extractXCredentials`/`parseCredentials` already encodes, free to drift from it silently.
   * Absent (or empty) for a transport with nothing to configure (the built-in "email" transport).
   * Declaring this WITHOUT also declaring `parseCredentials` below is refused at boot - see
   * `validateTransportCredentialFields`.
   */
  credentialFields?: CredentialFieldDescriptor[];
  /**
   * The SAME function this transport's own `preflight()`/`send()` call to turn a resolved channel
   * config into typed credentials (e.g. `pdp-transport.ts#extractPdpCredentials`) - wired here too,
   * ONLY so `validateTransportCredentialFields` can run it against a synthetic, fully-populated
   * config built from `credentialFields` and prove the two never drift apart. Never called by
   * anything else in this registry; the transport's own `send()`/`preflight()` keep calling their
   * own copy directly, unchanged. Returns `null` the same way the real parser does for an incomplete
   * config (unused here - the synthetic config is always complete by construction - but kept so this
   * field's TYPE matches the real parser's exactly, needing no wrapper).
   */
  parseCredentials?: (resolved: ResolvedChannelConfig) => unknown;
}

/**
 * One credential FORM field a transport's connect screen must render - see `DocumentTransport
 * .credentialFields`'s own header for why this replaces the frontend's old, hand-maintained
 * `PROVIDER_FIELDS` map.
 */
export interface CredentialFieldDescriptor {
  /** The key this field is stored under in the encrypted `config` blob - e.g. "clientId". */
  key: string;
  /** UI masking only - "secret" renders a password input and never echoes the stored value back
   *  (see `channels.service.ts`'s own "GET never leaks a secret" guarantee), "text" does not. */
  kind: 'text' | 'secret';
  /** The JS type this transport's own parser expects the DECRYPTED value to already be - lets a
   *  future form pick the right input widget (text/number/checkbox) instead of assuming every field
   *  is a string the way the old `PROVIDER_FIELDS` shape did. */
  valueType: 'string' | 'number' | 'boolean';
  /** Whether the parser REFUSES a config missing this field (returns `null`) - mirrors that
   *  transport's own `extractXCredentials`, never guessed independently of it (this is exactly the
   *  fact `validateTransportCredentialFields` checks by construction). */
  required: boolean;
  placeholder?: string;
  /** An i18n key (`frontend/src/locales/en/translation.json`) - never a hardcoded label, the same
   *  `t(labelKey, ...)` convention the old `PROVIDER_FIELDS` shape already used. */
  labelKey: string;
  /**
   * True for a field the parser reads from `config` but that a connect FORM must never render an
   * input for - populated by the BACKEND itself onto the same stored config blob after being learned
   * from the platform's own reply (e.g. `sdi-pec-transport.ts`'s `sdiReplyAddress`), never typed by a
   * human. Still declared here (never omitted) so `validateTransportCredentialFields` can confirm the
   * parser's own read of it is accounted for, rather than flagging it as an undeclared key.
   */
  learnedByBackend?: boolean;
}

export class InvalidCredentialFieldsError extends Error {}

/** One dummy value per `valueType` - enough to satisfy any `typeof x !== '...'` guard a real
 *  `extractXCredentials` runs, without asserting anything about what a REAL credential looks like. */
function dummyValueFor(valueType: CredentialFieldDescriptor['valueType']): unknown {
  switch (valueType) {
    case 'number':
      return 1;
    case 'boolean':
      return true;
    default:
      return 'dummy-value';
  }
}

/**
 * Runs ONE transport's own `parseCredentials` against a Proxy-wrapped, fully-populated dummy config
 * built purely from its OWN `credentialFields` - never a real credential, never a network call - and
 * records every key the parser actually reads (the Proxy's `get` trap). Two ways this can fail, both
 * thrown, never silently ignored:
 * - the parser reads a key `credentialFields` never declared (the declaration is too NARROW - a
 *    frontend built from it would never collect a field the backend actually needs);
 * - `credentialFields` declares a key the parser never reads (the declaration is too WIDE - a
 *    frontend built from it would collect a field the backend throws away, or worse, imply it is
 *    needed when it is not).
 * A `learnedByBackend` field counts as "accounted for" on the SECOND check without needing to appear
 * in the FIRST (it is read, exactly as expected) - see that field's own header.
 */
function checkTransportCredentialFields(
  transportId: string,
  fields: CredentialFieldDescriptor[],
  parseCredentials: (resolved: ResolvedChannelConfig) => unknown,
): void {
  const declaredKeys = new Set(fields.map((f) => f.key));
  const accessedKeys = new Set<string>();

  const dummyConfig: Record<string, unknown> = {};
  for (const field of fields) dummyConfig[field.key] = dummyValueFor(field.valueType);

  const proxiedConfig = new Proxy(dummyConfig, {
    get(target, prop, receiver) {
      if (typeof prop === 'string') accessedKeys.add(prop);
      return Reflect.get(target, prop, receiver);
    },
  });

  const resolved: ResolvedChannelConfig = {
    providerId: transportId,
    channel: transportId.toUpperCase(),
    environment: 'TEST' as ResolvedChannelConfig['environment'],
    isActive: true,
    config: proxiedConfig,
  };

  let result: unknown;
  try {
    result = parseCredentials(resolved);
  } catch (error) {
    throw new InvalidCredentialFieldsError(
      `Transport "${transportId}": parseCredentials threw against a fully-populated dummy config built ` +
        `from its own declared credentialFields - ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  for (const key of accessedKeys) {
    if (!declaredKeys.has(key)) {
      throw new InvalidCredentialFieldsError(
        `Transport "${transportId}": its own credential parser reads "config.${key}", which ` +
          '"credentialFields" does not declare. Add it there (or stop reading it) before this can pass.',
      );
    }
  }
  for (const key of declaredKeys) {
    if (!accessedKeys.has(key)) {
      throw new InvalidCredentialFieldsError(
        `Transport "${transportId}": "credentialFields" declares "${key}" but the parser never reads ` +
          'it. Remove the field (or start reading it) before this can pass.',
      );
    }
  }
  if (result === null) {
    throw new InvalidCredentialFieldsError(
      `Transport "${transportId}": parseCredentials returned null against a fully-populated dummy ` +
        'config - "credentialFields" is not actually complete enough to satisfy its own parser.',
    );
  }
}

export class UnknownTransportError extends Error {
  constructor(public readonly transportId: string) {
    super(`Unknown transport "${transportId}".`);
    this.name = 'UnknownTransportError';
  }
}

/**
 * Registry of document transports, keyed by id — open by design, the same shape as
 * EntityReferenceRegistry and FieldKindRegistry: a third party registers a new transport under a new
 * id (documents.module.ts is the only place that wires the built-in "email" one today) and a
 * company's `invoiceTransportId` is free to name it. Nothing here, and nothing in
 * invoice-actions.ts, ever hard-codes which transport a company should use — that is read from the
 * company's OWN configuration, not decided by this registry or by the country the company is in.
 */
export class TransportRegistry {
  private readonly transports = new Map<string, { label: string; transport: DocumentTransport }>();

  /**
   * Demo instance (issue #533): wraps the transport's own `send` so EVERY registered transport is
   * blocked in demo mode, including one registered later by a third party who has never read
   * `modules/demo/demo-blocked.ts`. Wrapped HERE, at registration, rather than only at
   * `documents.service.ts`'s own call site: that is what makes `demo-mode-senders.spec.ts`'s
   * enumeration test ("every registered transport is blocked") actually true by construction, not by
   * every future caller remembering to check first. `preflight`/`deliversCreditNotes`/
   * `credentialFields`/`parseCredentials` are copied through UNCHANGED, a company's own "is this
   * channel connected" check must keep working in demo mode (there is nothing sensitive about
   * reporting whether credentials exist), only the actual delivery is refused.
   */
  register(id: string, label: string, transport: DocumentTransport): void {
    if (this.transports.has(id)) {
      throw new Error(`Transport "${id}" is already registered.`);
    }
    const guarded: DocumentTransport = {
      ...transport,
      send: async (ctx) => {
        assertDemoSendingAllowed(`Sending via "${id}"`);
        return transport.send(ctx);
      },
    };
    this.transports.set(id, { label, transport: guarded });
  }

  /** Every registered transport, id and label - what a company's settings screen offers to choose
   * from, the same shape DocumentTypeRegistry.list() offers document types in - PLUS (issue #526)
   *  each transport's own `credentialFields`, defaulted to `[]` for a transport that declared none
   *  (the built-in "email" transport, or a third party that has not adopted this yet). */
  list(): { id: string; label: string; credentialFields: CredentialFieldDescriptor[] }[] {
    return [...this.transports.entries()].map(([id, { label, transport }]) => ({
      id,
      label,
      credentialFields: transport.credentialFields ?? [],
    }));
  }

  has(id: string): boolean {
    return this.transports.has(id);
  }

  /** Throws UnknownTransportError for an id nobody registered — never returns undefined, mirroring
   *  DocumentTypeRegistry.resolve()/EntityReferenceRegistry.resolve(). */
  resolve(id: string): DocumentTransport {
    const entry = this.transports.get(id);
    if (!entry) {
      throw new UnknownTransportError(id);
    }
    return entry.transport;
  }
}

/**
 * Runs `checkTransportCredentialFields` against EVERY registered transport that declared
 * `credentialFields` - called once, at boot, right after `buildTransportRegistry` assembles the real
 * registry (`documents-core.module.ts`), the same "checks the declaration at boot" discipline
 * `descriptors/lifecycle.ts#validateLifecycle` already holds for a document type's own declared
 * transitions. Throws synchronously (crashes boot) on the first mismatch found, deliberately: a
 * drifted credential-field declaration is a code bug, not a transient condition a later boot might
 * self-heal from the way `B2gRoutingBootUpsertService` deliberately tolerates a DB hiccup.
 *
 * A transport that declares `credentialFields` but no `parseCredentials` (or the other way round) is
 * refused here too - the two are meant to be added together, and a caller that forgets one gets a
 * named error instead of a silently-skipped check.
 */
export function validateTransportCredentialFields(registry: TransportRegistry): void {
  for (const { id } of registry.list()) {
    const transport = registry.resolve(id);
    const fields = transport.credentialFields ?? [];
    if (fields.length === 0 && !transport.parseCredentials) continue;

    if (fields.length === 0) {
      throw new InvalidCredentialFieldsError(
        `Transport "${id}" declares "parseCredentials" but no "credentialFields" - the two must be ` +
          'declared together (an empty credentialFields with a parser that reads nothing is simply ' +
          'omitting both).',
      );
    }
    if (!transport.parseCredentials) {
      throw new InvalidCredentialFieldsError(
        `Transport "${id}" declares "credentialFields" but no "parseCredentials" - the two must be ` +
          'declared together, or this check has nothing to run against.',
      );
    }
    checkTransportCredentialFields(id, fields, transport.parseCredentials);
  }
}
