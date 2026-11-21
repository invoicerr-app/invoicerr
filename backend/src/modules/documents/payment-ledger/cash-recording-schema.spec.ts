import { defaultComposedCountryCatalog } from '../countries/registry';
import { renderAttestation } from './attestation';
import {
  ATTESTATION_PLACEHOLDERS,
  assertValidCashRecordingSection,
  CountryCashRecordingFile,
  InvalidCashRecordingSectionError,
} from './cash-recording-schema';

function shipped(): CountryCashRecordingFile {
  const section = defaultComposedCountryCatalog.get('FR')?.cashRecording;
  if (!section) throw new Error('the French file carries no cashRecording section');
  return structuredClone(section);
}

describe('cashRecording country section', () => {
  it('is carried by the French file, with legal provenance for the obligation and every exclusion', () => {
    const section = shipped();
    expect(section.obligation.conditions).toEqual(['inalterability', 'security', 'retention', 'archiving']);
    expect(section.obligation.provenance.kind).toBe('legal');
    expect(section.exclusions.map((rule) => rule.id).sort()).toEqual([
      'business-customers-only',
      'foreign-not-established',
      'franchise-flat-rate-or-exempt',
    ]);
    for (const rule of section.exclusions) expect(rule.provenance.kind).toBe('legal');
    expect(section.attestation.model.reference).toMatch(/^BOI-LETTRE-000242/);
  });

  it('is absent for a country whose file states no such obligation', () => {
    for (const code of ['DE', 'DZ', 'IT', 'PL', 'PT']) {
      expect(defaultComposedCountryCatalog.get(code)?.cashRecording).toBeUndefined();
    }
  });

  it('uses every attestation placeholder at least once in the French model', () => {
    const text = shipped()
      .attestation.model.blocks.map((block) => `${block.heading ?? ''}${block.text}`)
      .join('\n');
    for (const name of ATTESTATION_PLACEHOLDERS) expect(text).toContain(`{${name}}`);
  });

  it.each([
    ['an unknown condition', (s: CountryCashRecordingFile) => s.obligation.conditions.push('magic' as never)],
    ['an empty condition list', (s: CountryCashRecordingFile) => (s.obligation.conditions = [])],
    [
      'an exclusion without provenance',
      (s: CountryCashRecordingFile) => delete (s.exclusions[0] as never)['provenance'],
    ],
    ['a duplicate exclusion id', (s: CountryCashRecordingFile) => s.exclusions.push({ ...s.exclusions[0] })],
    [
      'an unknown placeholder',
      (s: CountryCashRecordingFile) => (s.attestation.model.blocks[0].text += ' {nope}'),
    ],
    [
      'a malformed availableFrom',
      (s: CountryCashRecordingFile) => (s.attestation.availableFrom = '21/02/2026'),
    ],
    ['an empty archive notice', (s: CountryCashRecordingFile) => (s.archive.notice = ' ')],
    [
      'an unverified fact without a resolution note',
      (s: CountryCashRecordingFile) => (s.archive.provenance = { kind: 'unverified' } as never),
    ],
  ])('refuses %s', (_label, mutate) => {
    const section = shipped();
    mutate(section);
    expect(() => assertValidCashRecordingSection(section, 'test')).toThrow(InvalidCashRecordingSectionError);
  });
});

describe('renderAttestation', () => {
  it('fills known values and blanks out the rest, listing them', () => {
    const rendered = renderAttestation(
      {
        reference: 'REF',
        fileName: 'model',
        blocks: [{ heading: '{softwareName}', text: 'Edited by {publisherName} for {companyName}.' }],
        provenance: { kind: 'unverified', resolutionNote: 'test' },
      },
      { softwareName: 'Invoicerr', companyName: 'Acme' },
    );

    expect(rendered.text).toContain('Invoicerr');
    expect(rendered.text).toContain('Edited by ________ for Acme.');
    expect(rendered.missing).toEqual(['publisherName']);
  });
});
