import { vi, type Mock } from 'vitest';

import { BILLING_FLAG_NAME } from '../modules/billing/billing-flag';
import { DEMO_MODE_FLAG_NAME } from '../modules/demo/demo-flag';
import { getPendingAcceptanceSlugs, recordLegalAcceptance } from './legal-acceptance';
import { LegalService } from './legal.service';

vi.mock('./legal-acceptance');

const getPending = getPendingAcceptanceSlugs as Mock;
const record = recordLegalAcceptance as Mock;

const DEMO_RESET_INTERVAL = 'DEMO_RESET_INTERVAL_HOURS';
const FLAGS = [BILLING_FLAG_NAME, DEMO_MODE_FLAG_NAME, DEMO_RESET_INTERVAL];
const ORIGINAL_ENV = Object.fromEntries(FLAGS.map((name) => [name, process.env[name]]));

afterEach(() => {
  for (const name of FLAGS) {
    if (ORIGINAL_ENV[name] === undefined) delete process.env[name];
    else process.env[name] = ORIGINAL_ENV[name];
  }
  vi.clearAllMocks();
});

describe('LegalService.listDocuments', () => {
  // Decision 2026-09-20: a self-hosted instance serves NONE of the seven documents — every one of them
  // describes the hosted offering by name (the author's own identity, a subscription that instance
  // doesn't have, a processor relationship where he processes nothing for it) and is true of nobody
  // else. Only the licence already in the repository governs a self-hosted install.
  it('reports saasMode:false and NO documents, self-hosted (flag unset)', () => {
    delete process.env[BILLING_FLAG_NAME];
    const view = new LegalService().listDocuments();
    expect(view.saasMode).toBe(false);
    expect(view.documents).toEqual([]);
  });

  it('reports saasMode true and every document with the flag set', () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    const view = new LegalService().listDocuments();
    expect(view.saasMode).toBe(true);
    expect(view.documents).toHaveLength(7);
  });

  it('defaults to English when called with no preferred-language list at all', () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    const doc = new LegalService().listDocuments().documents.find((d) => d.slug === 'privacy-policy');
    expect(doc?.language).toBe('en');
    expect(doc?.title).toBe('Privacy Policy');
  });

  it('serves each document in the best-matching preferred language, per document', () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    const documents = new LegalService().listDocuments(['fr']).documents;
    // privacy-policy ships a short French summary (D-297) — it resolves to it.
    const privacy = documents.find((d) => d.slug === 'privacy-policy');
    expect(privacy?.language).toBe('fr');
    expect(privacy?.title).toBe('Politique de Confidentialité (synthèse en français)');
    // legal-notice ships one too.
    const notice = documents.find((d) => d.slug === 'legal-notice');
    expect(notice?.language).toBe('fr');
    expect(notice?.title).toBe('Mentions Légales');
  });

  it('falls back to English, per document, for a language the catalog does not carry at all', () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    const documents = new LegalService().listDocuments(['xx']).documents;
    for (const doc of documents) {
      expect(doc.language).toBe('en');
    }
  });

  it('every document reports its own available languages regardless of which one was resolved', () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    const documents = new LegalService().listDocuments(['fr']).documents;
    const privacy = documents.find((d) => d.slug === 'privacy-policy');
    expect(privacy?.availableLanguages).toEqual(['en', 'fr']);
    const notice = documents.find((d) => d.slug === 'legal-notice');
    expect(notice?.availableLanguages).toEqual(['en', 'fr']);
    // A document with no French page at all: English only, even to a French reader.
    const refund = documents.find((d) => d.slug === 'refund-policy');
    expect(refund?.availableLanguages).toEqual(['en']);
    expect(refund?.language).toBe('en');
  });

  it('serves a German, Italian, Polish or Portuguese reader English on every document', () => {
    process.env[BILLING_FLAG_NAME] = 'true';
    for (const lang of ['de', 'it', 'pl', 'pt']) {
      const documents = new LegalService().listDocuments([lang]).documents;
      for (const doc of documents) {
        expect(doc.language).toBe('en');
      }
    }
  });
});

describe('LegalService.listDocuments: the demo instance', () => {
  it('serves no demo account at all when DEMO_MODE is off', () => {
    delete process.env[DEMO_MODE_FLAG_NAME];
    const view = new LegalService().listDocuments();
    expect(view.demoMode).toBe(false);
    expect(view.demo).toBeNull();
  });

  it('serves the seeded demo account and the reset interval when DEMO_MODE is on', () => {
    process.env[DEMO_MODE_FLAG_NAME] = 'true';
    delete process.env[DEMO_RESET_INTERVAL];
    const view = new LegalService().listDocuments();
    expect(view.demoMode).toBe(true);
    expect(view.demo).toEqual({ email: 'demo@invoicerr.app', password: 'demo', resetIntervalHours: 4 });
  });

  it('reports the reset interval the deployment declares', () => {
    process.env[DEMO_MODE_FLAG_NAME] = 'true';
    process.env[DEMO_RESET_INTERVAL] = '6';
    expect(new LegalService().listDocuments().demo?.resetIntervalHours).toBe(6);
  });

  it.each(['0', '-2', '1.5', 'often', ''])('falls back to 4 hours for an unusable interval %j', (raw) => {
    process.env[DEMO_MODE_FLAG_NAME] = 'true';
    process.env[DEMO_RESET_INTERVAL] = raw;
    expect(new LegalService().listDocuments().demo?.resetIntervalHours).toBe(4);
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
