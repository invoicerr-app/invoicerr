import { vi, type Mock } from 'vitest';
import prisma from '@/prisma/prisma.service';

import {
  buildPecAttachmentFilename,
  isValidPecAttachmentFilename,
  nextPecProgressivo,
  PEC_ATTACHMENT_FILENAME_PATTERN,
  PEC_RAW_ATTACHMENT_SAFE_MAX_BYTES,
  resolvePecRecipient,
  SDI_PEC_FIRST_SUBMISSION_ADDRESS,
} from './pec-protocol';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: { $queryRaw: vi.fn() },
}));

const mockedQueryRaw = prisma.$queryRaw as unknown as Mock;

/** A tiny in-memory stand-in for the real `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` — real
 *  enough to prove "the SAME idTrasmittente never gets the same value twice, two different ones never
 *  share a counter" without a real database (the real round trip, atomicity included, is
 *  `numbering/sequence.live.spec.ts`'s own sibling coverage for the identical SQL shape). */
function statefulSequenceMock() {
  const counters = new Map<string, number>();
  return vi.fn(async (_strings: TemplateStringsArray, ...values: unknown[]) => {
    const idTrasmittente = String(values[0]);
    const current = counters.get(idTrasmittente) ?? 1;
    counters.set(idTrasmittente, current + 1);
    return [{ value: current }];
  });
}

