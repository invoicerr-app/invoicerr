-- What the USER declared, as opposed to what the ENGINE resolved.
--
-- `vatCategory`/`vatExemptionReason` (added by 20260828120000) hold the engine's answer. These two
-- hold the question. The distinction matters because a 0 rate does not determine its EN 16931
-- category: Z (zero-rated), E (exempt) and O (out of scope) all carry it and demand contradictory
-- things of the document, and no amount of country data settles which one a given line is — only
-- the person issuing the invoice knows.
--
-- Same relationship as `requestedVatRate` to `vatRate`: the hint is persisted verbatim so issuance
-- recomputes FROM it rather than from the resolved value.
--
-- Both nullable, and null means "not declared" — the engine derives exactly as it did before, so
-- every existing row keeps its behaviour.
ALTER TABLE "InvoiceItem" ADD COLUMN "requestedVatCategory" TEXT;
ALTER TABLE "InvoiceItem" ADD COLUMN "requestedVatExemptionReason" TEXT;
