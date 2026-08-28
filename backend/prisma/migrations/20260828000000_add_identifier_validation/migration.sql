-- C4: persist the outcome of validating a party identifier, with the date it was obtained.
--
-- invoice-tax.ts hardcoded `validated: false`, and TrustFlagVatValidator only unlocks reverse
-- charge for `validated === true`. From the invoice path no VAT number was ever validated, so an
-- intra-EU B2B service was charged 20% French VAT instead of being reverse-charged (Directive
-- 2006/112 art. 44, CGI art. 259-1°) — a tax the customer does not owe, on an invoice whose VAT
-- category is wrong.
--
-- Persisted rather than checked per invoice: VIES is regularly unavailable and per-member-state
-- rate limited, so revalidating on every issuance is not tenable. The DATE is what makes the stored
-- verdict readable — "valid as of" is a fact, "valid" alone is not.
--
-- Nullable on purpose: NULL means "never checked", which is distinct from "checked and invalid".
-- The engine must be able to tell those apart, and so must the user.

ALTER TABLE "PartyIdentifier" ADD COLUMN "validationStatus" TEXT;
ALTER TABLE "PartyIdentifier" ADD COLUMN "validatedAt" TIMESTAMP(3);
ALTER TABLE "PartyIdentifier" ADD COLUMN "validationSource" TEXT;
