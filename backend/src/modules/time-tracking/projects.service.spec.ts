/**
 * ProjectsService in isolation — mocks `@/prisma/prisma.service` at its own entry point, the same
 * discipline articles.service.spec.ts already holds for its own sibling module.
 */

import { vi, type Mock } from 'vitest';

import { NotFoundException } from '@nestjs/common';

import prisma from '@/prisma/prisma.service';

import { ProjectsService } from './projects.service';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    project: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), update: vi.fn() },
    client: { findFirst: vi.fn() },
    company: { findUnique: vi.fn() },
  },
}));

const mockedPrisma = prisma as unknown as {
  project: { create: Mock; findMany: Mock; findFirst: Mock; update: Mock };
  client: { findFirst: Mock };
  company: { findUnique: Mock };
};

function project(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    id: 'project-1',
    companyId: 'company-1',
    clientId: 'client-1',
    name: 'Website redesign',
    description: null,
    hourlyRateMinor: null,
    isArchived: false,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    client: { id: 'client-1', name: 'Acme SARL' },
    ...overrides,
  };
}

describe('ProjectsService', () => {
  let service: ProjectsService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new ProjectsService();
    mockedPrisma.company.findUnique.mockResolvedValue({ currency: 'EUR' });
    mockedPrisma.client.findFirst.mockResolvedValue({ id: 'client-1', companyId: 'company-1' });
  });

  describe('create', () => {
    it('refuses a client that does not belong to this company', async () => {
      mockedPrisma.client.findFirst.mockResolvedValue(null);
      await expect(service.create('company-1', { clientId: 'foreign', name: 'X' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(mockedPrisma.project.create).not.toHaveBeenCalled();
    });

    it('converts the given MAJOR-unit hourlyRate to minor units before persisting', async () => {
      mockedPrisma.project.create.mockResolvedValue(project({ hourlyRateMinor: 7500 }));

      await service.create('company-1', { clientId: 'client-1', name: 'Website redesign', hourlyRate: 75 });

      expect(mockedPrisma.project.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ hourlyRateMinor: 7500 }) }),
      );
    });

    it('returns hourlyRate back in MAJOR units, never the raw minor column', async () => {
      mockedPrisma.project.create.mockResolvedValue(project({ hourlyRateMinor: 7500 }));

      const result = await service.create('company-1', {
        clientId: 'client-1',
        name: 'Website redesign',
        hourlyRate: 75,
      });

      expect(result.hourlyRate).toBe(75);
      expect(result).not.toHaveProperty('hourlyRateMinor');
    });

    it('a project with no rate at all stores and returns null, never 0', async () => {
      mockedPrisma.project.create.mockResolvedValue(project({ hourlyRateMinor: null }));

      const result = await service.create('company-1', { clientId: 'client-1', name: 'X' });

      expect(mockedPrisma.project.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ hourlyRateMinor: null }) }),
      );
      expect(result.hourlyRate).toBeNull();
    });
  });

  describe('findAll', () => {
    it('excludes archived projects by default', async () => {
      mockedPrisma.project.findMany.mockResolvedValue([]);
      await service.findAll('company-1');
      expect(mockedPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ isArchived: false }) }),
      );
    });

    it('includes archived projects when asked', async () => {
      mockedPrisma.project.findMany.mockResolvedValue([]);
      await service.findAll('company-1', { includeArchived: true });
      const where = mockedPrisma.project.findMany.mock.calls[0][0].where;
      expect(where.isArchived).toBeUndefined();
    });

    it('scopes by clientId when given', async () => {
      mockedPrisma.project.findMany.mockResolvedValue([]);
      await service.findAll('company-1', { clientId: 'client-1' });
      expect(mockedPrisma.project.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ clientId: 'client-1' }) }),
      );
    });
  });

  describe('findOne', () => {
    it('returns null for a missing project rather than throwing', async () => {
      mockedPrisma.project.findFirst.mockResolvedValue(null);
      await expect(service.findOne('company-1', 'missing')).resolves.toBeNull();
    });
  });

  describe('update', () => {
    it('404s for a project belonging to another company', async () => {
      mockedPrisma.project.findFirst.mockResolvedValue(null);
      await expect(service.update('company-1', 'project-1', { name: 'X' })).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('leaves hourlyRate UNCHANGED when omitted from the DTO', async () => {
      mockedPrisma.project.findFirst.mockResolvedValue(project({ hourlyRateMinor: 5000 }));
      mockedPrisma.project.update.mockResolvedValue(project({ hourlyRateMinor: 5000 }));

      await service.update('company-1', 'project-1', { name: 'Renamed' });

      expect(mockedPrisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ hourlyRateMinor: 5000 }) }),
      );
    });

    it('an explicit null CLEARS the rate — distinct from "omitted"', async () => {
      mockedPrisma.project.findFirst.mockResolvedValue(project({ hourlyRateMinor: 5000 }));
      mockedPrisma.project.update.mockResolvedValue(project({ hourlyRateMinor: null }));

      await service.update('company-1', 'project-1', { hourlyRate: null });

      expect(mockedPrisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ hourlyRateMinor: null }) }),
      );
    });

    it('archives a project via isArchived: true — no hard delete exists', async () => {
      mockedPrisma.project.findFirst.mockResolvedValue(project({ isArchived: false }));
      mockedPrisma.project.update.mockResolvedValue(project({ isArchived: true }));

      const result = await service.update('company-1', 'project-1', { isArchived: true });

      expect(mockedPrisma.project.update).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ isArchived: true }) }),
      );
      expect(result.isArchived).toBe(true);
    });
  });
});
