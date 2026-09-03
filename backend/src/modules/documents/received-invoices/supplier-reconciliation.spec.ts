/**
 * TODO_PRODUIT.md T5(b) — real Prisma, same discipline as `clients.vat-validation.spec.ts`: this
 * module reaches `Client`/`PartyIdentifier` through the bare `prisma` singleton (never
 * `ClientsService`/`ClientsModule` — see this module's own header on why), so proving it means real
 * rows, not a mock of a query builder. Every `it` below creates and tears down its own Company(+
 * Client+PartyIdentifier) rows — unique emails (`Date.now()` + a random suffix) keep concurrent runs
 * from colliding on the DB's own unique constraints.
 */
import prisma from '@/prisma/prisma.service';

import { markClientAsSupplier, reconcileSupplierClient } from './supplier-reconciliation';

let seq = 0;
function uniqueEmail(label: string): string {
  seq += 1;
  return `supplier-reconciliation-${label}-${Date.now()}-${seq}@example.com`;
}

async function createCompany(label: string) {
  return prisma.company.create({
    data: {
      name: `Reconciliation Co ${label}`,
      foundedAt: new Date('2020-01-01'),
      address: '1 Test Street',
      postalCode: '00000',
      city: 'Testville',
      country: 'France',
      countryCode: 'FR',
      phone: '+33000000000',
      email: uniqueEmail(`company-${label}`),
    },
  });
}

async function createClient(companyId: string, name: string, vat?: string) {
  const client = await prisma.client.create({
    data: {
      companyId,
      name,
      address: '2 Client Street',
      postalCode: '11111',
      city: 'Clientville',
      country: 'France',
      countryCode: 'FR',
      contactEmail: uniqueEmail(`client-${name.replace(/\s+/g, '-')}`),
    },
  });
  if (vat) {
    await prisma.partyIdentifier.create({ data: { clientId: client.id, scheme: 'VAT', value: vat } });
  }
  return client;
}

