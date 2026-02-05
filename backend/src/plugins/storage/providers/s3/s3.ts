import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListBucketsCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import prisma from '@/prisma/prisma.service';
import type { IStorageProvider, IUploadFileProps } from '../../types';

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
