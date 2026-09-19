jest.mock('@/prisma/prisma.service', () => ({
  __esModule: true,
  default: {
    company: { count: jest.fn().mockResolvedValue(3) },
    user: { count: jest.fn().mockResolvedValue(5) },
    documentInstance: { count: jest.fn().mockResolvedValue(120) },
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
