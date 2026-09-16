import { BadRequestException } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

/**
 * `POST /api/legal/accept` request body — see `legal.controller.ts`'s own Swagger description for
 * the exact semantics (omit `slugs` to accept whatever is currently pending). No `ValidationPipe`/
 * class-validator runs anywhere in this API (`company.service.ts`'s own comment on why —
 * `EditCompanyDto`/`EditClientsDto` are plain interfaces for the same reason), so decorating this
 * class with `@IsOptional()`/`@IsArray()` would document an expectation nothing enforces. The actual
 * shape check lives in `parseAcceptLegalSlugs` below instead; this class only carries the Swagger
 * metadata.
 */
export class AcceptLegalDto {
  @ApiProperty({
    description:
      'Slugs to accept (terms-of-service, privacy-policy). Omit to accept whatever is currently pending.',
    type: [String],
    required: false,
  })
  slugs?: string[];
}

/**
 * `legal.service.ts#accept` filters `slugs` with `.filter(...)`, which throws a raw 500 on anything
 * that isn't an array — e.g. `{"slugs": "terms-of-service"}` (a bare string) passes the service's own
 * `slugs.length > 0` truthiness check first, then has no `.filter` method. Checked here, in the
 * controller, so a malformed body is refused with a named 400 before it ever reaches the service.
 */
export function parseAcceptLegalSlugs(body: { slugs?: unknown } | undefined): string[] | undefined {
  if (body?.slugs === undefined) return undefined;
  if (!Array.isArray(body.slugs) || body.slugs.some((slug) => typeof slug !== 'string')) {
    throw new BadRequestException('slugs must be an array of strings');
  }
  return body.slugs;
}
