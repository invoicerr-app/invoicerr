import { vi } from 'vitest';

vi.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { count: vi.fn().mockResolvedValue(3) },
    user: { count: vi.fn().mockResolvedValue(5) },
    documentInstance: { count: vi.fn().mockResolvedValue(120) },
  },
}));

import { InstancePreflightService } from './instance-preflight.service';

describe('instance/InstancePreflightService', () => {
  it('reports the counts of every table the reset screen warns about', async () => {
    const service = new InstancePreflightService();
    const view = await service.getPreflight();
    expect(view).toEqual({ companies: 3, users: 5, documents: 120 });
  });
});
