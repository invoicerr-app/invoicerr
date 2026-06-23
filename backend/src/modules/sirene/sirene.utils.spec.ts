import { calculateFrenchVAT, extractSirenFromSiret, formatSiret, isValidSiret } from '@/modules/sirene/sirene.utils';

describe('sirene.utils', () => {
    describe('formatSiret', () => {
        it('strips non-digit characters', () => {
            expect(formatSiret('552 081 317 00018')).toBe('55208131700018');
        });
    });

    describe('isValidSiret', () => {
        it('returns true for a valid SIRET', () => {
            expect(isValidSiret('55208131700018')).toBe(true);
        });

        it('returns false when the length is not 14 digits', () => {
            expect(isValidSiret('123')).toBe(false);
        });

        it('returns false when the Luhn checksum is invalid', () => {
            expect(isValidSiret('55208131700019')).toBe(false);
        });
    });

    describe('extractSirenFromSiret', () => {
        it('returns the first 9 digits', () => {
            expect(extractSirenFromSiret('552 081 317 00018')).toBe('552081317');
        });
    });

    describe('calculateFrenchVAT', () => {
        it('computes the FR VAT number from a SIREN', () => {
            expect(calculateFrenchVAT('552081317')).toBe('FR03552081317');
        });
    });
});
