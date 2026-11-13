/**
 * Opens a Polar customer-portal session for the company (one Polar customer per company,
 * `external_id = company.id`).
 *
 * A seat-based checkout turns the customer into a Polar team customer, and Polar then rejects any
 * session without a `member_id`. We pass the member standing for the company's billing identity, not
 * the clicking user's, or the portal shows that user's personal email. Individual customers (never
 * checked out) still work with a plain `external_customer_id` call.
 */
import { isResourceNotFoundError } from './billing-customer';
import {
  CompanyBillingMemberIdentity,
  MemberResolutionClient,
  ResolvedMemberUser,
  resolveOrCreateCompanyBillingMemberId,
  resolveOrCreateMemberIdForUser,
} from './member-resolution';
import { getPolarClient } from './polar-client';

/** Narrow, mockable subset of the Polar SDK client. Bodies and responses use the wire's snake_case. */
export interface PortalSessionClient extends MemberResolutionClient {
  customers: MemberResolutionClient['customers'] & {
    getExternal(externalId: string): Promise<{ id: string; type: string }>;
  };
  customerSessions: {
    create(body: {
      customer_id?: string;
      external_customer_id?: string;
      member_id?: string;
      return_url?: string;
    }): Promise<{ customer_portal_url: string }>;
  };
}

export interface PortalSessionResult {
  url: string;
  redirect: boolean;
}

export const BILLING_NO_COMPANY_CUSTOMER_CODE = 'BILLING_NO_COMPANY_CUSTOMER';

/** No Polar customer exists yet under `externalId` (a company id, or a user id for the legacy portal);
 *  a trial company can reach the portal before ever checking out. */
export class PolarCustomerNotFoundError extends Error {
  readonly code = BILLING_NO_COMPANY_CUSTOMER_CODE;

  constructor(readonly externalId: string) {
    super(`No Polar customer registered at external id "${externalId}" yet, nothing to manage.`);
    this.name = 'PolarCustomerNotFoundError';
  }
}

async function openPortalSessionFor(
  externalId: string,
  resolveMemberId: (client: PortalSessionClient, customerId: string) => Promise<string>,
  returnUrl: string,
  client: PortalSessionClient,
): Promise<PortalSessionResult> {
  let customer: { id: string; type: string };
  try {
    customer = await client.customers.getExternal(externalId);
  } catch (error) {
    if (isResourceNotFoundError(error)) throw new PolarCustomerNotFoundError(externalId);
    throw error;
  }

  const session =
    customer.type === 'team'
      ? await client.customerSessions.create({
          customer_id: customer.id,
          member_id: await resolveMemberId(client, customer.id),
          return_url: returnUrl,
        })
      : await client.customerSessions.create({ external_customer_id: externalId, return_url: returnUrl });

  return { url: session.customer_portal_url, redirect: true };
}

export function createCustomerPortalSession(
  companyId: string,
  billing: CompanyBillingMemberIdentity,
  returnUrl: string,
  client: PortalSessionClient = getPolarClient() as unknown as PortalSessionClient,
): Promise<PortalSessionResult> {
  return openPortalSessionFor(
    companyId,
    (c, customerId) => resolveOrCreateCompanyBillingMemberId(c, customerId, companyId, billing),
    returnUrl,
    client,
  );
}

/**
 * Opens the portal for a legacy per-user Polar customer, so the user can cancel that subscription by
 * hand (Polar cannot migrate it to the company customer). Here the customer is the user, so the
 * clicking user's member is correct.
 */
export function createLegacyCustomerPortalSession(
  user: ResolvedMemberUser,
  returnUrl: string,
  client: PortalSessionClient = getPolarClient() as unknown as PortalSessionClient,
): Promise<PortalSessionResult> {
  return openPortalSessionFor(
    user.id,
    (c, customerId) => resolveOrCreateMemberIdForUser(c, customerId, user.id, user),
    returnUrl,
    client,
  );
}
