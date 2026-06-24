import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  ArticlesService,
  CreateArticleDto,
  EditArticleDto,
} from './articles.service';
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';

@ApiTags('articles')
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) { }

  @Get()
  @ApiOperation({ summary: 'List articles', description: 'Returns all active catalog articles for the company.' })
  @ApiResponse({ status: 200, description: 'Articles retrieved' })
  async findAll() {
    return this.articlesService.findAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an article', description: 'Returns a single catalog article by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Article ID' })
  @ApiResponse({ status: 200, description: 'Article retrieved' })
  @ApiResponse({ status: 404, description: 'Article not found' })
  async findOne(@Param('id') id: string) {
    const article = await this.articlesService.findOne(id);
    if (!article) {
      return { message: 'Not found' };
    }
    return article;
  }

  @Post()
  @ApiOperation({ summary: 'Create an article', description: 'Adds a new reusable catalog article (product or service).' })
  @ApiResponse({ status: 201, description: 'Article created' })
  async create(@Body() dto: CreateArticleDto) {
    return this.articlesService.create(dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an article', description: 'Updates an existing catalog article by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Article ID' })
  @ApiResponse({ status: 200, description: 'Article updated' })
  async update(@Param('id') id: string, @Body() dto: EditArticleDto) {
    return this.articlesService.update(id, dto);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete an article', description: 'Soft-deletes a catalog article by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Article ID' })
  @ApiResponse({ status: 200, description: 'Article deleted' })
  async remove(@Param('id') id: string) {
    return this.articlesService.softDelete(id);
  }
}