describe('supplier-reconciliation — TODO_PRODUIT.md T5(b), real Prisma', () => {
  describe('reconcileSupplierClient — VAT match', () => {
    let companyId: string;
    let clientId: string;

    beforeAll(async () => {
      const company = await createCompany('vat-match');
      companyId = company.id;
      const client = await createClient(companyId, 'Fournisseur Un', 'FR12345678901');
      clientId = client.id;
    });

    afterAll(async () => {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    });

    it('a VAT number that resolves to exactly one client of THIS company links automatically', async () => {
      const result = await reconcileSupplierClient(companyId, { vatId: 'FR12345678901' });
      expect(result).toEqual({ outcome: 'matched', clientId, matchedBy: 'vat' });
    });

    it('normalizes whitespace and case before comparing — a cosmetic formatting difference still matches', async () => {
      const result = await reconcileSupplierClient(companyId, { vatId: ' fr 1234 5678 901 ' });
      expect(result).toEqual({ outcome: 'matched', clientId, matchedBy: 'vat' });
    });

    it('a VAT number nobody has is reported unmatched — NEVER a created client', async () => {
      const result = await reconcileSupplierClient(companyId, { vatId: 'FR99999999999' });
      expect(result).toEqual({ outcome: 'unmatched', reason: 'not-found' });

      // No client was silently created by a failed match.
      const clientCountAfter = await prisma.client.count({ where: { companyId } });
      expect(clientCountAfter).toBe(1);
    });
  });

  describe('reconcileSupplierClient — companyId scoping (multi-tenant)', () => {
    let companyAId: string;
    let companyBId: string;

    beforeAll(async () => {
      const [companyA, companyB] = await Promise.all([createCompany('scope-a'), createCompany('scope-b')]);
      companyAId = companyA.id;
      companyBId = companyB.id;
      // Same VAT, same name — deliberately, so ONLY the companyId scope decides the outcome.
      await createClient(companyAId, 'Fournisseur Partagé', 'FR55566677701');
    });

    afterAll(async () => {
      await Promise.all([
        prisma.company.delete({ where: { id: companyAId } }).catch(() => undefined),
        prisma.company.delete({ where: { id: companyBId } }).catch(() => undefined),
      ]);
    });

    it('a client belonging to ANOTHER company never matches — by VAT', async () => {
      const result = await reconcileSupplierClient(companyBId, { vatId: 'FR55566677701' });
      expect(result).toEqual({ outcome: 'unmatched', reason: 'not-found' });
    });

    it('a client belonging to ANOTHER company never matches — by name', async () => {
      const result = await reconcileSupplierClient(companyBId, { supplierName: 'Fournisseur Partagé' });
      expect(result).toEqual({ outcome: 'unmatched', reason: 'not-found' });
    });

    it('the SAME criteria still matches for the OWNING company', async () => {
      const result = await reconcileSupplierClient(companyAId, { vatId: 'FR55566677701' });
      expect(result.outcome).toBe('matched');
    });
  });

  describe('reconcileSupplierClient — ambiguity', () => {
    let companyId: string;
    let clientOneId: string;
    let clientTwoId: string;

    beforeAll(async () => {
      const company = await createCompany('ambiguous');
      companyId = company.id;
      const [clientOne, clientTwo] = await Promise.all([
        createClient(companyId, 'Fournisseur Alpha', 'FR11122233301'),
        createClient(companyId, 'Fournisseur Beta', 'FR11122233301'), // same VAT, deliberately
      ]);
      clientOneId = clientOne.id;
      clientTwoId = clientTwo.id;
      await createClient(companyId, 'Fournisseur Gamma Doublon'); // name collision, below
      await createClient(companyId, 'Fournisseur Gamma Doublon');
    });

    afterAll(async () => {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    });

    it('two candidates sharing the SAME VAT: never linked, the ambiguity is named — the safest call', async () => {
      const result = await reconcileSupplierClient(companyId, { vatId: 'FR11122233301' });
      expect(result.outcome).toBe('ambiguous');
      if (result.outcome === 'ambiguous') {
        expect(result.matchedBy).toBe('vat');
        expect(result.candidateIds.sort()).toEqual([clientOneId, clientTwoId].sort());
      }
    });

    it('an ambiguous VAT match does NOT fall through to a name guess', async () => {
      // Even though `supplierName` here matches NEITHER candidate above, the point is: the VAT
      // ambiguity is reported as-is, never silently resolved by trying the name next.
      const result = await reconcileSupplierClient(companyId, {
        vatId: 'FR11122233301',
        supplierName: 'Some Other Name Entirely',
      });
      expect(result.outcome).toBe('ambiguous');
    });

    it('two candidates sharing the SAME exact name: never linked, the ambiguity is named', async () => {
      const result = await reconcileSupplierClient(companyId, { supplierName: 'Fournisseur Gamma Doublon' });
      expect(result.outcome).toBe('ambiguous');
      if (result.outcome === 'ambiguous') expect(result.matchedBy).toBe('name');
    });
  });

  describe('reconcileSupplierClient — exact name fallback (no VAT on the deposit)', () => {
    let companyId: string;
    let clientId: string;

    beforeAll(async () => {
      const company = await createCompany('name-match');
      companyId = company.id;
      const client = await createClient(companyId, 'Fournisseur Sans Tva Connu');
      clientId = client.id;
    });

    afterAll(async () => {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    });

    it('an exact name match links when no VAT was on the deposit at all', async () => {
      const result = await reconcileSupplierClient(companyId, { supplierName: 'Fournisseur Sans Tva Connu' });
      expect(result).toEqual({ outcome: 'matched', clientId, matchedBy: 'name' });
    });

    it('a near, non-exact name never matches — "exactement" is read literally', async () => {
      const result = await reconcileSupplierClient(companyId, {
        supplierName: 'fournisseur sans tva connu', // different case
      });
      expect(result).toEqual({ outcome: 'unmatched', reason: 'not-found' });
    });

    it('a VAT that matches nothing falls through to a name that DOES', async () => {
      const result = await reconcileSupplierClient(companyId, {
        vatId: 'FR00000000000',
        supplierName: 'Fournisseur Sans Tva Connu',
      });
      expect(result).toEqual({ outcome: 'matched', clientId, matchedBy: 'name' });
    });

    it('no VAT and no name at all: unmatched, named "no-criteria" — never confused with a real miss', async () => {
      const result = await reconcileSupplierClient(companyId, {});
      expect(result).toEqual({ outcome: 'unmatched', reason: 'no-criteria' });
    });
  });

  describe('reconcileSupplierClient — a soft-deleted client is never resurrected by an incoming invoice', () => {
    let companyId: string;

    beforeAll(async () => {
      const company = await createCompany('inactive');
      companyId = company.id;
      const client = await createClient(companyId, 'Fournisseur Inactif', 'FR22233344401');
      await prisma.client.update({ where: { id: client.id }, data: { isActive: false } });
    });

    afterAll(async () => {
      await prisma.company.delete({ where: { id: companyId } }).catch(() => undefined);
    });

    it('an inactive client never matches, by VAT nor by name', async () => {
      const byVat = await reconcileSupplierClient(companyId, { vatId: 'FR22233344401' });
      expect(byVat).toEqual({ outcome: 'unmatched', reason: 'not-found' });
      const byName = await reconcileSupplierClient(companyId, { supplierName: 'Fournisseur Inactif' });
      expect(byName).toEqual({ outcome: 'unmatched', reason: 'not-found' });
    });
  });

  describe('markClientAsSupplier — the role posed at link time, one-way, tenant-scoped', () => {
    let companyAId: string;
    let companyBId: string;
    let clientId: string;

    beforeAll(async () => {
      const [companyA, companyB] = await Promise.all([createCompany('role-a'), createCompany('role-b')]);
      companyAId = companyA.id;
      companyBId = companyB.id;
      const client = await createClient(companyAId, 'Fournisseur À Marquer');
      clientId = client.id;
    });

    afterAll(async () => {
      await Promise.all([
        prisma.company.delete({ where: { id: companyAId } }).catch(() => undefined),
        prisma.company.delete({ where: { id: companyBId } }).catch(() => undefined),
      ]);
    });

    it('a fresh client is not a supplier by default (the backfill decision)', async () => {
      const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
      expect(client.isSupplier).toBe(false);
    });

    it('marks the client as a supplier for its OWNING company', async () => {
      await markClientAsSupplier(companyAId, clientId);
      const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
      expect(client.isSupplier).toBe(true);
    });

    it('is idempotent — calling it again changes nothing further', async () => {
      await markClientAsSupplier(companyAId, clientId);
      await markClientAsSupplier(companyAId, clientId);
      const client = await prisma.client.findUniqueOrThrow({ where: { id: clientId } });
      expect(client.isSupplier).toBe(true);
    });

    it("a DIFFERENT company can never flip another company's client — the write scopes by companyId, not just id", async () => {
      const otherClient = await createClient(companyAId, 'Fournisseur Non Ciblé');
      await markClientAsSupplier(companyBId, otherClient.id); // companyB does not own this client
      // A cross-tenant write must silently no-op, never leak.
      const client = await prisma.client.findUniqueOrThrow({ where: { id: otherClient.id } });
      expect(client.isSupplier).toBe(false);
    });
  });
});
