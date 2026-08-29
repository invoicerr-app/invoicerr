/**
 * Burger Queen → Tricatel: one French invoice, from quote to cash, against a REAL PDP.
 *
 * Eight steps, in the order a business lives them: the company, the customer, a bank account, an
 * article, a quote the customer signs from a public link, the invoice that follows from the signed
 * quote, a credit note for what the invoice got wrong, and the payment. Every step is asserted on
 * the FACT the backend recorded, never on a sentence the screen happens to be showing.
 *
 * ── Why this spec lives in `mandate/` and not in the suite ───────────────────────────────────────
 * `npm run e2e:run` globs `cypress/e2e/*.cy.ts`, which is not recursive, so nothing here runs on a
 * pull request. Deliberate twice over: this spec transmits to a real Plateforme de Dématérialisation
 * Partenaire (CI has no credentials for one), and it only tells the truth under a clock at or after
 * 2026-09-01, because France's e-invoicing mandate is what routes the invoice to a PDP at all.
 * Before that date `profiles/data/fr.ts` answers `channels: [{ type: 'EMAIL' }]` and no PDP is
 * involved — correctly, since routing a French B2B invoice through a platform was not required yet.
 *
 * ── How to run it ────────────────────────────────────────────────────────────────────────────────
 *   set -a; . backend/.env.test.local; set +a          # PDP_BASE_URL / PDP_CLIENT_ID / _SECRET
 *   export CYPRESS_pdpBaseUrl=$PDP_BASE_URL \
 *          CYPRESS_pdpClientId=$PDP_CLIENT_ID \
 *          CYPRESS_pdpClientSecret=$PDP_CLIENT_SECRET
 *   # Before 2026-09-01 ONLY — the whole stack has to believe the mandate is in force:
 *   #   DATE_SHIFT_TO=2026-09-02T10:00:00Z NODE_OPTIONS="--require $PWD/scripts/date-shift.cjs"
 *   cd e2e && npx cypress run --browser firefox --spec "cypress/e2e/mandate/fr-pdp-lifecycle.cy.ts"
 *
 * The backend also needs `CREDENTIALS_ENCRYPTION_KEY` (channel credentials are AES-256-GCM at rest;
 * without it the PUT below answers 503) and a Redis it does not share with another stack — the
 * transmit job is picked up by whichever worker is listening on that queue.
 *
 * Firefox, not Electron: Electron's renderer crashes on Radix selects (see cypress.config.ts).
 *
 * ── TWO KNOWN BLOCKERS, both measured against api.superpdp.tech on 2026-08-29 ────────────────────
 * Steps 08 and 09 are red today, for two independent reasons. Neither is a defect in this spec.
 *
 * (1) THE CALENDAR. superpdp refuses any deposit whose BT-2 is later than the current day:
 *       400 — "La date de facture (BT-2) DOIT ETRE antérieure ou égale à date d'application du
 *              contrôle de conformité"
 *     Measured with this scenario's own artifact: 2026-08-29 accepted (deposit 374865),
 *     2026-08-30 / 08-31 / 09-01 / 09-02 all refused — on both `superpdp` and `afnor` API styles,
 *     and with `disable_pre_check=true`. So the window in which the French profile routes to a PDP
 *     (from 2026-09-01) and the window superpdp accepts (up to today) do not overlap until
 *     2026-09-01, at which point this spec needs no clock shift at all.
 *
 * (2) BR-FR-05. Re-deposited with only BT-2 moved to today, this scenario's invoice AND credit note
 *     were accepted (deposits 374891 / 374892) and then REFUSED by the conformity check:
 *       fr:213 Rejetée / REJ_SEMAN
 *       "BR-FR-05/BT-22 : La mention relative aux frais de recouvrement (code PMT) est absente.
 *        Elle est obligatoire dans les notes (BG-1)."           …and the same for PMD and AAB.
 *     The French CIUS requires three BG-1 invoice notes, keyed by BT-21 subject code: PMT
 *     (frais de recouvrement), PMD (pénalités de retard), AAB (escompte ou son absence). Invoicerr
 *     emits none of them, so every French invoice it produces is refused. Their WORDING is the
 *     seller's own commercial terms, so it is not something a test can invent — it needs a product
 *     decision (per-company payment-terms mentions) before this step can pass.
 *
 * ── The identifiers, and why they are not the ones on the brief ──────────────────────────────────
 * The brief names SIREN 415143296 for Burger Queen and 315143296 for Tricatel. Neither reaches this
 * PDP:
 *   • 315143296 fails the SIREN Luhn key (digit sum 39, and 40 is required). It is also, not by
 *     accident, the SIREN of the sandbox OPERATOR — the `{pdp_siren}` half of the routing addresses
 *     below. The nearest checksum-valid neighbour would be 315143297.
 *   • 415143296 does pass Luhn, and superpdp still refuses the deposit:
 *       "L'entreprise (000000002) liée à cette session ne correspond pas au vendeur de la facture
 *        (415143296)."
 *     The seller identifier in the CII must equal the registration number of the enterprise the
 *     OAuth client belongs to, and `GET /v1.beta/companies/me` for these credentials answers
 *     `{ id: 1422, number: "000000002", formal_name: "Burger Queen", city: "Millau" }` — the sandbox
 *     already holds this scenario's seller, under its own number.
 * So the numbers below are the ones the authority recognises. They are no less fictitious
 * (000000002 is not a real SIREN either), and the VAT keys are computed rather than invented:
 * FR18000000002 and FR15000000001 both satisfy clé = (12 + 3 × SIREN mod 97) mod 97.
 * To run the brief's numbers instead, register a test enterprise under SIREN 415143296 on
 * superpdp.tech and use its client_id/client_secret — nothing in the product needs to change.
 */

