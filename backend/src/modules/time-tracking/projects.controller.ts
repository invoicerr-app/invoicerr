import { ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';

import { ActiveCompany } from '@/decorators/active-company.decorator';

import { CreateProjectDto, EditProjectDto, ProjectsService } from './projects.service';

@ApiTags('time-tracking')
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projectsService: ProjectsService) {}

  @Get()
  @ApiOperation({
    summary: 'List projects',
    description: "Returns this company's projects, active ones only unless includeArchived=true.",
  })
  @ApiQuery({ name: 'clientId', required: false })
  @ApiQuery({ name: 'includeArchived', required: false, type: Boolean })
  @ApiResponse({ status: 200, description: 'Projects retrieved' })
  async findAll(
    @ActiveCompany() companyId: string,
    @Query('clientId') clientId?: string,
    @Query('includeArchived') includeArchived?: string,
  ) {
    return this.projectsService.findAll(companyId, { clientId, includeArchived: includeArchived === 'true' });
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get a project' })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Project retrieved' })
  async findOne(@ActiveCompany() companyId: string, @Param('id') id: string) {
    const project = await this.projectsService.findOne(companyId, id);
    if (!project) {
      return { message: 'Not found' };
    }
    return project;
  }

  @Post()
  @ApiOperation({
    summary: 'Create a project',
    description:
      "A billing bucket between a client and its logged time entries — see Project's own schema comment.",
  })
  @ApiResponse({ status: 201, description: 'Project created' })
  @ApiResponse({ status: 404, description: 'Client not found' })
  async create(@ActiveCompany() companyId: string, @Body() dto: CreateProjectDto) {
    return this.projectsService.create(companyId, dto);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Update a project',
    description:
      'Also how a project is archived — set isArchived: true (there is no hard delete: a ' +
      'project keeps every time entry it ever billed).',
  })
  @ApiParam({ name: 'id', type: String })
  @ApiResponse({ status: 200, description: 'Project updated' })
  @ApiResponse({ status: 404, description: 'Project not found' })
  async update(@ActiveCompany() companyId: string, @Param('id') id: string, @Body() dto: EditProjectDto) {
    return this.projectsService.update(companyId, id, dto);
  }
}
