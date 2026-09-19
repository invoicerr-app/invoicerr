import { vi, type Mock } from 'vitest';

import { BILLING_FLAG_NAME } from '../modules/billing/billing-flag';
import { getPendingAcceptanceSlugs, recordLegalAcceptance } from './legal-acceptance';
import { LegalService } from './legal.service';

vi.mock('./legal-acceptance');

const getPending = getPendingAcceptanceSlugs as Mock;
const record = recordLegalAcceptance as Mock;

const ORIGINAL_ENV = process.env[BILLING_FLAG_NAME];

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env[BILLING_FLAG_NAME];
  else process.env[BILLING_FLAG_NAME] = ORIGINAL_ENV;
  vi.clearAllMocks();
});

describe('LegalService.listDocuments', () => {
  it('reports saasMode and every document, self-hosted (flag unset)', () => {
    delete process.env[BILLING_FLAG_NAME];
    const view = new LegalService().listDocuments();
    expect(view.saasMode).toBe(false);
    expect(view.documents).toHaveLength(6);
  });

  it('reports saasMode true with the flag set', () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    expect(new LegalService().listDocuments().saasMode).toBe(true);
  });

  it('defaults to English when called with no preferred-language list at all', () => {
    const doc = new LegalService().listDocuments().documents.find((d) => d.slug === 'privacy-policy');
    expect(doc?.language).toBe('en');
    expect(doc?.title).toBe('Privacy Policy');
  });

  it('serves each document in the best-matching preferred language, per document', () => {
    const documents = new LegalService().listDocuments(['fr']).documents;
    // privacy-policy ships a French translation — it resolves to it.
    const privacy = documents.find((d) => d.slug === 'privacy-policy');
    expect(privacy?.language).toBe('fr');
    expect(privacy?.title).toBe('Politique de Confidentialité');
    // legal-notice also ships a French translation.
    const notice = documents.find((d) => d.slug === 'legal-notice');
    expect(notice?.language).toBe('fr');
  });

  it('falls back to English, per document, for a language the catalog does not carry at all', () => {
    const documents = new LegalService().listDocuments(['xx']).documents;
    for (const doc of documents) {
      expect(doc.language).toBe('en');
    }
  });

  it('every document reports its own available languages regardless of which one was resolved', () => {
    const documents = new LegalService().listDocuments(['de']).documents;
    const privacy = documents.find((d) => d.slug === 'privacy-policy');
    expect(privacy?.availableLanguages).toEqual(['en', 'fr', 'de', 'it', 'pl', 'pt']);
    const notice = documents.find((d) => d.slug === 'legal-notice');
    expect(notice?.availableLanguages).toEqual(['en', 'fr']);
  });
});

describe('LegalService.getStatus', () => {
  it('is always the empty/false shape outside SaaS mode, without even reading the DB', async () => {
    delete process.env[BILLING_FLAG_NAME];
    await expect(new LegalService().getStatus('user-1')).resolves.toEqual({
      requiresAcceptance: false,
      pending: [],
    });
    expect(getPending).not.toHaveBeenCalled();
  });

  it('reflects getPendingAcceptanceSlugs in SaaS mode', async () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    getPending.mockResolvedValue(['privacy-policy']);
    await expect(new LegalService().getStatus('user-1')).resolves.toEqual({
      requiresAcceptance: true,
      pending: ['privacy-policy'],
    });
  });
});

describe('LegalService.accept', () => {
  it('is a no-op outside SaaS mode', async () => {
    delete process.env[BILLING_FLAG_NAME];
    await expect(new LegalService().accept('user-1', undefined, {})).resolves.toEqual({ accepted: [] });
    expect(record).not.toHaveBeenCalled();
  });

  it('defaults to whatever is pending when no slugs are given', async () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    getPending.mockResolvedValue(['terms-of-service', 'privacy-policy']);
    const result = await new LegalService().accept('user-1', undefined, { ipAddress: '1.2.3.4' });
    expect(result).toEqual({ accepted: ['terms-of-service', 'privacy-policy'] });
    expect(record).toHaveBeenCalledWith('user-1', ['terms-of-service', 'privacy-policy'], {
      ipAddress: '1.2.3.4',
    });
  });

  it('filters an explicit slug list down to the documents that actually require acceptance', async () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    const result = await new LegalService().accept(
      'user-1',
      ['terms-of-service', 'legal-notice', 'bogus'],
      {},
    );
    expect(result).toEqual({ accepted: ['terms-of-service'] });
    expect(record).toHaveBeenCalledWith('user-1', ['terms-of-service'], {});
  });

  it('never calls record when the filtered/pending list ends up empty', async () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    const result = await new LegalService().accept('user-1', ['bogus'], {});
    expect(result).toEqual({ accepted: [] });
    expect(record).not.toHaveBeenCalled();
  });
});