const api = Cypress.env("apiUrl") || "http://localhost:4000";

/**
 * Credentials come from the runner's environment, never from this file: `backend/.env.test.local`
 * is gitignored, this spec is not. A missing credential FAILS the run rather than skipping it — a
 * silent skip is how a suite ends up green while proving nothing.
 */
const PDP = {
  baseUrl: Cypress.env("pdpBaseUrl") as string,
  clientId: Cypress.env("pdpClientId") as string,
  clientSecret: Cypress.env("pdpClientSecret") as string,
  apiStyle: (Cypress.env("pdpApiStyle") as string) || "superpdp",
  // `{pdp_siren}_{account_id}` — the address the PDP routes on, NOT either company's SIREN.
  // Burger Queen is account 1422 and Tricatel 1421, both on the operator's SIREN 315143296.
  // The buyer address is what makes the deposit deliverable: without it superpdp answers
  // "receiver address <0225:000000001> does not accept this document".
  sellerEndpointId: (Cypress.env("pdpSellerRouting") as string) || "315143296_1422",
  buyerEndpointId: (Cypress.env("pdpBuyerRouting") as string) || "315143296_1421",
};

/** The PDP account these credentials belong to — asserted on the read-back, so a swapped tenant shows. */
const PDP_ACCOUNT_ID = Number(Cypress.env("pdpAccountId") ?? 1422);

const COMPANY = {
  name: "Burger Queen",
  address: "809 avenue du Languedoc",
  postalCode: "12100",
  city: "Millau",
  legalId: "000000002",
  vat: "FR18000000002",
};

const CLIENT = {
  name: "Tricatel",
  address: "Avenue de la République",
  postalCode: "37170",
  city: "Chambray-lès-Tours",
  legalId: "000000001",
  vat: "FR15000000001",
  email: "tricatel@mailpit.test",
};

/** A syntactically valid French IBAN — mod-97 on FR76 3000 6000 0112 3456 7890 189 is 1. */
const IBAN = "FR7630006000011234567890189";

/**
 * State shared across the `it`s. Cypress runs them in file order and each builds on the last.
 *
 * Anything read out of here INSIDE the test that wrote it must be read from a `cy.then()`: command
 * arguments are evaluated when the command is enqueued, not when it runs, so `{ quoteId:
 * world.quoteId }` written straight after the request that sets it sends `{}`. That mistake cost
 * this spec its first run.
 */
