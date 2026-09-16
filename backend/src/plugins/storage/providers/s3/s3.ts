/**
 * UNRELATED to `modules/documents/archive/s3-storage.ts` — that one is the LEGAL ARCHIVE's own
 * content-hash-addressed, WORM-discipline S3 provider, configured via `ARCHIVE_S3_*` env vars and
 * selected only by `ARCHIVE_STORAGE=s3`. This file is a completely different mechanism: an
 * admin-configured, DB-config-driven, multi-provider file broadcaster (config lives in the `Plugin`
 * Postgres table, not env vars — see `getConfig()` below), used by `utils/storage-upload.ts` to hand a
 * signed quote or a paid invoice's PDF a public URL. The two share nothing — not the bucket, not the
 * key layout, not the config source — and this file does not import from, or get imported by, the
 * archive module.
 *
 * A real, confirmed gap this creates: a file broadcast through THIS provider (a signed quote PDF, a
 * paid invoice PDF handed to a client) never touches the archive's content-hash storage at all — it
 * is uploaded here, under its own `key`, with no `contentHash`/`DocumentArchive` row, no WORM
 * guarantee, and no retention calculation. The legal archive only ever gets populated through
 * `archive/persistence.ts#createDocumentArchive`, called from `archive-on-send.ts` at document-send
 * time — a file pushed through this S3 plugin outside that path is not an archived artifact in the
 * sense the rest of this codebase means by that word, however similar "a PDF in an S3 bucket" sounds.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { IStorageProvider, IUploadFileProps } from '../../types';

import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import prisma from '@/prisma/prisma.service';

interface IS3Config {
  endpoint?: string;
  region: string;
  bucket: string;
  accessKey: string;
  secretKey: string;
}

export class S3StorageProvider implements IStorageProvider {
  id = 's3';
  name = 'Amazon S3';
  description = 'Store files in an Amazon S3 bucket';

  constructor() {}

  async getConfig(): Promise<IS3Config> {
    const plugin = await prisma.plugin.findUnique({
      where: { id: this.id },
    });

    if (!plugin) {
      throw new Error('S3 plugin not found in database.');
    }

    const config = plugin.config as unknown as IS3Config;

    if (!config) {
      throw new Error('S3 plugin is not configured.');
    }

    return config;
  }

  async getS3Client(config: IS3Config): Promise<S3Client> {
    const accessKey = config.accessKey;
    const secretKey = config.secretKey;

    const s3 = new S3Client({
      region:
        (config.region as string) && (config.region as string).toLowerCase() !== 'auto'
          ? (config.region as string)
          : 'us-east-1',
      endpoint: config?.endpoint,
      credentials: {
        accessKeyId: accessKey,
        secretAccessKey: secretKey,
      },
      forcePathStyle: !!config?.endpoint,
    });
    return s3;
  }

  async uploadFile({ key, buffer, mimeType }: IUploadFileProps): Promise<string> {
    const config = await this.getConfig();
    const s3 = await this.getS3Client(config);

    await s3.send(
      new PutObjectCommand({
        Bucket: config.bucket as string,
        Key: key,
        Body: new Uint8Array(buffer),
        ContentType: mimeType,
      }),
    );

    return `${s3.config.endpoint ?? `https://${config.bucket}.s3.amazonaws.com`}/${key}`;
  }

  async getSignedUrl(key: string, expiresIn = 3600): Promise<string> {
    const config = await this.getConfig();
    const s3 = await this.getS3Client(config);
    const bucket = config.bucket as string;
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    return getSignedUrl(s3, command, { expiresIn });
  }

  async deleteFile(key: string): Promise<void> {
    const config = await this.getConfig();
    const s3 = await this.getS3Client(config);
    await s3.send(new DeleteObjectCommand({ Bucket: config.bucket as string, Key: key }));
  }

  formatUrl(url: string): string {
    return url;
  }

  async validatePlugin(config: IS3Config): Promise<boolean> {
    const s3 = await this.getS3Client(config);
    await s3.send(new ListBucketsCommand({}));
    return true;
  }
}
