/**
 * The two halves of "a TENANT tells this server which mail server to connect to": WHERE it may
 * connect, and WHAT it may say back about the attempt.
 *
 * A company's own mail server (`modules/company/mail-settings/`, `Settings → Mail`) and the SdI PEC
 * mailbox (`transports/sdi-pec-transport.ts`) are both a free-text `host` and a free-text `port` that
 * this backend then dials from INSIDE its own network. Unguarded, those two fields are a port scanner
 * of the infrastructure the server runs on — `10.x`, `127.0.0.1`, `169.254.169.254` (cloud instance
 * metadata), the managed database, the object store, the Kubernetes API — and the failure text told
 * the tenant which of those had something listening: a closed port answered `ECONNREFUSED`, a
 * filtered one `EHOSTUNREACH`, and an open non-SMTP one (Redis, Postgres) hung and then said
 * `Greeting never received`. Three distinguishable answers, host and port echoed back, driven by one
 * authenticated HTTP request.
 *
 * `assertTenantSmtpEndpoint` closes the first half by delegating to the SAME shared SSRF guard the
 * webhooks, company SSO, PDP and SdI endpoints already go through (`@/utils/outbound-url.ts`) — the
 * host/port entry point exists there, next to the range tables, rather than here, so there is never a
 * second "is this address internal" rule to keep in sync.
 *
 * `describeSmtpFailure` closes the second half: every NETWORK-level outcome collapses into one
 * sentence, so "nothing is listening", "something is listening but not SMTP" and "the packet was
 * dropped" are indistinguishable to the caller. An AUTHENTICATION failure is reported separately and
 * deliberately: it can only happen after a real SMTP conversation with a real mail server, so it
 * tells an attacker nothing about the network, while it is exactly what a legitimate customer with a
 * mistyped password needs to be told. The real error, with its host and port, goes to the log.
 */
import { logger } from '@/logger/logger.service';
import {
  OutboundUrlValidationError,
  ResolvedOutboundUrl,
  assertPublicOutboundHost,
} from '@/utils/outbound-url';

/**
 * Every failure this module hands back is already safe to show a tenant. Its own type, so a caller
 * that needs to tell "a mail failure we have already vetted" apart from "any other error that reached
 * this catch block" (`CompanyMailSettingsService#sendTest` does) can do it without string matching.
 */
export class MailDeliveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'MailDeliveryError';
  }
}

/** What a tenant sees for ANY network-level outcome — refused, filtered, timed out, wrong protocol,
 *  TLS failure. One string for all of them is the entire point: two different strings are an oracle. */
export const SMTP_CONNECTION_FAILED_MESSAGE =
  'Could not connect to the mail server. Check the host, the port and the encryption setting, and ' +
  'that the server accepts connections from the internet.';

/** Reported on its own because it is safe AND actionable: reaching an SMTP AUTH exchange at all
 *  proves a real mail server answered, so this says nothing about what else is reachable. The
 *  server's own response text is NOT echoed — a greeting or rejection banner is the one part of that
 *  exchange that can describe the host rather than the credentials. */
export const SMTP_AUTHENTICATION_FAILED_MESSAGE =
  'The mail server rejected these credentials. Check the username and the password.';

/** The server accepted the conversation and then refused the envelope or the message itself (sender
 *  not allowed to relay, recipient rejected, message too large) — again only reachable through a real
 *  SMTP session, and the tenant's own server's policy to fix. */
export const SMTP_MESSAGE_REJECTED_MESSAGE =
  'The mail server accepted the connection but rejected the message. Check that the "from" address ' +
  'is allowed to send through this server.';

/** What a tenant sees when the endpoint itself is refused before any packet leaves — deliberately
 *  identical whatever the internal target was, so it never confirms which internal address was
 *  named. */
export const SMTP_ENDPOINT_REFUSED_MESSAGE =
  'This mail server address is not allowed: it must be a publicly reachable host. Private, ' +
  'loopback, link-local and other internal addresses are refused.';

/** The INSTANCE's own provider failed (the fallback step of the mail cascade, reached by a company
 *  that configured nothing of its own). Says nothing about the operator's relay — its host, its port,
 *  whether it answered — because the person reading this is a tenant who does not administer it, and
 *  it is that operator's infrastructure the raw error would otherwise describe. The real reason is in
 *  the server log, where the operator is. */