const world: {
  companyId?: string;
  clientId?: string;
  paymentMethodId?: string;
  articleId?: string;
  quoteId?: string;
  quoteItemId?: string;
  signatureId?: string;
  invoiceId?: string;
  creditNoteId?: string;
} = {};

type ComplianceSnapshot = {
  id: string;
  status: string;
  number: string | null;
  kind: string;
  events: { type: string; detail: string | null }[];
  jobs: { kind: string; providerId: string | null; ref: string | null }[];
  callbacks: { channel: string; correlationKey: string }[];
  authorityIds: { scheme: string; value: string }[];
};

const SETTLED_OK = ["DELIVERED", "PENDING_CLEARANCE", "CLEARED", "ACCEPTED", "REPORTED"];
const FAILURE_EVENTS = ["TRANSMISSION_FAIL", "VALIDATION_BLOCKED", "WIRING_FAILED", "BUILD_FAILED"];

/**
 * Poll the compliance document until it stops moving.
 *
 * `POST /api/invoices/send` only enqueues: PDP declares `feedback: 'ASYNC_CALLBACK'`, so the
 * authority's answer lands in a BullMQ job seconds later. Reading the document straight afterwards
 * reads ISSUED and proves nothing about the platform.
 */
function settle(invoiceId: string, attempts = 40): Cypress.Chainable<ComplianceSnapshot> {
  const IN_FLIGHT = ["DRAFT", "ISSUED", "QUEUED", "SUBMITTED", "IN_PROGRESS"];
  const poll = (left: number): Cypress.Chainable<ComplianceSnapshot> =>
    cy.task<ComplianceSnapshot | null>("complianceRefs", invoiceId).then((snap) => {
      if ((!snap || IN_FLIGHT.includes(snap.status)) && left > 0) {
        return cy.wait(1000).then(() => poll(left - 1));
      }
      expect(snap, `a compliance document exists for invoice ${invoiceId}`).to.not.be.null;
      return cy.wrap(snap as ComplianceSnapshot, { log: false });
    });
  return poll(attempts);
}

/**
 * The reference the PDP gave back, as the provider stores it: `"<companyId>|<pdp invoice id>"`.
 * Written to the poll job and to the callback registration; on no HTTP response.
 */
function pdpReference(snap: ComplianceSnapshot): string | null {
  const fromJob = snap.jobs.find((j) => j.providerId === "pdp" && j.ref)?.ref ?? null;
  const fromCallback =
    snap.callbacks.find((c) => c.channel === "PDP" && c.correlationKey?.includes("|"))?.correlationKey ??
    null;
  return fromJob ?? fromCallback;
}

/** The failure the runtime recorded, if any — so a red run says WHY instead of "expected X not Y". */
function whyItFailed(snap: ComplianceSnapshot): string {
  const failure = snap.events.find((e) => FAILURE_EVENTS.includes(e.type));
  if (!failure) return "";
  return failure.detail
    ? ` — ${failure.type}: ${failure.detail}`
    : ` — ${failure.type} was recorded with NO detail (the async transmit path drops the ` +
        `authority's message; it is only in the server log)`;
}

/**
 * The one-time code, taken from the mail that actually carries one.
 *
 * `cy.getLastEmail()` returns the NEWEST message as soon as any message exists, which is the wrong
 * mail here more often than it looks: the quote mail sent one test earlier carries a PDF and can
 * land a second or two behind, i.e. after the inbox has been emptied and after the code has arrived.
 * One run in four signed with whatever eight digits that mail happened to contain and left the quote
 * on SENT. So: poll every message, keep the one whose body has an 8-digit code, and prefer a
 * "verification code" subject when several do.
 */
