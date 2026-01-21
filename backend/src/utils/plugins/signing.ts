import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { PluginsService } from '@/modules/plugins/plugins.service';
import { WebhookDispatcherService } from '@/modules/webhooks/webhook-dispatcher.service';
import { WebhooksService } from '@/modules/webhooks/webhooks.service';
import { generateQuotePdf } from '@/utils/generate-quote-pdf';
import { StorageUploadService } from '@/utils/storage-upload';
import { PrismaClient, QuoteStatus, WebhookEvent } from '../../../prisma/generated/prisma/client';

export async function markQuoteAs(quoteId: string, status: QuoteStatus) {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! });
  const prisma = new PrismaClient({ adapter });

  const quote = await prisma.quote.update({
    where: { id: quoteId },
    data: {
      status: status,
    },
    include: {
      client: true,
      company: true,
    },
  });

  let event: WebhookEvent | null = null;
  switch (status) {
    case QuoteStatus.SIGNED:
      event = WebhookEvent.QUOTE_SIGNED;
      break;
    case QuoteStatus.REJECTED:
      event = WebhookEvent.QUOTE_REJECTED;
      break;
    case QuoteStatus.SENT:
      event = WebhookEvent.QUOTE_SENT;
      break;
    case QuoteStatus.EXPIRED:
      event = WebhookEvent.QUOTE_EXPIRED;
      break;
    default:
      event = WebhookEvent.QUOTE_STATUS_CHANGED;
  }

  if (event) {
    const webhooks = await prisma.webhook.findMany({
      where: {
        companyId: quote.companyId,
        events: {
          has: event,
        },
      },
    });

    if (webhooks.length > 0) {
      const pluginsService = new PluginsService();
      const webhooksService = new WebhooksService(pluginsService);
      const dispatcher = new WebhookDispatcherService(webhooksService);

      await dispatcher.dispatch(event, {
        quote,
        client: quote.client,
        company: quote.company,
        signedAt: quote.signedAt,
        newStatus: status,
      });
    }
  }

  if (status === QuoteStatus.SIGNED) {
    try {
      const pdfBuffer = await generateQuotePdf(quoteId);
      await StorageUploadService.uploadSignedQuotePdf(quoteId, pdfBuffer);
    } catch {
      // Do nothing on failure
    }
  }

  await prisma.$disconnect();
}
