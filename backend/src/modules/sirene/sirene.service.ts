import { Injectable, Logger } from '@nestjs/common';
import { SireneCompanyDto } from '@/modules/sirene/dto/sirene-company.dto';
import { calculateFrenchVAT, extractSirenFromSiret, formatSiret, isValidSiret } from '@/modules/sirene/sirene.utils';

const SIRENE_API_URL = 'https://recherche-entreprises.api.gouv.fr/search';
const REQUEST_TIMEOUT_MS = 8000;

@Injectable()
export class SireneService {
    private readonly logger = new Logger(SireneService.name);

    async getCompanyBySiret(siret: string): Promise<SireneCompanyDto | null> {
        if (!isValidSiret(siret)) return null;

        const formattedSiret = formatSiret(siret);
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

        try {
            const res = await fetch(`${SIRENE_API_URL}?q=${formattedSiret}&per_page=1`, {
                signal: controller.signal,
            });

            if (!res.ok) {
                this.logger.warn(`Sirene lookup for ${formattedSiret} failed with status ${res.status}`);
                return null;
            }

            const data = await res.json();
            const result = data?.results?.[0];
            if (!result || result.siege?.siret !== formattedSiret) return null;

            return this.mapToDto(result);
        } catch (err) {
            this.logger.warn(`Sirene lookup for ${formattedSiret} failed: ${err?.message}`);
            return null;
        } finally {
            clearTimeout(timeout);
        }
    }

    private mapToDto(result: any): SireneCompanyDto {
        const siege = result.siege ?? {};
        const siren = result.siren ?? extractSirenFromSiret(siege.siret ?? '');

        return {
            name: result.nom_complet ?? result.nom_raison_sociale ?? siege.siret,
            legalId: siege.siret,
            VAT: siren ? calculateFrenchVAT(siren) : undefined,
            address: siege.adresse,
            postalCode: siege.code_postal,
            city: siege.libelle_commune,
            state: undefined,
            country: 'France',
            foundedAt: result.date_creation ? new Date(result.date_creation) : undefined,
        };
    }
}