function otpFromInbox(attempts = 20): Cypress.Chainable<string> {
  type MailpitMessage = { ID: string; Subject: string };
  const poll = (left: number): Cypress.Chainable<string> =>
    cy
      .request({ url: "http://localhost:8025/api/v1/messages", failOnStatusCode: false })
      .then((res) => {
        const messages: MailpitMessage[] = res.body?.messages ?? [];
        const ordered = [
          ...messages.filter((m) => /verification|code/i.test(m.Subject ?? "")),
          ...messages.filter((m) => !/verification|code/i.test(m.Subject ?? "")),
        ];
        if (ordered.length === 0) {
          expect(left, "no mail ever arrived for the signature request").to.be.greaterThan(0);
          return cy.wait(500).then(() => poll(left - 1));
        }
        return cy
          .request(`http://localhost:8025/api/v1/message/${ordered[0].ID}`)
          .then((full) => {
            const body = full.body?.Text || full.body?.HTML || "";
            const code = (body.match(/\d{4}-?\d{4}/) || [])[0]?.replace("-", "") ?? "";
            if (code.length !== 8) {
              expect(
                left,
                `no 8-digit code in the inbox; subjects were ${JSON.stringify(messages.map((m) => m.Subject))}`,
              ).to.be.greaterThan(0);
              return cy.wait(500).then(() => poll(left - 1));
            }
            return cy.wrap(code, { log: false });
          });
      });
  return poll(attempts);
}

/** XP Z12-012 lifecycle codes that mean the platform REFUSED the document. */
const PDP_REJECTION_CODES = ["fr:210", "fr:213", "fr:501"];

/**
 * The platform's own verdict, fetched from superpdp rather than from our database.
 *
 * A reference stored on our side proves we wrote a string down; a 200 on the deposit proves only
 * that the file was accepted for processing. The conformity check (contrôle de conformité) runs
 * afterwards and lands as a SECOND lifecycle event, a fraction of a second later.
 *
 * That gap is where the previous "PDP ✅ proven live" claim lived: `pdp-live.spec.ts` asserts
 * `PENDING` right after the deposit and polls once, before the verdict exists — and every document
 * it deposited went on to `fr:213 Rejetée / REJ_SEMAN` without the suite ever noticing (checked on
 * 2026-08-29 against deposits 88989, 6714, 374896). So this waits for a `fr:` code and refuses the
 * rejection codes, quoting the authority's own reason.
 */
function readBackFromPdp(reference: string, label: string) {
  const pdpDocumentId = reference.split("|")[1];
  expect(pdpDocumentId, `${label}: reference "${reference}" carries a PDP id`).to.match(/^\d+$/);
  type PdpEvent = { status_code: string; status_text: string; data?: { reason?: string } };
  return cy
    .request({
      method: "POST",
      url: `${PDP.baseUrl}/oauth2/token`,
      form: true,
      body: {
        grant_type: "client_credentials",
        client_id: PDP.clientId,
        client_secret: PDP.clientSecret,
      },
    })
    .then((tok) => {
      const headers = { authorization: `Bearer ${tok.body.access_token}` };
      const poll = (left: number): Cypress.Chainable<unknown> =>
        cy
          .request({ url: `${PDP.baseUrl}/v1.beta/invoices/${pdpDocumentId}`, headers })
          .then((doc) => {
            expect(doc.status, `${label} is readable on superpdp`).to.eq(200);
            expect(doc.body.company_id, `${label} is filed under this PDP account`).to.eq(
              PDP_ACCOUNT_ID,
            );
            const events: PdpEvent[] = doc.body.events ?? [];
            const verdict = events.filter((e) => e.status_code?.startsWith("fr:")).pop();
            if (!verdict && left > 0) return cy.wait(1000).then(() => poll(left - 1));

            cy.log(
              `${label} → superpdp #${pdpDocumentId}: ${events
                .map((e) => `${e.status_code} ${e.status_text}`)
                .join(" → ")}`,
            );
            expect(verdict, `${label}: superpdp issued a lifecycle verdict on #${pdpDocumentId}`).to
              .exist;
            expect(
              PDP_REJECTION_CODES,
              `${label} was refused by the conformity check (#${pdpDocumentId}): ` +
                `${verdict?.status_code} ${verdict?.status_text} — ${verdict?.data?.reason ?? "no reason given"}`,
            ).to.not.include(verdict?.status_code);
            return cy.wrap(null, { log: false });
          });
      return poll(20);
    });
}

