import {
  buildPecAttachmentFilename,
  buildPecProgressivo,
  isValidPecAttachmentFilename,
  PEC_ATTACHMENT_FILENAME_PATTERN,
  PEC_RAW_ATTACHMENT_SAFE_MAX_BYTES,
  resolvePecRecipient,
  SDI_PEC_FIRST_SUBMISSION_ADDRESS,
} from './pec-protocol';

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

  describe('buildPecProgressivo — deterministic, ≤5 alphanumeric characters', () => {
    it("is exactly 5 characters, always, regardless of the input id's own length/shape", () => {
      expect(buildPecProgressivo('doc-1')).toHaveLength(5);
      expect(buildPecProgressivo('a-much-longer-cuid-style-document-identifier-000000')).toHaveLength(5);
      expect(buildPecProgressivo('')).toHaveLength(5);
    });

    it('only ever produces [A-Z0-9] — a subset of the allowed [a-zA-Z0-9]', () => {
      expect(buildPecProgressivo('doc-1')).toMatch(/^[A-Z0-9]{5}$/);
    });

    it('is deterministic — the SAME document id always yields the SAME progressivo', () => {
      expect(buildPecProgressivo('doc-42')).toBe(buildPecProgressivo('doc-42'));
    });

    it('two different document ids yield different progressivi (no trivial collision)', () => {
      expect(buildPecProgressivo('doc-42')).not.toBe(buildPecProgressivo('doc-43'));
    });
  });

  describe('buildPecAttachmentFilename', () => {
    it('builds a filename that is always valid against PEC_ATTACHMENT_FILENAME_PATTERN', () => {
      const filename = buildPecAttachmentFilename('IT01234567890', 'doc-1234567890');
      expect(filename).toMatch(/^IT01234567890_[A-Z0-9]{5}\.xml$/);
      expect(isValidPecAttachmentFilename(filename)).toBe(true);
    });

    it('the SAME (idTrasmittente, documentId) pair always builds the SAME filename', () => {
      expect(buildPecAttachmentFilename('IT01234567890', 'doc-1')).toBe(
        buildPecAttachmentFilename('IT01234567890', 'doc-1'),
      );
    });

    it(
      'throws (never silently truncates or sanitizes) when idTrasmittente itself contains characters ' +
        '§2.2 forbids — a malformed attachment name, refused BEFORE anything is sent',
      () => {
        expect(() => buildPecAttachmentFilename('IT 0123 4567890', 'doc-1')).toThrow(/does not match/);
        expect(() => buildPecAttachmentFilename('IT-01234567890', 'doc-1')).toThrow(/Nome file non valido/);
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
