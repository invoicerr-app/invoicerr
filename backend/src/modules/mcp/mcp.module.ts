import { ArticlesModule } from '@/modules/articles/articles.module';
import { ClientsModule } from '@/modules/clients/clients.module';
import { DocumentsModule } from '@/modules/documents/documents.module';
import { McpController } from './mcp.controller';
import { Module } from '@nestjs/common';

/**
 * Root TODO item 23 ("serveur MCP"). `DocumentsModule` re-exports `DocumentsCoreModule` wholesale
 * (see that file's own header), which is where `DocumentsService`/`ShareLinksService` actually live
 * — imported here for exactly those two. `ClientsModule`/`ArticlesModule` are imported directly:
 * `list_clients`/`create_client`/`list_articles` read those services straight, the same way the
 * repère's own `McpModule` did (git tag `avant-refonte-documents`) — those two entities were never
 * part of the documents "démolition" this ticket rebuilds on top of.
 */
@Module({
  imports: [DocumentsModule, ClientsModule, ArticlesModule],
  controllers: [McpController],
})
export class McpModule {}