export const INSTANCE_MAIL_FAILED_MESSAGE =
  'The mail server configured for this instance could not send the message. If this keeps happening, ' +
  'contact the administrator of this instance, or configure this company with its own mail server.';

/** A host field that is not a host at all (a URL, a `user@host`, a `host:port`, a path). Distinct
 *  from the refusal above because it is a typo to fix, not a policy decision, and it describes the
 *  SHAPE of the value the caller just typed — nothing about this server's network. */
export const SMTP_HOST_MALFORMED_MESSAGE =
  'The mail server host must be a bare hostname or IP address — no scheme, no port, no path.';

/** Port outside 1-65535. Same reasoning as the malformed host above. */
export const SMTP_PORT_INVALID_MESSAGE = 'The mail server port must be a number between 1 and 65535.';

/** DNS said the name does not exist. Public DNS is something the caller can query themselves, so
 *  naming it leaks nothing this server knows and nobody else does — and "you typed a name that does
 *  not exist" is otherwise indistinguishable from "we refused your address", which would send a
 *  customer hunting for the wrong problem. */
export const SMTP_HOST_UNRESOLVED_MESSAGE =
  'The mail server host could not be resolved. Check the spelling of the host name.';

function messageForRefusal(error: OutboundUrlValidationError): string {
  switch (error.reason) {
    case 'malformed host':
      return SMTP_HOST_MALFORMED_MESSAGE;
    case 'invalid port':
      return SMTP_PORT_INVALID_MESSAGE;
    case 'hostname does not resolve':
      return SMTP_HOST_UNRESOLVED_MESSAGE;
    default:
      return SMTP_ENDPOINT_REFUSED_MESSAGE;
  }
}

/**
 * Validates a tenant-supplied SMTP endpoint and returns the address the caller must actually connect
 * to (`null` only under the `ALLOW_PRIVATE_OUTBOUND_URLS` test hatch — the e2e stack points a
 * company's own mail server at Mailpit on localhost, which is the whole reason that hatch reaches
 * this path at all; `.env.example` documents that it must never be set in production).
 *
 * Throws `MailDeliveryError` rather than letting `OutboundUrlValidationError` escape, because every
 * caller of this function is on a path whose failure text reaches a tenant: the shared guard's own
 * `reason` strings ("hostname resolves to a private/internal address") are precise enough to be a
 * weaker version of the very oracle this guard exists to remove.
 */
export async function assertTenantSmtpEndpoint(
  host: string,
  port: number,
): Promise<ResolvedOutboundUrl | null> {
  try {
    return await assertPublicOutboundHost(host, port, {
      allowPrivateForTesting: process.env.ALLOW_PRIVATE_OUTBOUND_URLS === '1',
    });
  } catch (error) {
    if (error instanceof OutboundUrlValidationError) {
      // Host and port are safe to log (this server already logs them on every send failure) and are
      // what an operator needs to tell a misconfiguration apart from someone probing the network.
      logger.warn('Refused a mail server address that is not publicly routable.', {
        category: 'mail',
        details: { host, port, reason: error.reason },
      });
      throw new MailDeliveryError(messageForRefusal(error));
    }
    throw error;
  }
}

/**
 * Collapses a nodemailer failure into one of the safe messages above. nodemailer tags its own errors
 * with a `code`: `EAUTH` for an AUTH rejection, `EENVELOPE`/`EMESSAGE` for a message the server
 * refused, and `ECONNECTION`/`ESOCKET`/`ETIMEDOUT`/`EDNS`/`ETLS` (or nothing at all) for everything
 * that failed at or below the socket. Only the first two survive as distinct messages — see this
 * file's own header for why that distinction is safe and the others are not.
 */
export function describeSmtpFailure(error: unknown): string {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  if (code === 'EAUTH') return SMTP_AUTHENTICATION_FAILED_MESSAGE;
  if (code === 'EENVELOPE' || code === 'EMESSAGE') return SMTP_MESSAGE_REJECTED_MESSAGE;
  return SMTP_CONNECTION_FAILED_MESSAGE;
}
