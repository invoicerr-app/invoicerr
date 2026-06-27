import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';

import { Public } from '@thallesp/nestjs-better-auth';
import prisma from '@/prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
    @Get()
    @Public()
    @ApiOperation({ summary: 'Health check', description: 'Returns 200 when the database is reachable, 503 otherwise (public).' })
    @ApiResponse({ status: 200, description: 'Service healthy' })
    @ApiResponse({ status: 503, description: 'Database unreachable' })
    async check() {
        try {
            await prisma.$queryRaw`SELECT 1`;
            return { status: 'ok', database: 'up' };
        } catch {
            throw new ServiceUnavailableException({ status: 'error', database: 'down' });
        }
    }
}
