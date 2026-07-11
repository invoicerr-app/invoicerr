import { Injectable, NotFoundException } from '@nestjs/common';
import { Currency, Expense } from '../../../prisma/generated/prisma/client';

import { logger } from '@/logger/logger.service';
import prisma from '@/prisma/prisma.service';

export interface CreateExpenseDto {
  description: string;
  amount: number;
  currency?: Currency;
  date?: Date;
  notes?: string;
}

export interface EditExpenseDto {
  description?: string;
  amount?: number;
  currency?: Currency;
  date?: Date;
  notes?: string | null;
}

@Injectable()
export class ExpensesService {
  async create(companyId: string, dto: CreateExpenseDto): Promise<Expense> {
    const company = await prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    const expense = await prisma.expense.create({
      data: {
        companyId,
        description: dto.description,
        amount: dto.amount,
        currency: dto.currency ?? company.currency,
        date: dto.date ?? new Date(),
        notes: dto.notes,
      },
    });

    logger.info('Expense created', { category: 'expense', details: { expenseId: expense.id, companyId } });

    return expense;
  }

  async findAll(companyId: string): Promise<Expense[]> {
    return prisma.expense.findMany({
      where: { companyId },
      orderBy: { date: 'desc' },
    });
  }

  async findOne(companyId: string, id: string): Promise<Expense | null> {
    return prisma.expense.findFirst({ where: { id, companyId } });
  }

  async update(companyId: string, id: string, dto: EditExpenseDto): Promise<Expense> {
    const existing = await prisma.expense.findFirst({ where: { id, companyId } });
    if (!existing) {
      logger.error('Expense not found', { category: 'expense', details: { id } });
      throw new NotFoundException('Expense not found');
    }

    const updated = await prisma.expense.update({
      where: { id },
      data: {
        description: dto.description ?? existing.description,
        amount: dto.amount ?? existing.amount,
        currency: dto.currency ?? existing.currency,
        date: dto.date ?? existing.date,
        notes: dto.notes === undefined ? existing.notes : dto.notes,
      },
    });

    logger.info('Expense updated', { category: 'expense', details: { expenseId: updated.id, companyId } });

    return updated;
  }

  async remove(companyId: string, id: string): Promise<Expense> {
    const existing = await prisma.expense.findFirst({ where: { id, companyId } });
    if (!existing) {
      logger.error('Expense not found', { category: 'expense', details: { id } });
      throw new NotFoundException('Expense not found');
    }

    const deleted = await prisma.expense.delete({ where: { id } });

    logger.info('Expense deleted', { category: 'expense', details: { expenseId: id, companyId } });

    return deleted;
  }
}
