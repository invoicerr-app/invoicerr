import { ApiProperty } from '@nestjs/swagger';

export class CreateApiKeyDto {
  @ApiProperty({ description: 'Human-readable label for the key, e.g. "CLI on my laptop"' })
  name: string;
}
