import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ArticlesService, CreateArticleDto, EditArticleDto } from './articles.service';
import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ActiveCompany } from '@/decorators/active-company.decorator';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { Roles } from '@/decorators/roles.decorator';

@ApiTags('articles')
@Controller('articles')
export class ArticlesController {
  constructor(private readonly articlesService: ArticlesService) {}

  @Get()
  @ApiOperation({
    summary: 'List articles',
    description: 'Returns all active catalog articles for the company.',
  })
  @ApiResponse({ status: 200, description: 'Articles retrieved' })
  async findAll(@ActiveCompany() companyId: string) {
    return this.articlesService.findAll(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an article', description: 'Returns a single catalog article by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Article ID' })
  @ApiResponse({ status: 200, description: 'Article retrieved' })
  @ApiResponse({ status: 404, description: 'Article not found' })
  async findOne(@ActiveCompany() companyId: string, @Param('id') id: string) {
    const article = await this.articlesService.findOne(companyId, id);
    if (!article) {
      return { message: 'Not found' };
    }
    return article;
  }

  @Post()
  @ApiOperation({
    summary: 'Create an article',
    description: 'Adds a new reusable catalog article (product or service).',
  })
  @ApiResponse({ status: 201, description: 'Article created' })
  async create(@ActiveCompany() companyId: string, @Body() dto: CreateArticleDto) {
    return this.articlesService.create(companyId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an article', description: 'Updates an existing catalog article by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Article ID' })
  @ApiResponse({ status: 200, description: 'Article updated' })
  async update(@ActiveCompany() companyId: string, @Param('id') id: string, @Body() dto: EditArticleDto) {
    return this.articlesService.update(companyId, id, dto);
  }

  @Delete(':id')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({ summary: 'Delete an article', description: 'Soft-deletes a catalog article by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Article ID' })
  @ApiResponse({ status: 200, description: 'Article deleted' })
  async remove(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.articlesService.softDelete(companyId, id);
  }
}
