import { Module } from '@nestjs/common';

import { SdiNotificheController } from './sdi-notifiche.controller';
import { SdiNotificheService } from './sdi-notifiche.service';

/**
 * A small module of its own — same reasoning `public/public-documents.module.ts` gives for its own
 * single-controller module: this needs neither `DocumentsCoreModule`'s registries (`TransportRegistry`
 * etc.) nor any Nest-managed Prisma provider (`SdiNotificheService` calls the plain, prisma-importing
 * functions in `conformity/authority-events.persistence.ts` directly — see `CLAUDE.md`'s own "prisma
 * is a singleton default export" rule) — importing the whole documents module graph for one route
 * would be a needless coupling.
 */
@Module({
  controllers: [SdiNotificheController],
  providers: [SdiNotificheService],
})
export class SdiNotificheModule {}
