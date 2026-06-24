import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { SireneService } from '@/modules/sirene/sirene.service';

@ApiTags('sirene')
@Controller('sirene')
export class SireneController {
    constructor(private readonly sireneService: SireneService) { }

    @Get('siret/:siret')
    @ApiOperation({ summary: 'Look up a company by SIRET', description: 'Looks up company information by SIRET via the recherche-entreprises.api.gouv.fr public directory.' })
    @ApiParam({ name: 'siret', type: String, description: '14-digit SIRET number' })
    @ApiResponse({ status: 200, description: 'Company found or not found' })
    async getCompanyBySiret(@Param('siret') siret: string) {
        const company = await this.sireneService.getCompanyBySiret(siret);
        return { found: !!company, company };
    }
}
