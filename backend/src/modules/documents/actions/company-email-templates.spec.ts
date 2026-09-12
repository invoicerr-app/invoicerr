import {
  clearCompanyDocumentEmailTemplate,
  getCompanyDocumentEmailTemplates,
  setCompanyDocumentEmailTemplate,
} from './company-email-templates';

/**
 * `@/prisma/prisma.service` is mocked with a tiny IN-MEMORY `Company` row rather than a bare
 * `jest.fn()` per method — the same "mock the module boundary, not a re-implementation of Prisma"
 * discipline `signatures.service.spec.ts` documents for its own table. That is what lets the
 * read-modify-write semantics this module actually relies on (merge one type's template without
 * clobbering another's) be PROVEN rather than asserted against a stub, `$transaction` included.
 */
jest.mock('@/prisma/prisma.service', () => {
  const store: { documentEmailTemplates: unknown } = { documentEmailTemplates: null };

  const company = {
    findUnique: jest.fn(async () => ({ documentEmailTemplates: store.documentEmailTemplates })),
    update: jest.fn(async ({ data }: { data: { documentEmailTemplates: unknown } }) => {
      store.documentEmailTemplates = data.documentEmailTemplates;
      return { id: 'company-1' };
    }),
  };

  const client = {
    company,
    // Interactive transaction: hands the callback the same client, so the read and the write inside it
    // hit the same in-memory row.
    $transaction: jest.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn(client)),
  };

  return { __esModule: true, default: client, __store: store };
});

function store(): { documentEmailTemplates: unknown } {
  return jest.requireMock('@/prisma/prisma.service').__store;
}

describe('getCompanyDocumentEmailTemplates', () => {
  beforeEach(() => {
    store().documentEmailTemplates = null;
  });

  it('returns {} for a company that never set one — a normal state, never null', async () => {
    await expect(getCompanyDocumentEmailTemplates('company-1')).resolves.toEqual({});
  });

  it('returns the stored map as-is', async () => {
    store().documentEmailTemplates = { invoice: { subject: 's', body: 'b' } };

    await expect(getCompanyDocumentEmailTemplates('company-1')).resolves.toEqual({
      invoice: { subject: 's', body: 'b' },
    });
  });
});

describe('setCompanyDocumentEmailTemplate', () => {
  beforeEach(() => {
    store().documentEmailTemplates = null;
  });

  it("stores one type's template", async () => {
    const stored = await setCompanyDocumentEmailTemplate('company-1', 'invoice', {
      subject: 'Invoice {displayNumber}',
      body: 'Hello',
    });

    expect(stored).toEqual({ subject: 'Invoice {displayNumber}', body: 'Hello' });
    expect(store().documentEmailTemplates).toEqual({
      invoice: { subject: 'Invoice {displayNumber}', body: 'Hello' },
    });
  });

  it('MERGES — saving one type never costs another type its template', async () => {
    store().documentEmailTemplates = { quote: { subject: 'Quote kept', body: 'Quote body' } };

    await setCompanyDocumentEmailTemplate('company-1', 'invoice', { subject: 'Invoice', body: 'Body' });

    expect(store().documentEmailTemplates).toEqual({
      quote: { subject: 'Quote kept', body: 'Quote body' },
      invoice: { subject: 'Invoice', body: 'Body' },
    });
  });

  it('overwrites the SAME type rather than accumulating versions of it', async () => {
    await setCompanyDocumentEmailTemplate('company-1', 'invoice', { subject: 'First', body: 'One' });
    await setCompanyDocumentEmailTemplate('company-1', 'invoice', { subject: 'Second', body: 'Two' });

    expect(store().documentEmailTemplates).toEqual({ invoice: { subject: 'Second', body: 'Two' } });
  });

  it('SANITIZES the html part on the way in — the stored value is the safe one', async () => {
    const stored = await setCompanyDocumentEmailTemplate('company-1', 'invoice', {
      subject: 'Invoice',
      body: 'Text',
      html: '<p onclick="steal()">Hi {recipientName}</p><script>alert(1)</script>',
    });

    expect(stored.html).toBe('<p>Hi {recipientName}</p>');
    // What is in the database is what a send will use: no later reader has to remember to filter.
    expect(JSON.stringify(store().documentEmailTemplates)).not.toContain('script');
    expect(JSON.stringify(store().documentEmailTemplates)).not.toContain('onclick');
    // The placeholder survives sanitization, which is why filtering can precede interpolation.
    expect(stored.html).toContain('{recipientName}');
  });

  it('stores no html key at all when the html part is blank, or becomes blank once sanitized', async () => {
    const blank = await setCompanyDocumentEmailTemplate('company-1', 'invoice', {
      subject: 'Invoice',
      body: 'Text',
      html: '',
    });
    expect(blank).not.toHaveProperty('html');

    const onlyScript = await setCompanyDocumentEmailTemplate('company-1', 'quote', {
      subject: 'Quote',
      body: 'Text',
      html: '<script>alert(1)</script>',
    });
    // Nothing survived the filter, so this is a text-only template — stored in exactly the shape a
    // text-only template has always had.
    expect(onlyScript).toEqual({ subject: 'Quote', body: 'Text' });
  });
});

describe('clearCompanyDocumentEmailTemplate', () => {
  beforeEach(() => {
    store().documentEmailTemplates = null;
    jest.clearAllMocks();
  });

  it("removes one type's override and leaves the others alone", async () => {
    store().documentEmailTemplates = {
      invoice: { subject: 'Invoice', body: 'Body' },
      quote: { subject: 'Quote', body: 'Body' },
    };

    await clearCompanyDocumentEmailTemplate('company-1', 'invoice');

    expect(store().documentEmailTemplates).toEqual({ quote: { subject: 'Quote', body: 'Body' } });
  });

  it('is a no-op — not an error, and not a pointless write — for a type that had no override', async () => {
    store().documentEmailTemplates = { quote: { subject: 'Quote', body: 'Body' } };
    const prisma = jest.requireMock('@/prisma/prisma.service').default;

    await expect(clearCompanyDocumentEmailTemplate('company-1', 'invoice')).resolves.toBeUndefined();

    expect(prisma.company.update).not.toHaveBeenCalled();
    expect(store().documentEmailTemplates).toEqual({ quote: { subject: 'Quote', body: 'Body' } });
  });
});
