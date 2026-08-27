import { ApiProperty } from '@nestjs/swagger';
import { API_KEY_SCOPES, ApiKeyScope } from '@/modules/api-keys/scopes';

export class CreateApiKeyDto {
  @ApiProperty({ description: 'Human-readable label for the key, e.g. "CLI on my laptop"' })
  name: string;

  @ApiProperty({
    description: 'Permission scopes granted to this key. Omit or leave empty for a key with no document-creation access.',
    enum: API_KEY_SCOPES,
    isArray: true,
    required: false,
  })
  scopes?: ApiKeyScope[];
}
