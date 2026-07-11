import { ArticlesModule } from '@/modules/articles/articles.module';
import { ClientsModule } from '@/modules/clients/clients.module';
import { InvoicesModule } from '@/modules/invoices/invoices.module';
import { McpController } from './mcp.controller';
import { Module } from '@nestjs/common';
import { PdfLinksModule } from '@/modules/pdf-links/pdf-links.module';
import { QuotesModule } from '@/modules/quotes/quotes.module';

@Module({
    imports: [QuotesModule, InvoicesModule, ClientsModule, ArticlesModule, PdfLinksModule],
    controllers: [McpController],
})
export class McpModule { }
