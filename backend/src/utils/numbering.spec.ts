import { NumberingService, DocType } from './numbering';

// Mock Prisma transaction client
const makeTx = () => {
  const store = new Map<string, { counter: number }>();
  return {
    company: {
      findUnique: jest.fn().mockResolvedValue({
        id: 'company-1',
        countryCode: 'FR',
        invoiceNumberFormat: 'INV-{year}-{number:4}',
        invoiceStartingNumber: 1,
        quoteNumberFormat: 'QUO-{year}-{number:4}',
        quoteStartingNumber: 1,
        paymentNumberFormat: 'PAY-{year}-{number:4}',
        paymentStartingNumber: 1,
      }),
    },
    $queryRawUnsafe: jest.fn().mockImplementation(async (sql: string, ...params: any[]) => {
      const key = `${params[0]}-${params[1]}-${params[2]}`;
      const existing = store.get(key);
      if (existing) {
        existing.counter += 1;
        store.set(key, existing);
        return [{ counter: existing.counter }];
      }
      const start = params[3] as number;
      store.set(key, { counter: start });
      return [{ counter: start }];
    }),
  } as any;
};

describe('NumberingService', () => {
  let service: NumberingService;

  beforeEach(() => {
    service = new NumberingService();
  });

  it('assigns the starting number on first call for a series', async () => {
    const tx = makeTx();
    const result = await service.nextNumber(tx, 'company-1', 'invoice', new Date('2026-06-01'));
    expect(result.counter).toBe(1);
    expect(result.rawNumber).toBe('INV-2026-0001');
  });

  it('increments the counter on subsequent calls in the same series', async () => {
    const tx = makeTx();
    const a = await service.nextNumber(tx, 'company-1', 'invoice', new Date('2026-06-01'));
    expect(a.counter).toBe(1);
    const b = await service.nextNumber(tx, 'company-1', 'invoice', new Date('2026-06-02'));
    expect(b.counter).toBe(2);
    expect(b.rawNumber).toBe('INV-2026-0002');
  });

  it('separates counters per docType', async () => {
    const tx = makeTx();
    const inv = await service.nextNumber(tx, 'company-1', 'invoice', new Date('2026-06-01'));
    expect(inv.counter).toBe(1);
    const quo = await service.nextNumber(tx, 'company-1', 'quote', new Date('2026-06-01'));
    expect(quo.counter).toBe(1);
    expect(quo.rawNumber).toBe('QUO-2026-0001');
  });

  it('formats the number per pattern', async () => {
    const tx = makeTx();
    const result = await service.nextNumber(tx, 'company-1', 'payment', new Date('2026-06-15'));
    expect(result.rawNumber).toBe('PAY-2026-0001');
  });
});
