-- CreateIndex
-- A PARTIAL, EXPRESSION unique index over the reserved `data.pdpInboundId` key (see
-- `conformity/reception-sweep-runner.ts`'s own header, "Idempotency" — this is a deliberate
-- "reserved data key, no dedicated column" choice `received-invoice.descriptor.ts` already documents
-- for `fileRef`/`fileName`/`fileMime`, so this is a raw index over the JSONB path rather than a new
-- scalar column + a normal Prisma `@@unique`). Scoped to `typeId = 'received-invoice'` and to rows that
-- actually carry the key: every OTHER document type's `data` is free to reuse the string
-- "pdpInboundId" for something unrelated without ever colliding with this constraint.
CREATE UNIQUE INDEX "DocumentInstance_pdpInboundId_key"
ON "DocumentInstance" ("companyId", (("data"->>'pdpInboundId')))
WHERE "typeId" = 'received-invoice' AND ("data"->>'pdpInboundId') IS NOT NULL;
