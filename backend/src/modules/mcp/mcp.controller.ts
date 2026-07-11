import { Controller, ForbiddenException, Post, Req, Res } from '@nestjs/common';

import { ArticlesService } from '@/modules/articles/articles.service';
import { ClientsService } from '@/modules/clients/clients.service';
import { InvoicesService } from '@/modules/invoices/invoices.service';
import { PdfLinksService } from '@/modules/pdf-links/pdf-links.service';
import { QuotesService } from '@/modules/quotes/quotes.service';
import { Response } from 'express';
import { RequestWithUser } from '@/types/request';
import { createMcpServerForRequest } from './mcp-server.factory';

@Controller('mcp')
export class McpController {
    constructor(
        private readonly quotesService: QuotesService,
        private readonly invoicesService: InvoicesService,
        private readonly clientsService: ClientsService,
        private readonly articlesService: ArticlesService,
        private readonly pdfLinksService: PdfLinksService,
    ) { }

    // Raw endpoint: AuthGuard (global) has already resolved companyId/scopes
    // by the time this runs. @Res({ passthrough: false }) hands the raw
    // Express response to the MCP SDK's StreamableHTTPServerTransport, which
    // writes status/headers/body directly — Nest must not touch it.
    @Post()
    async handleMcp(@Req() req: RequestWithUser, @Res({ passthrough: false }) res: Response) {
        if (!req.companyId) {
            throw new ForbiddenException('No active company selected');
        }

        const { server, transport } = createMcpServerForRequest({
            companyId: req.companyId,
            scopes: req.scopes,
            services: {
                quotesService: this.quotesService,
                invoicesService: this.invoicesService,
                clientsService: this.clientsService,
                articlesService: this.articlesService,
                pdfLinksService: this.pdfLinksService,
            },
        });

        res.on('close', () => {
            transport.close();
            server.close();
        });

        await server.connect(transport);
        // backend/src/main.ts applies a single global bodyParser.json()
        // ahead of routing, so req.body is already parsed JSON here.
        await transport.handleRequest(req, res, req.body);
    }
}
