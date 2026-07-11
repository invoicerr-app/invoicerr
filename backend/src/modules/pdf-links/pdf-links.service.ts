import { createHash, randomBytes } from 'crypto';

import { Injectable } from '@nestjs/common';
import { PdfDocumentType } from '../../../prisma/generated/prisma/client';
import prisma from '@/prisma/prisma.service';

const TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

@Injectable()
export class PdfLinksService {
    // Not a password hash: `token` is a 256-bit value from randomBytes, same
    // reasoning as backend/src/utils/api-key.ts's hashApiKey — a fast hash is
    // fine here, it only backs the O(1) tokenHash lookup, not brute-force
    // resistance (which comes from the token's entropy + short TTL).
    async createToken(companyId: string, documentType: PdfDocumentType, documentId: string): Promise<string> {
        const token = randomBytes(32).toString('hex');
        const tokenHash = createHash('sha256').update(token).digest('hex');

        await prisma.pdfDownloadToken.create({
            data: {
                tokenHash,
                documentType,
                documentId,
                companyId,
                expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
            },
        });

        return token;
    }

    // Reusable until expiry (not single-use) — a user may click the link
    // more than once within the hour.
    async resolveToken(token: string) {
        const tokenHash = createHash('sha256').update(token).digest('hex');
        const record = await prisma.pdfDownloadToken.findUnique({ where: { tokenHash } });

        if (!record || record.expiresAt < new Date()) {
            return null;
        }

        return record;
    }
}
