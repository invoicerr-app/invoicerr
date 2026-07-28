import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { ExpensesService, CreateExpenseDto, EditExpenseDto } from './expenses.service';
import { ActiveCompany } from '@/decorators/active-company.decorator';
import { CompanyRole } from '../../../prisma/generated/prisma/client';
import { Roles } from '@/decorators/roles.decorator';

@ApiTags('expenses')
@Controller('expenses')
export class ExpensesController {
  constructor(private readonly expensesService: ExpensesService) {}

  @Get()
  @ApiOperation({
    summary: 'List expenses',
    description: 'Returns all recorded expenses for the active company.',
  })
  @ApiResponse({ status: 200, description: 'Expenses retrieved' })
  async findAll(@ActiveCompany() companyId: string) {
    return this.expensesService.findAll(companyId);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get an expense', description: 'Returns a single expense by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Expense ID' })
  @ApiResponse({ status: 200, description: 'Expense retrieved' })
  @ApiResponse({ status: 404, description: 'Expense not found' })
  async findOne(@ActiveCompany() companyId: string, @Param('id') id: string) {
    const expense = await this.expensesService.findOne(companyId, id);
    if (!expense) {
      return { message: 'Not found' };
    }
    return expense;
  }

  @Post()
  @ApiOperation({ summary: 'Create an expense', description: 'Records a new expense.' })
  @ApiResponse({ status: 201, description: 'Expense created' })
  async create(@ActiveCompany() companyId: string, @Body() dto: CreateExpenseDto) {
    return this.expensesService.create(companyId, dto);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update an expense', description: 'Updates an existing expense by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Expense ID' })
  @ApiResponse({ status: 200, description: 'Expense updated' })
  async update(@ActiveCompany() companyId: string, @Param('id') id: string, @Body() dto: EditExpenseDto) {
    return this.expensesService.update(companyId, id, dto);
  }

  @Delete(':id')
  @Roles(CompanyRole.OWNER, CompanyRole.ADMIN)
  @ApiOperation({ summary: 'Delete an expense', description: 'Permanently deletes an expense by ID.' })
  @ApiParam({ name: 'id', type: String, description: 'Expense ID' })
  @ApiResponse({ status: 200, description: 'Expense deleted' })
  async remove(@ActiveCompany() companyId: string, @Param('id') id: string) {
    return this.expensesService.remove(companyId, id);
  }
}
