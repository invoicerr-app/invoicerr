import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { PortalAuthGuard } from './portal-auth.guard';
import * as persistence from './portal-token.persistence';
import { hashPortalToken } from './portal-token';

jest.mock('./portal-token.persistence');

function contextWithAuthHeader(header: string | undefined): ExecutionContext {
  const request: { headers: Record<string, string | undefined>; portal?: unknown } = {
    headers: { authorization: header },
  };
  return {
    switchToHttp: () => ({
      getRequest: () => request,
    }),
  } as unknown as ExecutionContext;
}

const RAW_TOKEN = 'a'.repeat(64);
const RECORD = {
  id: 'token-1',
  tokenHash: hashPortalToken(RAW_TOKEN),
  companyId: 'company-1',
  clientId: 'client-1',
  createdAt: new Date(),
  expiresAt: new Date(Date.now() + 60_000),
  revokedAt: null,
  lastUsedAt: null,
};

describe('PortalAuthGuard', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('401s with no Authorization header at all', async () => {
    const guard = new PortalAuthGuard();
    await expect(guard.canActivate(contextWithAuthHeader(undefined))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(persistence.findPortalTokenByHash).not.toHaveBeenCalled();
  });

  it('401s on a header that is not a Bearer token', async () => {
    const guard = new PortalAuthGuard();
    await expect(guard.canActivate(contextWithAuthHeader('Basic abc123'))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('401s on an UNKNOWN token — never resolvable to a portal identity', async () => {
    (persistence.findPortalTokenByHash as jest.Mock).mockResolvedValue(null);
    const guard = new PortalAuthGuard();
    await expect(guard.canActivate(contextWithAuthHeader(`Bearer ${RAW_TOKEN}`))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('401s on an EXPIRED token — the exact same refusal as unknown', async () => {
    (persistence.findPortalTokenByHash as jest.Mock).mockResolvedValue({
      ...RECORD,
      expiresAt: new Date(Date.now() - 1000),
    });
    const guard = new PortalAuthGuard();
    await expect(guard.canActivate(contextWithAuthHeader(`Bearer ${RAW_TOKEN}`))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('401s on a REVOKED token — the exact same refusal as unknown/expired', async () => {
    (persistence.findPortalTokenByHash as jest.Mock).mockResolvedValue({ ...RECORD, revokedAt: new Date() });
    const guard = new PortalAuthGuard();
    await expect(guard.canActivate(contextWithAuthHeader(`Bearer ${RAW_TOKEN}`))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('resolves a valid token onto request.portal and touches lastUsedAt', async () => {
    (persistence.findPortalTokenByHash as jest.Mock).mockResolvedValue(RECORD);
    const guard = new PortalAuthGuard();
    const context = contextWithAuthHeader(`Bearer ${RAW_TOKEN}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);

    const request = context.switchToHttp().getRequest<{ portal?: unknown }>();
    expect(request.portal).toEqual({ companyId: 'company-1', clientId: 'client-1', token: RAW_TOKEN });
    expect(persistence.touchPortalTokenLastUsed).toHaveBeenCalledWith('token-1');
  });
});
