import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import { CountryPolicyDecision, evaluateCountryPolicy } from '../country-policy/country-policy';
import {
  DocumentActionDescriptor,
  DocumentTypeDescriptor,
  findShareLinkAction,
  isActionAvailable,
} from '../descriptors/types';
import { findOwnedDocument } from '../persistence';
import type { CreatedShareLink } from './share-links.service';
import { generateShareLinkToken } from './share-link-token';
import { createShareLinkToken } from './share-link.persistence';

/** 30 days — see this file's own header for why the removed compliance engine's 1-hour TTL was not
 *  reused. */
const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function publicPathFor(token: string): string {
  return `/api/public/documents/${token}/pdf`;
}

export function shareLinkStatusConflict(
  action: DocumentActionDescriptor,
  policy: CountryPolicyDecision,
  status: string,
  typeId: string,
): string | undefined {
  if (!isActionAvailable(action, status)) {
    return (
      `Cannot create a public share link for a document with status "${status}" — a draft ` +
      'has no number and no legal existence yet to hand a stranger a link to.'
    );
  }
  const allowedStatuses = policy.restrictedToStatuses;
  if (allowedStatuses && !allowedStatuses.includes(status)) {
    return (
      `Action "${action.id}" of document type "${typeId}" is restricted by this company's ` +
      `country policy to status(es) ${allowedStatuses.join(', ')}, not "${status}".`
    );
  }
}

/** 404s for an unknown type OR a type that never declared "share-link" at all — same message shape
 *  `documents.service.ts`'s own private `resolveAction` uses for "download-xml". */
function resolveShareLinkAction(descriptor: DocumentTypeDescriptor) {
  const action = findShareLinkAction(descriptor);
  if (!action) {
    throw new NotFoundException(`Document type "${descriptor.id}" has no action "share-link".`);
  }
  return action;
}

export async function createDocumentShareLink(
  companyId: string,
  descriptor: DocumentTypeDescriptor,
  documentId: string,
): Promise<CreatedShareLink> {
  const typeId = descriptor.id;
  const action = resolveShareLinkAction(descriptor);
  const policyDecision = await evaluateCountryPolicy(companyId, typeId, action.id);
  if (!policyDecision.allowed) {
    throw new ForbiddenException(policyDecision.reason);
  }

  const instance = await findOwnedDocument(companyId, typeId, documentId);

  const conflict = shareLinkStatusConflict(action, policyDecision, instance.status, typeId);
  if (conflict) {
    throw new ConflictException(conflict);
  }

  const { token, tokenHash } = generateShareLinkToken();
  const expiresAt = new Date(Date.now() + DEFAULT_TTL_MS);
  const record = await createShareLinkToken({ companyId, typeId, documentId, tokenHash, expiresAt });

  return { id: record.id, token, path: publicPathFor(token), expiresAt: record.expiresAt };
}
