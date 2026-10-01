import { BadRequestException, NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { FieldKindRegistry, registerCoreFieldKinds } from '../descriptors/field-kinds';
import { DocumentFieldDescriptor } from '../descriptors/types';
import { validateAgainstDescriptor } from '../descriptors/validate';
import { defaultPaymentMethodRegistry } from './payment-method-registry';
import { PaymentMethodDescriptor, PaymentMethodPresentation, PaymentMethodRenderContext } from './types';

/**
 * Shared, tenant-safe persistence for a company's own payment-method configuration — the exact same
 * discipline `settlement/payments.ts` already holds for `DocumentPayment` rows: every query scoped by
 * `companyId`. Plain functions, not a Nest service, DELIBERATELY: this module is read from BOTH
 * `payment-methods.service.ts` (the settings-screen controller's own `@Injectable()`) and the plain
 * rendering pipeline (`rendering/render-instance-pdf.ts`, `actions/send-document-email.ts`), which has
 * no Nest injector to pull a service from — the same split `settlement/payments.ts` itself draws
 * between "plain persistence" and whatever calls it.
 */

export interface PaymentMethodConfigView {
  id: string;
  label: string;
  fields: DocumentFieldDescriptor[];
  enabled: boolean;
  config: Record<string, unknown>;
  /** Whether `config`, AS IT STANDS, would pass the exact same check `updateCompanyPaymentMethodConfig`
   *  runs before allowing `enabled: true` — computed here so the settings screen can decide UP FRONT
   *  whether flipping a method's switch will actually succeed, instead of firing the request and
   *  showing whatever 400 comes back. A method with no fields at all (cash, Stripe, Mollie) is always
   *  `true` — there is nothing to configure, so nothing can be missing. */
  configured: boolean;
}

export interface UpdatePaymentMethodConfigInput {
  enabled?: boolean;
  config?: Record<string, unknown>;
}

/** "bank_transfer" — the ONE method whose config field VALUES bridge to `Company.iban`/`Company.bic`
 *  instead of this method's own `CompanyPaymentMethodConfig.config` — see that model's own
 *  schema.prisma header for the full "one fact, one place" reasoning. Its `enabled` flag is still a
 *  normal row here, like every other method. */
const BANK_TRANSFER_ID = 'bank_transfer';

// Validating a payment method's own COMPANY-level config needs nothing beyond the closed
// CORE_FIELD_KINDS — every built-in method's `fields` use only 'text' (see each descriptor's own
// header) — so this never needs to be the SAME shared instance `documents-core.module.ts`'s own
// FIELD_KIND_REGISTRY token provides for a DOCUMENT's fields (that one additionally carries whatever
// a PLUGIN registered into it); a future payment-method field that genuinely needs a plugin kind would
// need its own validation wiring here regardless. Built once, at module load — registration is pure
// and side-effect-free (field-kinds.ts's own `registerCoreFieldKinds`), the same "safe to build once,
// at import time" property `defaultPaymentMethodRegistry` itself already relies on.
const fieldKindRegistry = new FieldKindRegistry();
registerCoreFieldKinds(fieldKindRegistry);

async function loadBankTransferConfig(companyId: string): Promise<Record<string, unknown>> {
  const company = await prisma.company.findUnique({
    where: { id: companyId },
    select: { iban: true, bic: true },
  });
  const config: Record<string, unknown> = {};
  if (company?.iban) config.iban = company.iban;
  if (company?.bic) config.bic = company.bic;
  return config;
}

/** The one place that decides "is this config good enough to enable" — shared by `loadOne` (the
 *  read side, exposed to the screen as `configured`) and `updateCompanyPaymentMethodConfig` (the
 *  write side, which must still 400 on an actual attempt to enable with something missing: a
 *  `configured` the screen read a moment ago is not a lock against another tab, or the config,
 *  changing in between). */
function validationErrorsFor(method: PaymentMethodDescriptor, config: Record<string, unknown>) {
  return validateAgainstDescriptor(method.fields, config, fieldKindRegistry);
}

async function loadOne(companyId: string, method: PaymentMethodDescriptor): Promise<PaymentMethodConfigView> {
  const row = await prisma.companyPaymentMethodConfig.findUnique({
    where: { companyId_methodId: { companyId, methodId: method.id } },
  });
  const config =
    method.id === BANK_TRANSFER_ID
      ? await loadBankTransferConfig(companyId)
      : ((row?.config as Record<string, unknown> | undefined) ?? {});
  return {
    id: method.id,
    label: method.label,
    fields: method.fields,
    enabled: row?.enabled ?? false,
    config,
    configured: validationErrorsFor(method, config).length === 0,
  };
}

/** Throws for an id nobody registered — a scripted client naming a bogus method (or a stale, removed
 *  plugin's own id) is refused loudly, never a silent no-op. */
function resolveMethodOrThrow(methodId: string): PaymentMethodDescriptor {
  const method = defaultPaymentMethodRegistry.resolve(methodId);
  if (!method) {
    throw new NotFoundException(`No payment method registered for "${methodId}".`);
  }
  return method;
}

/** Throws (404) for a client id that does not belong to `companyId` - the same "scope every query by
 *  companyId" discipline this module holds throughout (see this file's own header), applied to the
 *  NEW client-scoped half below. Never a bare Prisma call against `ClientPaymentMethodRestriction`
 *  without going through this first: that table carries no `companyId` column of its own (see its
 * schema.prisma header - a restriction has no independent existence from the client it narrows), so
 *  this is the ONLY place tenancy is actually enforced for it. */
async function assertClientInCompany(companyId: string, clientId: string): Promise<void> {
  const client = await prisma.client.findFirst({ where: { id: clientId, companyId }, select: { id: true } });
  if (!client) {
    throw new NotFoundException(`Client "${clientId}" not found for this company.`);
  }
}

/** Every registered method's own config for `companyId` — what the payment-methods screen lists. A
 *  method nobody has configured yet still appears, `enabled: false`, `config: {}` — never absent: the
 *  screen's whole point is showing EVERY method the company COULD offer, configured or not. */
export async function listCompanyPaymentMethods(companyId: string): Promise<PaymentMethodConfigView[]> {
  return Promise.all(defaultPaymentMethodRegistry.list().map((method) => loadOne(companyId, method)));
}

/**
 * Updates ONE method's own config for `companyId` — `enabled`/`config` are each independently
 * optional so a plain toggle (no `config`) and the config dialog's own "Save" (both together) share
 * the one endpoint. `config`, when sent, REPLACES the stored value wholesale (the same "a submitted
 * form is a full snapshot, never a patch" convention `record-payment`'s own params and a document's
 * own `data` already hold) — never merged field-by-field.
 *
 * A method left (or turned) `enabled: true` must carry every field it declares REQUIRED — the exact
 * same "the API refuses exactly what the screen would refuse" discipline `documents.service.ts#runAction`
 * already holds for a document's own required fields; a DISABLED method's config is never validated
 * at all, so a company mid-way through typing in a PayPal e-mail can still save a partial draft.
 */
export async function updateCompanyPaymentMethodConfig(
  companyId: string,
  methodId: string,
  input: UpdatePaymentMethodConfigInput,
): Promise<PaymentMethodConfigView> {
  const method = resolveMethodOrThrow(methodId);
  const existing = await loadOne(companyId, method);
  const enabled = input.enabled ?? existing.enabled;
  const config = input.config ?? existing.config;

  if (enabled) {
    const errors = validationErrorsFor(method, config);
    if (errors.length > 0) {
      throw new BadRequestException({ message: 'Invalid payment method configuration', errors });
    }
  }

  if (methodId === BANK_TRANSFER_ID) {
    // Only touch Company.iban/bic when config was actually PART of this call — a bare `{enabled}`
    // toggle (the card's own switch, no dialog opened) must never blank out an IBAN already on file.
    if (input.config) {
      await prisma.company.update({
        where: { id: companyId },
        data: {
          iban: typeof config.iban === 'string' && config.iban.length > 0 ? config.iban : null,
          bic: typeof config.bic === 'string' && config.bic.length > 0 ? config.bic : null,
        },
      });
    }
    await prisma.companyPaymentMethodConfig.upsert({
      where: { companyId_methodId: { companyId, methodId } },
      // `config` is deliberately never written here — see this method's own header and the
      // CompanyPaymentMethodConfig model's own schema.prisma comment: this row's `config` column is
      // never read back for "bank_transfer" either, so leaving it at its `{}` default costs nothing.
      create: { companyId, methodId, enabled },
      update: { enabled },
    });
  } else {
    await prisma.companyPaymentMethodConfig.upsert({
      where: { companyId_methodId: { companyId, methodId } },
      create: { companyId, methodId, enabled, config },
      update: { enabled, ...(input.config ? { config } : {}) },
    });
  }

  return loadOne(companyId, method);
}

/**
 * Issue #416 - "payment methods per client". Every `methodId` `clientId` is RESTRICTED to, straight
 * off `ClientPaymentMethodRestriction` - an EMPTY array means unrestricted (see that model's own
 * schema.prisma header), never `null`/`undefined`, so a caller never has to special-case "no rows
 * yet" differently from "restricted to nothing" - `resolveAllowedMethodIds` below is what turns an
 * empty array into "allow everything" and a non-empty one into an actual filter.
 */
export async function listClientPaymentMethodRestrictions(
  companyId: string,
  clientId: string,
): Promise<string[]> {
  await assertClientInCompany(companyId, clientId);
  const rows = await prisma.clientPaymentMethodRestriction.findMany({
    where: { clientId },
    select: { methodId: true },
    orderBy: { createdAt: 'asc' },
  });
  return rows.map((row) => row.methodId);
}

/**
 * Replaces `clientId`'s own restriction set wholesale - the same "a submitted form is a full
 * snapshot, never a patch" convention `updateCompanyPaymentMethodConfig`'s own `config` already holds
 * (see that function's own header). An empty array clears every row, i.e. explicitly returns the
 * client to "unrestricted" - never refused, since that is this feature's own documented default.
 *
 * Every id is resolved against the registry (`resolveMethodOrThrow`) BEFORE anything is written - a
 * typo or a stale plugin id is refused loudly (400, via the 404 `resolveMethodOrThrow` throws being
 * read back by its caller - see below) rather than silently stored as a restriction nothing can ever
 * match. Deliberately NOT checked against which methods the COMPANY currently has enabled: a
 * restriction naming a method the company has not enabled YET is harmless (it simply matches nothing
 * until the company enables it - see `resolveEnabledPaymentMethodPresentations` below) and refusing it
 * would force a specific, meaningless ordering ("enable the method first, THEN you may restrict a
 * client to it") on an otherwise order-independent screen.
 */
export async function setClientPaymentMethodRestrictions(
  companyId: string,
  clientId: string,
  methodIds: string[],
): Promise<string[]> {
  await assertClientInCompany(companyId, clientId);

  const uniqueIds = [...new Set(methodIds)];
  for (const methodId of uniqueIds) {
    try {
      resolveMethodOrThrow(methodId);
    } catch {
      throw new BadRequestException(`"${methodId}" is not a registered payment method.`);
    }
  }

  await prisma.$transaction([
    prisma.clientPaymentMethodRestriction.deleteMany({ where: { clientId } }),
    ...(uniqueIds.length > 0
      ? [
          prisma.clientPaymentMethodRestriction.createMany({
            data: uniqueIds.map((methodId) => ({ clientId, methodId })),
          }),
        ]
      : []),
  ]);

  return listClientPaymentMethodRestrictions(companyId, clientId);
}

/**
 * The actual FILTER `resolveEnabledPaymentMethodPresentations` applies for a given client - `null`
 * means unrestricted (every company-enabled method offered, exactly as before this feature existed),
 * a `Set` means "only these ids, intersected with whatever the company has enabled" (the intersection
 * itself happens in the caller's loop, never here: this function only ever answers "what did the
 * client's OWN record ask for"). Scoped by company via `client.companyId` directly (never
 * `assertClientInCompany`'s throwing 404 - a dangling or cross-tenant `clientId` reaching this from a
 * document's own `data` must degrade to "no client context", the same "a rendering gap must never
 * block issuing/sending the document itself" discipline `rendering/render-instance-pdf.ts`'s own
 * `recipientLanguageFor` already holds for an unresolvable client id, never a 404 out of a PDF render).
 */
async function loadClientRestrictionSet(companyId: string, clientId: string): Promise<Set<string> | null> {
  const rows = await prisma.clientPaymentMethodRestriction.findMany({
    where: { clientId, client: { companyId } },
    select: { methodId: true },
  });
  if (rows.length === 0) return null;
  return new Set(rows.map((row) => row.methodId));
}

/**
 * Every ENABLED method's own presentation for `companyId`, given a document context (or none — the
 * payment-methods screen's own live preview) — what `rendering/render-instance-pdf.ts`'s own
 * "Payment methods" PDF section and `actions/send-document-email.ts`'s covering email both call, so
 * the two never disagree about which methods a company currently offers.
 *
 * `clientId` (issue #416) - when given, narrows the result to that client's own restriction (see
 * `loadClientRestrictionSet` above): a company method stays listed if and only if it is BOTH enabled
 * at company level AND (unrestricted, or explicitly named in the client's own set) - this table can
 * only ever narrow, never grant something the company itself has not enabled, so a company disabling a
 * method a client was restricted to makes it disappear for that client too, with no restriction-side
 * change needed. Absent/undefined `clientId` (the payment-methods screen's own live preview, which has
 * no document - and so no client - to narrow against) behaves exactly as before this feature existed.
 */
export async function resolveEnabledPaymentMethodPresentations(
  companyId: string,
  ctx: Omit<PaymentMethodRenderContext, 'config'> = {},
  clientId?: string | null,
): Promise<PaymentMethodPresentation[]> {
  const [views, restriction] = await Promise.all([
    listCompanyPaymentMethods(companyId),
    clientId ? loadClientRestrictionSet(companyId, clientId) : Promise.resolve(null),
  ]);
  const presentations: PaymentMethodPresentation[] = [];
  for (const view of views) {
    if (!view.enabled) continue;
    if (restriction && !restriction.has(view.id)) continue;
    const method = resolveMethodOrThrow(view.id);
    presentations.push(method.present({ ...ctx, config: view.config }));
  }
  return presentations;
}

/**
 * Whether `methodId` may be offered to `clientId` at all - the one check
 * `payments/payment-sessions.service.ts#createInvoiceCheckoutSession` runs before opening an online
 * checkout session, so a client restricted away from the company's chosen online provider cannot be
 * handed a "Pay" link for it even though the company itself still has it connected. Deliberately NOT
 * folded into `resolveEnabledPaymentMethodPresentations` above (which also requires the method to be
 * company-ENABLED, a concept `payment-sessions.service.ts` has nothing to do with - a provider's own
 * "enabled" is its CHANNEL CREDENTIALS, resolved separately there): this reads ONLY the restriction
 * row, nothing else, which is also what keeps it meaningful for a `clientId` this function does not
 * itself verify belongs to `companyId` - see `loadClientRestrictionSet`'s own header on why that is
 * the caller's job, not this one's.
 */
export async function isMethodAllowedForClient(
  companyId: string,
  clientId: string | undefined,
  methodId: string,
): Promise<boolean> {
  if (!clientId) return true;
  const restriction = await loadClientRestrictionSet(companyId, clientId);
  return !restriction || restriction.has(methodId);
}
