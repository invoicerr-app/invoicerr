import { ArticlesController } from './articles.controller';
import { ArticlesService } from './articles.service';
import { Module } from '@nestjs/common';

@Module({
  providers: [ArticlesService],
  controllers: [ArticlesController],
  exports: [ArticlesService],
})
export class ArticlesModule { }
