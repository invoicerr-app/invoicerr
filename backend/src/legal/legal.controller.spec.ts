// `@thallesp/nestjs-better-auth`'s own package ships an ESM-only transitive dependency
// (better-auth/dist/integrations/node.mjs) jest's ts-jest transform doesn't parse — mocked here, the
// same way `public-documents.controller.spec.ts`/`sdi-notifiche.controller.spec.ts` already do, rather
// than widening jest's transformIgnorePatterns for one decorator whose only job is to set metadata
// AuthGuard reads.
jest.mock('@thallesp/nestjs-better-auth', () => ({
  Public: () => () => undefined,
}));

import { LegalController } from './legal.controller';
import { LegalService } from './legal.service';

const CLICKING_USER = {
  id: 'user-1',
  email: 'owner@acme.test',
  firstname: 'Ada',
  lastname: 'Owner',
} as never;

function fakeRequest(overrides: Partial<{ ip: string; headers: Record<string, string> }> = {}) {
  return {
    ip: overrides.ip ?? '203.0.113.9',
    headers: overrides.headers ?? { 'user-agent': 'jest-agent' },
  } as never;
}

function buildController() {
  const service = {
    listDocuments: jest.fn(),
    getStatus: jest.fn(),
    accept: jest.fn(),
  } as unknown as LegalService;
  return { controller: new LegalController(service), service };
}

describe('LegalController.documents', () => {
  it('delegates straight to the service, no user required (public route)', () => {
    const { controller, service } = buildController();
    (service.listDocuments as jest.Mock).mockReturnValue({ saasMode: false, documents: [] });
    expect(controller.documents()).toEqual({ saasMode: false, documents: [] });
    expect(service.listDocuments).toHaveBeenCalledWith();
  });
});

describe('LegalController.status', () => {
  it("delegates to the service with the caller's user id", () => {
    const { controller, service } = buildController();
    (service.getStatus as jest.Mock).mockResolvedValue({
      requiresAcceptance: true,
      pending: ['privacy-policy'],
    });
    const result = controller.status(CLICKING_USER);
    expect(service.getStatus).toHaveBeenCalledWith('user-1');
    return expect(result).resolves.toEqual({ requiresAcceptance: true, pending: ['privacy-policy'] });
  });
});

describe('LegalController.accept', () => {
  it('forwards the body slugs plus the request ip/user-agent as acceptance metadata', () => {
    const { controller, service } = buildController();
    (service.accept as jest.Mock).mockResolvedValue({ accepted: ['terms-of-service'] });

    controller.accept(CLICKING_USER, { slugs: ['terms-of-service'] }, fakeRequest());

    expect(service.accept).toHaveBeenCalledWith('user-1', ['terms-of-service'], {
      ipAddress: '203.0.113.9',
      userAgent: 'jest-agent',
    });
  });

  it('tolerates a missing body and a missing user-agent header', () => {
    const { controller, service } = buildController();
    (service.accept as jest.Mock).mockResolvedValue({ accepted: [] });

    controller.accept(CLICKING_USER, undefined, fakeRequest({ headers: {} }));

    expect(service.accept).toHaveBeenCalledWith('user-1', undefined, {
      ipAddress: '203.0.113.9',
      userAgent: null,
    });
  });
});