describe("France, mandate in force — Burger Queen invoices Tricatel through a real PDP", () => {
  before(() => {
    for (const [key, value] of Object.entries(PDP)) {
      if (!value) {
        throw new Error(
          `CYPRESS_${key} is not set. This spec transmits to a real Plateforme de Dématérialisation ` +
            `Partenaire; without credentials it would assert nothing. See the header for the export ` +
            `block — it fails rather than skips on purpose.`,
        );
      }
    }
    cy.task("resetDatabase");
    cy.then(() => Cypress.session.clearAllSavedSessions());
    cy.clearEmails();

    cy.request({
      method: "POST",
      url: `${api}/api/auth/sign-up/email`,
      body: {
        name: "John Doe",
        firstname: "John",
        lastname: "Doe",
        email: "john.doe@acme.org",
        password: "Super_Secret_Password123!",
      },
    })
      .its("status")
      .should("be.oneOf", [200, 201]);
  });

  beforeEach(() => cy.login());

  // ── 1. The company ─────────────────────────────────────────────────────────────────────────────
  it("01 registers Burger Queen in Millau and connects it to its PDP", () => {
    cy.request({
      method: "POST",
      url: `${api}/api/companies`,
      body: {
        name: COMPANY.name,
        description: "Restauration rapide",
        phone: "+33565600000",
        email: "contact@burgerqueen.example",
        address: COMPANY.address,
        city: COMPANY.city,
        postalCode: COMPANY.postalCode,
        // `country` is the human name the picker stores, `countryCode` the ISO override the
        // compliance engine resolves on. FR refuses to guess one from the other.
        country: "France",
        countryCode: "FR",
        currency: "EUR",
        identifiers: [
          { scheme: "LEGAL_ID", value: COMPANY.legalId },
          { scheme: "VAT", value: COMPANY.vat },
        ],
      },
    }).then((res) => {
      expect(res.status, "company created").to.be.oneOf([200, 201]);
      world.companyId = res.body.id;
    });

    cy.then(() => cy.request("POST", `${api}/api/companies/switch`, { companyId: world.companyId }));

    // The country profile decides which channels this company must connect — the frontend names no
    // country. Asserting it here is what makes the PDP configuration below a consequence of the
    // mandate rather than of this spec's opinion.
    cy.then(() =>
      cy
        .request(`${api}/api/compliance/channels/companies/${world.companyId}/required-channels`)
        .its("body")
        .then((channels: { type: string }[]) => {
          expect(channels.map((c) => c.type), "France requires a PDP").to.include("PDP");
        }),
    );

    // The same endpoint the Settings → Channels form PUTs to. The blob is AES-256-GCM encrypted at
    // rest, which needs CREDENTIALS_ENCRYPTION_KEY on the server: without it this answers 503
    // rather than pretending to have saved.
    cy.then(() =>
      cy
        .request({
          method: "PUT",
          url: `${api}/api/compliance/channels/companies/${world.companyId}`,
          body: {
            providerId: "pdp",
            environment: "TEST",
            isActive: true,
            config: {
              baseUrl: PDP.baseUrl,
              clientId: PDP.clientId,
              clientSecret: PDP.clientSecret,
              environment: "TEST",
              apiStyle: PDP.apiStyle,
              sellerEndpointId: PDP.sellerEndpointId,
              // Read by the transmission provider but ABSENT from its configSchema, so the settings
              // UI cannot enter it. Posted directly here; recorded as a product gap.
              buyerEndpointId: PDP.buyerEndpointId,
            },
          },
        })
        .then((res) => {
          expect(res.status, "PDP channel configured").to.eq(200);
          expect(res.body.config.clientSecret, "the secret is masked on the way back").to.not.eq(
            PDP.clientSecret,
          );
        }),
    );
  });

  // ── 2. The customer ────────────────────────────────────────────────────────────────────────────
  it("02 registers Tricatel as a French company customer", () => {
    cy.request({
      method: "POST",
      url: `${api}/api/clients`,
      body: {
        name: CLIENT.name,
        contactEmail: CLIENT.email,
        type: "COMPANY",
        country: "FR",
        address: CLIENT.address,
        postalCode: CLIENT.postalCode,
        city: CLIENT.city,
        currency: "EUR",
        isActive: true,
        identifiers: [
          { scheme: "LEGAL_ID", value: CLIENT.legalId },
          { scheme: "VAT", value: CLIENT.vat },
        ],
      },
    }).then((res) => {
      expect(res.status, "client created").to.be.oneOf([200, 201]);
      world.clientId = res.body.id;
    });
  });

  // ── 3. The bank account ────────────────────────────────────────────────────────────────────────
  it("03 adds a bank payment method carrying the IBAN", () => {
    cy.request({
      method: "POST",
      url: `${api}/api/payment-methods`,
      body: {
        name: "Compte Burger Queen",
        type: "BANK_TRANSFER",
        // There is no IBAN column: `details` is free text and the renderer extracts an IBAN from it
        // with a shape-only regex — no mod-97 anywhere in the product, so an invalid IBAN would be
        // accepted just as readily. The value used here is checksum-valid regardless, so the
        // extraction is not being flattered by a lax parser.
        details: `IBAN ${IBAN} / BIC AGRIFRPP`,
      },
    }).then((res) => {
      expect(res.status, "payment method created").to.be.oneOf([200, 201]);
      expect(res.body.type).to.eq("BANK_TRANSFER");
      world.paymentMethodId = res.body.id;
    });
  });

  // ── 4. The article ─────────────────────────────────────────────────────────────────────────────
  it("04 creates the 'Prestation' service article", () => {
    cy.request({
      method: "POST",
      url: `${api}/api/articles`,
      body: {
        name: "Prestation",
        description: "Prestation de service",
        type: "SERVICE",
        unitPrice: 1200,
        vatRate: 20,
      },
    }).then((res) => {
      expect(res.status, "article created").to.be.oneOf([200, 201]);
      expect(res.body.type).to.eq("SERVICE");
      world.articleId = res.body.id;
    });
  });

  // ── 5. The quote ───────────────────────────────────────────────────────────────────────────────
  it("05 quotes Tricatel from that article and sends it for signature", () => {
    cy.then(() => cy.request(`${api}/api/articles/${world.articleId}`))
      .its("body")
      .then((article) =>
        cy.request({
          method: "POST",
          url: `${api}/api/quotes`,
          body: {
            clientId: world.clientId,
            currency: "EUR",
            title: "Devis Burger Queen",
            notes: "Prestation de service",
            paymentMethodId: world.paymentMethodId,
            items: [
              {
                name: article.name,
                description: article.description,
                quantity: 1,
                unitPrice: article.unitPrice,
                vatRate: article.vatRate,
                type: article.type,
                order: 0,
              },
            ],
          },
        }),
      )
      .then((res) => {
        expect(res.status, "quote created").to.be.oneOf([200, 201]);
        world.quoteId = res.body.id;
        world.quoteItemId = res.body.items[0].id;
      });

    // There is no "send quote" endpoint. Creating the signature request IS the send: it mails the
    // public link to the customer and flips the quote to SENT.
    cy.clearEmails();
    cy.then(() => cy.request("POST", `${api}/api/signatures`, { quoteId: world.quoteId })).then((res) => {
      expect(res.status, "signature request created").to.be.oneOf([200, 201]);
      world.signatureId = res.body.signature.id;
    });

    cy.then(() =>
      cy
        .request(`${api}/api/quotes/table`)
        .its("body")
        .then((quotes: { id: string; status: string }[]) => {
          expect(quotes.find((q) => q.id === world.quoteId)?.status, "quote sent").to.eq("SENT");
        }),
    );
  });

  it("06 lets Tricatel sign it from the public link, with no account and no session", () => {
    // `/signature/:id` is the one route `(app)/_layout.tsx` serves unauthenticated (ALLOWED_PATHS),
    // and the three endpoints behind it are `@AllowAnonymous`. Clearing every cookie first is what
    // makes this a stranger opening a link rather than the logged-in seller clicking their own.
    cy.clearCookies();
    cy.then(() => Cypress.session.clearAllSavedSessions());
    cy.then(() => cy.visit(`/signature/${world.signatureId}`));

    cy.clearEmails();

    // The signature card sits beside an 800px-tall PDF preview, so on a 1280×720 viewport the
    // button starts below the fold — Cypress reports it "clipped by a parent with overflow". A
    // reader scrolls to it; so does this.
    cy.get('[data-cy="send-otp-btn"]', { timeout: 20000 })
      .scrollIntoView()
      .should("be.visible")
      .click();

    otpFromInbox().then((otp) => {
      cy.get('input[data-slot="input-otp"]', { timeout: 10000 }).scrollIntoView().type(otp, { force: true });
      cy.get('[data-cy="sign-quote-btn"]').scrollIntoView().should("not.be.disabled").click();
    });

    // Assert the stored status, not the confirmation panel: the panel is rendered off a refetch, so
    // asserting it would be asserting the wait rather than the signature. Poll, because the OTP
    // check and the status write are a round-trip behind the click.
    cy.login();
    cy.then(() => {
      const poll = (left: number): Cypress.Chainable<unknown> =>
        cy
          .request(`${api}/api/quotes/table`)
          .its("body")
          .then((quotes: { id: string; status: string; signedAt?: string }[]) => {
            const quote = quotes.find((q) => q.id === world.quoteId);
            if (quote?.status !== "SIGNED" && left > 0) {
              return cy.wait(500).then(() => poll(left - 1));
            }
            expect(quote?.status, "quote signed by the customer").to.eq("SIGNED");
            expect(quote?.signedAt, "the signature is dated").to.not.be.null;
            return cy.wrap(null, { log: false });
          });
      return poll(20);
    });
  });

  // ── 6. The invoice that follows from the signed quote ──────────────────────────────────────────
  it("07 invoices the signed quote and routes it to the PDP, not to an inbox", () => {
    cy.then(() =>
      cy.request("POST", `${api}/api/invoices/create-from-quote`, {
        quoteId: world.quoteId,
        items: [{ quoteItemId: world.quoteItemId, quantity: 1 }],
      }),
    ).then((res) => {
      expect(res.status, "invoice created from the quote").to.be.oneOf([200, 201]);
      expect(res.body.status).to.eq("DRAFT");
      world.invoiceId = res.body.id;
    });

    // The link back to the quote, read from the quote's own side.
    cy.then(() =>
      cy
        .request(`${api}/api/quotes/${world.quoteId}/invoicing-status`)
        .its("body")
        .then((status: { remainingPercent: number }) => {
          expect(status.remainingPercent, "the signed quote is fully invoiced").to.eq(0);
        }),
    );

    cy.then(() => cy.request("POST", `${api}/api/invoices/${world.invoiceId}/issue`)).then((res) => {
      expect(res.status, "invoice issued").to.be.oneOf([200, 201]);
      expect(res.body.rawNumber, "a gapless number was allocated").to.be.a("string").and.not.be.empty;
    });

    // THE point of the scenario. `profiles/data/fr.ts` gives a domestic B2B invoice issued on or
    // after 2026-09-01 `channels: [PDP, choruspro, PEPPOL]` and deliberately no EMAIL — CGI art.
    // 1737 III penalises sending such an invoice by mail. Before that date the same profile answers
    // EMAIL, which is why this spec needs a clock at or past the mandate.
    cy.then(() =>
      cy
        .request(`${api}/api/invoices/${world.invoiceId}`)
        .its("body")
        .then((inv) => {
          const plan = inv.complianceDocuments?.[0]?.plan;
          expect(plan, "the invoice carries a resolved compliance plan").to.exist;
          expect(
            plan.channels[0].type,
            `primary channel for a domestic FR B2B invoice issued ${inv.issuedAt}`,
          ).to.eq("PDP");
          expect(
            plan.channels.map((c: { type: string }) => c.type),
            "no e-mail escape route once the mandate applies",
          ).to.not.include("EMAIL");
        }),
    );
  });

  it("08 transmits it to superpdp and gets a real deposit back", () => {
    cy.then(() => cy.request("POST", `${api}/api/invoices/send`, { id: world.invoiceId }))
      .its("status")
      .should("be.oneOf", [200, 201]);

    cy.then(() =>
      settle(world.invoiceId as string).then((snap) => {
        // No `noCiTransmission` escape here: the platform is reachable and credentialed, so a
        // transmission that did not happen is a failed test, not a tolerated one.
        expect(snap.status, `compliance status after send${whyItFailed(snap)}`).to.be.oneOf(SETTLED_OK);

        const ref = pdpReference(snap);
        expect(ref, "superpdp handed back a transmission reference").to.be.a("string");
        cy.log(`invoice → PDP reference ${ref}`);
        readBackFromPdp(ref as string, "the invoice");
      }),
    );
  });

  // ── 7. The forgotten line, corrected ───────────────────────────────────────────────────────────
  it("09 issues a credit note for what the invoice got wrong, and transmits that too", () => {
    // The endpoint is told nothing about countries: France's `correctionModel` is CREDIT_NOTE and
    // the profile is what resolves the kind. Asserting the kind proves that resolution happened.
    cy.then(() =>
      cy.request("POST", `${api}/api/invoices/${world.invoiceId}/correct`, {
        reason: "Ligne oubliée sur la facture initiale",
      }),
    ).then((res) => {
      expect(res.status, "correction issued").to.be.oneOf([200, 201]);
      expect(res.body.correctionKind, "France corrects with a credit note").to.eq("CREDIT_NOTE");
      expect(res.body.correctionInvoiceId, "a correction document was created").to.be.a("string");
      world.creditNoteId = res.body.correctionInvoiceId;
    });

    cy.then(() =>
      cy
        .request(`${api}/api/invoices/${world.invoiceId}`)
        .its("body")
        .then((inv) => expect(inv.status, "the original is marked corrected").to.eq("CORRECTED")),
    );

    cy.then(() =>
      cy
        .request(`${api}/api/invoices/${world.creditNoteId}`)
        .its("body")
        .then((cn) => {
          expect(cn.kind).to.eq("CREDIT_NOTE");
          expect(cn.correctsInvoiceId, "it references the invoice it corrects").to.eq(world.invoiceId);
          expect(cn.totalTTC, "a credit note reverses the amount").to.be.lessThan(0);
          expect(cn.items[0].name, "the reversed line keeps its designation").to.eq("Prestation");
        }),
    );

    cy.then(() =>
      cy
        .request("POST", `${api}/api/invoices/send`, { id: world.creditNoteId })
        .its("status")
        .should("be.oneOf", [200, 201]),
    );

    cy.then(() =>
      settle(world.creditNoteId as string).then((snap) => {
        expect(snap.status, `credit note compliance status${whyItFailed(snap)}`).to.be.oneOf(SETTLED_OK);

        const ref = pdpReference(snap);
        expect(ref, "superpdp handed back a reference for the credit note too").to.be.a("string");
        cy.log(`credit note → PDP reference ${ref}`);
        readBackFromPdp(ref as string, "the credit note");
      }),
    );
  });

  // ── 8. The customer pays ───────────────────────────────────────────────────────────────────────
  it("10 records the payment and reports it to the platform", () => {
    cy.then(() =>
      cy.request("POST", `${api}/api/payments/create-from-invoice`, { id: world.invoiceId }),
    ).then((res) => {
      expect(res.status, "payment recorded").to.be.oneOf([200, 201]);
      expect(res.body.invoiceId).to.eq(world.invoiceId);
      expect(res.body.totalPaid, "paid in full").to.be.greaterThan(0);
    });

    cy.then(() =>
      cy
        .request(`${api}/api/invoices/${world.invoiceId}`)
        .its("body")
        .then((inv) => expect(inv.status, "the invoice is settled").to.eq("PAID")),
    );

    // Payment is not only an accounting fact here: the PDP provider maps "encaissée" to lifecycle
    // code fr:212 and pushes it to the platform. The compliance log is where that shows up.
    cy.then(() =>
      cy.task<ComplianceSnapshot>("complianceRefs", world.invoiceId).then((snap) => {
        const types = snap.events.map((e) => e.type);
        expect(types, "the payment reached the compliance log").to.include("PAID");
        expect(
          types.filter((t) => t.startsWith("STATUS:")),
          `a lifecycle status was reported, events were ${JSON.stringify(types)}`,
        ).to.not.be.empty;
      }),
    );
  });
});
