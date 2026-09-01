import { Controller, ForbiddenException, Post, Req, Res } from '@nestjs/common';

import { ArticlesService } from '@/modules/articles/articles.service';
import { ClientsService } from '@/modules/clients/clients.service';
import { DocumentsService } from '@/modules/documents/documents.service';
import { ShareLinksService } from '@/modules/documents/share-links/share-links.service';
import { Response } from 'express';
import { RequestWithUser } from '@/types/request';
import { createMcpServerForRequest } from './mcp-server.factory';

@Controller('mcp')
export class McpController {
  constructor(
    private readonly documentsService: DocumentsService,
    private readonly shareLinksService: ShareLinksService,
    private readonly clientsService: ClientsService,
    private readonly articlesService: ArticlesService,
  ) {}

  // Raw endpoint: AuthGuard (global) has already resolved companyId/scopes by the time this runs.
  // @Res({ passthrough: false }) hands the raw Express response to the MCP SDK's
  // StreamableHTTPServerTransport, which writes status/headers/body directly — Nest must not touch
  // it. Reprised unchanged from the repère (git tag `avant-refonte-documents`) apart from which
  // services get threaded into the ToolContext, and `baseUrl` below.
  @Post()
  async handleMcp(@Req() req: RequestWithUser, @Res({ passthrough: false }) res: Response) {
    if (!req.companyId) {
      throw new ForbiddenException('No active company selected');
    }

    const { server, transport } = createMcpServerForRequest({
      companyId: req.companyId,
      scopes: req.scopes,
      // The origin THIS request actually reached the backend at — see tools/types.ts's own comment
      // on `ToolContext.baseUrl` for why this replaces the repère's own `BETTER_AUTH_URL` env var:
      // that variable is UNSET in this repo's own test environment (backend.env.test), whose backend
      // listens on :4000, not the dev default (:3000) the repère's own fallback silently assumed —
      // exactly the "wrong origin baked into a link" trap share-links.service.ts's own header
      // already warns about for `APP_URL`. Deriving it from the very request calling this endpoint
      // is correct in dev/test/prod alike, with zero configuration to get wrong.
      baseUrl: `${req.protocol}://${req.headers.host}`,
      services: {
        documentsService: this.documentsService,
        shareLinksService: this.shareLinksService,
        clientsService: this.clientsService,
        articlesService: this.articlesService,
      },
    });

    res.on('close', () => {
      transport.close();
      server.close();
    });

    await server.connect(transport);
    // backend/src/main.ts applies a single global bodyParser.json() ahead of routing, so req.body is
    // already parsed JSON here.
    await transport.handleRequest(req, res, req.body);
  }
}
