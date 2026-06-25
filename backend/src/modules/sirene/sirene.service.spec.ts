import { SireneService } from '@/modules/sirene/sirene.service';

describe('SireneService', () => {
    let service: SireneService;

    beforeEach(() => {
        service = new SireneService();
    });

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it('returns null for an invalid SIRET without calling the API', async () => {
        const fetchSpy = jest.spyOn(global, 'fetch');
        const result = await service.getCompanyBySiret('123');
        expect(result).toBeNull();
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('returns null when the API responds with a non-ok status', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue({ ok: false, status: 404 } as Response);
        const result = await service.getCompanyBySiret('55208131700018');
        expect(result).toBeNull();
    });

    it('returns null on network error', async () => {
        jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network error'));
        const result = await service.getCompanyBySiret('55208131700018');
        expect(result).toBeNull();
    });

    it('maps a successful response to the SireneCompanyDto', async () => {
        jest.spyOn(global, 'fetch').mockResolvedValue({
            ok: true,
            json: async () => ({
                results: [
                    {
                        siren: '552081317',
                        nom_complet: "L'OREAL",
                        date_creation: '1909-01-01',
                        siege: {
                            siret: '55208131700018',
                            adresse: '14 RUE ROYALE',
                            code_postal: '75008',
                            libelle_commune: 'PARIS',
                        },
                    },
                ],
            }),
        } as Response);

        const result = await service.getCompanyBySiret('552 081 317 00018');

        expect(result).toEqual({
            name: "L'OREAL",
            legalId: '55208131700018',
            VAT: 'FR03552081317',
            address: '14 RUE ROYALE',
            postalCode: '75008',
            city: 'PARIS',
            state: undefined,
            country: 'France',
            foundedAt: new Date('1909-01-01'),
        });
    });
});