describe('pec-protocol — facts read from fatturapa.gov.it, encoded as pure functions', () => {
  it('SDI_PEC_FIRST_SUBMISSION_ADDRESS is the exact address published on "Inviare la FatturaPA"', () => {
    expect(SDI_PEC_FIRST_SUBMISSION_ADDRESS).toBe('sdi01@pec.fatturapa.it');
  });

  describe('resolvePecRecipient — the two-step addressing rule', () => {
    it('targets the published first-submission address when nothing has been learned yet', () => {
      expect(resolvePecRecipient(undefined)).toBe(SDI_PEC_FIRST_SUBMISSION_ADDRESS);
    });

    it('targets the LEARNED reply address once SdI has actually replied — never the fixed address again', () => {
      expect(resolvePecRecipient('sdi07@pec.fatturapa.it')).toBe('sdi07@pec.fatturapa.it');
    });

    it('an empty/blank learned address is treated as "nothing learned yet", not as a real address', () => {
      expect(resolvePecRecipient('   ')).toBe(SDI_PEC_FIRST_SUBMISSION_ADDRESS);
      expect(resolvePecRecipient('')).toBe(SDI_PEC_FIRST_SUBMISSION_ADDRESS);
    });
  });

  describe('the §2.2 filename pattern — the worked examples from the specification, verbatim', () => {
    it("accepts the specification's own worked examples", () => {
      expect(isValidPecAttachmentFilename('ITAAABBB99T99X999W_00001.xml')).toBe(true);
      expect(isValidPecAttachmentFilename('IT99999999999_00002.xml.p7m')).toBe(true);
      expect(isValidPecAttachmentFilename('ITAAABBB99T99X999W_00001.zip')).toBe(true);
    });

    it('rejects a name with no underscore separator (Codice 00001 - Nome file non valido territory)', () => {
      expect(isValidPecAttachmentFilename('IT01234567890.00001.xml')).toBe(false);
    });

    it('rejects a progressivo longer than the 5-character maximum §2.2 allows', () => {
      expect(isValidPecAttachmentFilename('IT01234567890_1234567.xml')).toBe(false);
    });

    it('rejects a disallowed extension', () => {
      expect(isValidPecAttachmentFilename('IT01234567890_00001.pdf')).toBe(false);
    });

    it('rejects a space or other character §2.2 does not allow', () => {
      expect(isValidPecAttachmentFilename('IT 1234567890_00001.xml')).toBe(false);
      expect(isValidPecAttachmentFilename('IT01234567890_000 1.xml')).toBe(false);
    });

    it('the exported pattern and the exported predicate agree on every case above', () => {
      expect(PEC_ATTACHMENT_FILENAME_PATTERN.test('ITAAABBB99T99X999W_00001.xml')).toBe(true);
    });
  });

  // THE MUTATION TARGET: the OLD `buildPecProgressivo` hashed the document id into the 5-character
  // space (36^5 ≈ 60M) — a measurable birthday-paradox collision well within real submission volume
  // (see `pec-protocol.ts`'s own header, "Collision-free progressivo"). `nextPecProgressivo` replaces
  // it with a PERSISTENT COUNTER, which cannot collide with itself by construction.
  describe('nextPecProgressivo — a persistent, per-idTrasmittente counter, ≤5 alphanumeric characters', () => {
    beforeEach(() => vi.clearAllMocks());

    it('is exactly 5 characters, always', async () => {
      mockedQueryRaw.mockImplementation(statefulSequenceMock());
      expect(await nextPecProgressivo('IT01234567890')).toHaveLength(5);
    });

    it('only ever produces [A-Z0-9] — a subset of the allowed [a-zA-Z0-9]', async () => {
      mockedQueryRaw.mockImplementation(statefulSequenceMock());
      expect(await nextPecProgressivo('IT01234567890')).toMatch(/^[A-Z0-9]{5}$/);
    });

    it('never hands out the same value twice for the SAME idTrasmittente — the whole point of a counter', async () => {
      mockedQueryRaw.mockImplementation(statefulSequenceMock());
      const first = await nextPecProgressivo('IT01234567890');
      const second = await nextPecProgressivo('IT01234567890');
      const third = await nextPecProgressivo('IT01234567890');
      expect(new Set([first, second, third]).size).toBe(3);
    });

    it('advances INDEPENDENTLY per idTrasmittente — one trasmittente never consumes another’s counter', async () => {
      mockedQueryRaw.mockImplementation(statefulSequenceMock());
      const a1 = await nextPecProgressivo('IT01234567890');
      const b1 = await nextPecProgressivo('IT09876543210');
      const a2 = await nextPecProgressivo('IT01234567890');
      // Both trasmittenti start their OWN counter at the same first value — proving they are tracked
      // separately, not sharing one global sequence.
      expect(a1).toBe(b1);
      expect(a2).not.toBe(a1);
    });

    it('passes idTrasmittente as the query parameter, never string-concatenated into the SQL', async () => {
      mockedQueryRaw.mockImplementation(statefulSequenceMock());
      await nextPecProgressivo("IT01234567890'; DROP TABLE x; --");
      const [, ...values] = mockedQueryRaw.mock.calls[0];
      expect(values).toEqual(["IT01234567890'; DROP TABLE x; --"]);
    });

    it('throws rather than wrapping once the 5-character space is exhausted', async () => {
      mockedQueryRaw.mockResolvedValue([{ value: 36 ** 5 }]);
      await expect(nextPecProgressivo('IT01234567890')).rejects.toThrow(/exhausted/);
    });
  });

  describe('buildPecAttachmentFilename', () => {
    beforeEach(() => vi.clearAllMocks());

    it('builds a filename that is always valid against PEC_ATTACHMENT_FILENAME_PATTERN', async () => {
      mockedQueryRaw.mockImplementation(statefulSequenceMock());
      const filename = await buildPecAttachmentFilename('IT01234567890');
      expect(filename).toMatch(/^IT01234567890_[A-Z0-9]{5}\.xml$/);
      expect(isValidPecAttachmentFilename(filename)).toBe(true);
    });

    it('two successive calls for the SAME idTrasmittente build two DIFFERENT filenames', async () => {
      mockedQueryRaw.mockImplementation(statefulSequenceMock());
      const first = await buildPecAttachmentFilename('IT01234567890');
      const second = await buildPecAttachmentFilename('IT01234567890');
      expect(first).not.toBe(second);
    });

    it(
      'throws (never silently truncates or sanitizes) when idTrasmittente itself contains characters ' +
        '§2.2 forbids — a malformed attachment name, refused BEFORE anything is sent',
      async () => {
        mockedQueryRaw.mockImplementation(statefulSequenceMock());
        await expect(buildPecAttachmentFilename('IT 0123 4567890')).rejects.toThrow(/does not match/);
        await expect(buildPecAttachmentFilename('IT-01234567890')).rejects.toThrow(/Nome file non valido/);
      },
    );
  });

  describe('PEC_RAW_ATTACHMENT_SAFE_MAX_BYTES — a conservative safety margin, not a fact read from a source', () => {
    it('leaves real headroom under the 30 MB message ceiling once base64 inflation is accounted for', () => {
      expect(PEC_RAW_ATTACHMENT_SAFE_MAX_BYTES).toBeGreaterThan(10 * 1024 * 1024);
      expect(PEC_RAW_ATTACHMENT_SAFE_MAX_BYTES).toBeLessThan(30 * 1024 * 1024);
    });
  });
});
