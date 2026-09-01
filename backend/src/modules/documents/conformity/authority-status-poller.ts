/**
 * The generic poll-side interface every national channel's post-deposit conformity check implements —
 * this task's own remainder of root TODO item 10 ("transports nationaux"): a deposit today succeeds
 * the moment the platform ACCEPTS the upload (`DocumentInstance.transportRef`), and nothing ever
 * follows up on the platform's own LATER verdict (PDP: fr:200 déposée → fr:201 émise → fr:202 reçue,
 * or fr:213 rejetée — proven live in ~1s, five times, see `pollers/pdp-status-poller.ts`'s own
 * header). Same "one small interface, a registry, a provider registers itself" shape
 * `transports/transport-registry.ts` already holds for delivery — this is its read-side twin.
 *
 * ## Why "sdi" registers no poller at all
 *
 * Italy's SdI does not expose a pull endpoint for the notifiche that carry an invoice's own outcome
 * (RC/NS/NE/DT/AT) — they are PUSHED to the seller over SOAP, unprompted, whenever SdI has something
 * to say. There is nothing to poll: a poller for "sdi" would have to either invent an endpoint that
 * does not exist, or silently do nothing while pretending to work. Neither is acceptable, so "sdi"
 * simply never appears in `AuthorityStatusPollerRegistry` — the sweep's own eligibility query
 * (`authority-events.persistence.ts`) is gated on the registry actually knowing a document's
 * `channelProviderId`, so an SdI document is invisible to this mechanism entirely, honestly, forever
 * (until a real notifiche-receiving inbox is built — a SEPARATE, PUSH-shaped mechanism, not a poller).
 */

/** One event as the PROVIDER'S OWN API reported it — already normalized to this table's own columns
 *  (`DocumentAuthorityEvent`), but still exactly what the platform said, never re-interpreted beyond
 *  what `terminal`/`statusCode` require. `rawPayload` is the ENTIRE raw object this event came from —
 *  kept verbatim so a future mapping bug (the exact "read `status_code` instead of `events[]`"
 *  mistake this whole task exists to fix) can be diagnosed from what was actually received. */
export interface RawAuthorityEvent {
  statusCode: string;
  statusText?: string;
  /** Populated only when the platform explained itself (a rejection's own cause) — see this file's
   *  own header on `DocumentAuthorityEvent.reason`. */
  reason?: string;
  /** WHEN THE PLATFORM ITSELF recorded this event — never "when this poll happened to notice it". */
  observedAt: Date;
  rawPayload?: unknown;
}

/** Thrown by a poller's own `poll()` when this company has no usable credentials connected for this
 *  provider RIGHT NOW — the sweep catches this ONE type specifically (never a bare string match on an
 *  error message) and journals a `poll:blocked` synthetic event instead of letting the job fail loud;
 *  every OTHER thrown error is treated the same way (this task's own explicit rule: "un handler
 *  d'événement ne tue jamais le processus") but is logged as a genuine unexpected failure, not merely
 *  "not connected". */
export class ChannelNotConnectedError extends Error {
  constructor(providerId: string) {
    super(`The "${providerId}" channel is not connected (or its credentials are incomplete).`);
    this.name = 'ChannelNotConnectedError';
  }
}

/** What a THIRD PARTY implements to make a channel's conformity verdict pollable — registered under
 *  its transport id (`AuthorityStatusPollerRegistry.register`), the same id
 *  `transports/transport-registry.ts` already uses for delivery, so a document's own
 *  `channelProviderId` resolves to exactly one poller (or none, for "sdi" — see this file's header). */
export interface AuthorityStatusPoller {
  readonly providerId: string;
  /** Whether `statusCode` (one THIS provider itself produced — never a synthetic 'poll:gave-up'/
   *  'poll:blocked', which the sweep already treats as terminal/non-terminal on its own, see
   *  `conformity-sweep.ts`) means "nothing more to do for this document, ever": a real success (PDP:
   *  `fr:202`) or a real failure (PDP: `fr:213`) alike. A PREDICATE rather than a static list — PDP's
   *  own vocabulary is a small, fixed set of codes and could be either; KSeF's is not (see
   *  `pollers/ksef-status-poller.ts`'s own header: any HTTP-style 4xx/5xx status code is a rejection,
   *  which a finite list could not express without enumerating every possible code). Read by the
   *  sweep (`conformity-sweep.ts#decideConformityAction`) to decide "skip forever" — kept on the
   *  poller itself, never guessed at by the sweep, since only the provider's own implementation
   *  actually knows its own lifecycle's vocabulary. */
  isTerminal(statusCode: string): boolean;
  /**
   * Fetches EVERY event the platform currently reports for this deposit — never just the latest one:
   * dedup (`authority-events.persistence.ts`'s own `@@unique`) is what turns a full re-fetch, every
   * poll, into "only the NEW ones actually get journaled" — there is no cheaper "since when" API this
   * task's own source (PDP's `GET /v1.beta/invoices/{id}`) offers anyway.
   * @throws ChannelNotConnectedError when this company has no usable credentials for `providerId`.
   */
  poll(companyId: string, transportRef: string): Promise<RawAuthorityEvent[]>;
}

/**
 * Registry of authority-status pollers, keyed by provider id — open by design, the exact same shape
 * `TransportRegistry` already holds for delivery (this file's own header). The sweep's own
 * eligibility (`authority-events.persistence.ts`) asks this registry "which provider ids can even be
 * polled" rather than hard-coding a list — adding a poller for a future channel is exactly one
 * `register()` call, here, never a change to the sweep itself.
 */
export class AuthorityStatusPollerRegistry {
  private readonly pollers = new Map<string, AuthorityStatusPoller>();

  register(poller: AuthorityStatusPoller): void {
    if (this.pollers.has(poller.providerId)) {
      throw new Error(`An authority-status poller for "${poller.providerId}" is already registered.`);
    }
    this.pollers.set(poller.providerId, poller);
  }

  /** Every provider id this registry can poll — what the sweep's own eligibility query filters
   *  `DocumentInstance.channelProviderId` against (`authority-events.persistence.ts`). */
  pollableProviderIds(): string[] {
    return [...this.pollers.keys()];
  }

  /** Never throws for an unknown id (unlike `TransportRegistry.resolve` — delivery MUST fail loud for
   *  an unregistered transport; a poll for a provider this build simply doesn't poll is not an error,
   *  it is exactly "sdi"'s own, permanent, documented case) — the caller (the sweep runner) treats
   *  `undefined` as "nothing to do", never as a bug. */
  resolve(providerId: string): AuthorityStatusPoller | undefined {
    return this.pollers.get(providerId);
  }
}
