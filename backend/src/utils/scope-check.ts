import { ApiKeyScope } from '@/modules/api-keys/scopes';
import { RequestWithUser } from '@/types/request';

// Session (human) auth is never scope-restricted — its access is governed
// by CompanyRole/@Roles() instead. Only API-key callers (request.scopes is
// a string[], possibly empty) are narrowed to exactly their granted scopes.
export function hasScope(request: Pick<RequestWithUser, 'scopes'>, scope: ApiKeyScope): boolean {
  if (request.scopes === null) return true;
  return request.scopes.includes(scope);
}
