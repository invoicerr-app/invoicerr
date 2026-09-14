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
    const errors = validateAgainstDescriptor(method.fields, config, fieldKindRegistry);
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
 * Every ENABLED method's own presentation for `companyId`, given a document context (or none — the
 * payment-methods screen's own live preview) — what `rendering/render-instance-pdf.ts`'s own
 * "Payment methods" PDF section and `actions/send-document-email.ts`'s covering email both call, so
 * the two never disagree about which methods a company currently offers.
 */
export async function resolveEnabledPaymentMethodPresentations(
  companyId: string,
  ctx: Omit<PaymentMethodRenderContext, 'config'> = {},
): Promise<PaymentMethodPresentation[]> {
  const views = await listCompanyPaymentMethods(companyId);
  const presentations: PaymentMethodPresentation[] = [];
  for (const view of views) {
    if (!view.enabled) continue;
    const method = resolveMethodOrThrow(view.id);
    presentations.push(method.present({ ...ctx, config: view.config }));
  }
  return presentations;
}
