import * as bodyParser from 'body-parser';
import { readFileSync } from 'fs';
import { join } from 'path';

import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import { syncDatabaseSchema } from './prisma/sync-schema';

async function bootstrap() {
  if (process.env.NODE_ENV === 'production') {
    try {
      await syncDatabaseSchema();
    } catch (err) {
      console.error('[bootstrap] database sync failed, aborting startup:', err);
      process.exit(1);
    }
  }

  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.enableCors({
    credentials: true,
    origin: ['http://localhost:5173', process.env.APP_URL, ...(process.env.CORS_ORIGINS?.split(',').map(o => o.trim()) || [])].filter(Boolean),
  });
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.use(bodyParser.json({ limit: '1mb' }));
  app.use((_req, res, next) => {
    res.header('Access-Control-Expose-Headers', 'WWW-Authenticate');
    next();
  });

  const { version } = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf-8'));

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Invoicerr API')
    .setDescription('Authenticate with an API key (Settings > API Keys) via the Authorization: Bearer header or the X-Api-Key header.')
    .setVersion(version)
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'API key' }, 'apiKey')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument);

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
