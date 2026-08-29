/**
 * Read-only preview of what the compliance engine decides for a synthetic transaction — the data
 * behind the `/dev/state-machine` frontend page (an internal tool to SEE a plan + lifecycle graph
 * for any supplier/buyer country pair without creating an invoice or a company). Builds a synthetic
 * `TransactionContext` from the query, then runs the exact same `resolve()` → `assembleFromPlan()`
 * pipeline the real invoice flow runs (`invoices.service.ts`) — no separate/duplicated logic.
 *
 * Invents nothing: every field on the response comes straight off `CompliancePlan` /
 * `LifecycleGraph`. An unknown country is not special-cased here — `ProfileRegistry.resolve()`
 * already answers with the FALLBACK profile (`confidence: 'FALLBACK'`, `isFallback: true`), and
 * `resolve()` itself pushes a warning onto `plan.warnings`. This service surfaces both rather than
 * hiding or softening them, which is the entire point of the page: an UNVERIFIED/FALLBACK result
 * must be as visible as a fully-sourced one, never silently degraded to "looks fine".
 */
import { BadRequestException, Injectable } from '@nestjs/common';
import { TransactionContext } from '../canonical/canonical-document';
import { CompliancePlan, resolve } from '../engine/compliance-engine';
import { assembleFromPlan, LifecycleGraph } from '../lifecycle/assembler';
import { defaultRegistry } from '../profiles/registry';
import { Confidence, PartyRole, SupplyType } from '../types';

const VALID_BUYER_ROLES: readonly PartyRole[] = ['B2B', 'B2C', 'B2G'];
const VALID_SUPPLY_TYPES: readonly SupplyType[] = ['GOODS', 'SERVICES', 'DIGITAL', 'MIXED'];

/** Raw query params, before validation/normalisation. */
export interface StateMachinePreviewQuery {
  supplierCountry: string;
  buyerCountry: string;
  buyerRole: string;
  documentKind?: string;
  issueDate?: string;
  supplyType?: string;
}

/** How a country code resolved — a real profile, a delegated one, or the unverified fallback. */
export interface ResolvedCountryView {
  requestedCountryCode: string;
  resolvedCountryCode: string;
  isFallback: boolean;
  delegatedFrom?: string;
  confidence: Confidence;
}

export interface StateMachinePreviewResponse {
  /** The synthetic context actually built, so the reader can see exactly what was resolved. */
  context: {
    issueDate: string;
    documentKind: string;
    buyerRole: PartyRole;
    supplyType: SupplyType;
    currency: string;
  };
  supplier: ResolvedCountryView;
  buyer: ResolvedCountryView;
  /** Straight off `compliance-engine.resolve()` — nothing added, nothing summarised away. */
  plan: CompliancePlan;
  /** Straight off `lifecycle/assembler.assembleFromPlan()`. */
  graph: LifecycleGraph;
}

// Arbitrary, non-zero, in a 2-decimal currency: enough for the tax engine to produce a real line
// treatment without a zero amount silently short-circuiting a rule nobody chose to exercise.
const SYNTHETIC_UNIT_NET_MINOR = 10000;

function requireCountry(value: string | undefined, field: string): string {
  if (!value?.trim()) {
    throw new BadRequestException(`${field} query parameter is required`);
  }
  return value.trim().toUpperCase();
}

function requireOneOf<T extends string>(value: string | undefined, allowed: readonly T[], field: string): T {
  const upper = (value ?? '').toUpperCase() as T;
  if (!allowed.includes(upper)) {
    throw new BadRequestException(`${field} must be one of: ${allowed.join(', ')}`);
  }
  return upper;
}

@Injectable()
export class StateMachinePreviewService {
  /** Country codes with a real (non-fallback) profile — populates the frontend's selectors. */
  countries(): string[] {
    return defaultRegistry.countries();
  }

  preview(query: StateMachinePreviewQuery): StateMachinePreviewResponse {
    const supplierCountry = requireCountry(query.supplierCountry, 'supplierCountry');
    const buyerCountry = requireCountry(query.buyerCountry, 'buyerCountry');
    const buyerRole = requireOneOf(query.buyerRole, VALID_BUYER_ROLES, 'buyerRole');
    const supplyType = query.supplyType
      ? requireOneOf(query.supplyType, VALID_SUPPLY_TYPES, 'supplyType')
      : 'SERVICES';
    const issueDate = query.issueDate ? new Date(query.issueDate) : new Date();
    if (Number.isNaN(issueDate.getTime())) {
      throw new BadRequestException('issueDate must be a valid date');
    }
    // Free text, not validated against the closed `DocumentKind` union: a profile may declare kind
    // codes of its own (`DocumentKindCode`, `documentKindsFor()`) that the frontend's selector
    // offers, and this preview must be able to show what the engine does with EXACTLY what the
    // caller picked — never silently substitute a known value for an unrecognised one.
    const documentKind = query.documentKind?.trim() || undefined;

    const ctx: TransactionContext = {
      supplier: {
        legalName: 'Preview supplier',
        countryCode: supplierCountry,
        // The issuer is always modelled B2B here, exactly like `buildComplianceContext`
        // (modules/invoices/invoices.helpers.ts) does for a real company — a fixed convention of
        // the canonical shape, not a country- or business-specific decision.
        role: 'B2B',
        identifiers: [],
      },
      buyer: {
        legalName: 'Preview buyer',
        countryCode: buyerCountry,
        role: buyerRole,
        identifiers: [],
      },
      lines: [
        {
          id: 'preview-line-1',
          description: 'Synthetic preview line',
          quantity: 1,
          unitNetMinor: SYNTHETIC_UNIT_NET_MINOR,
          supplyType,
        },
      ],
      issueDate,
      currency: 'EUR',
      documentKind: documentKind as TransactionContext['documentKind'],
    };

    const plan = resolve(ctx);
    const graph = assembleFromPlan(plan);

    return {
      context: {
        issueDate: issueDate.toISOString(),
        documentKind: documentKind ?? 'INVOICE',
        buyerRole,
        supplyType,
        currency: ctx.currency,
      },
      supplier: this.describeCountry(supplierCountry),
      buyer: this.describeCountry(buyerCountry),
      plan,
      graph,
    };
  }

  private describeCountry(requested: string): ResolvedCountryView {
    const { profile, isFallback, delegatedFrom } = defaultRegistry.resolve(requested);
    return {
      requestedCountryCode: requested,
      resolvedCountryCode: profile.countryCode,
      isFallback,
      delegatedFrom,
      confidence: profile.confidence,
    };
  }
}
