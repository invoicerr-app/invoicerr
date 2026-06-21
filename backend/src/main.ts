import * as bodyParser from 'body-parser';

import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';

import { AppModule } from './app.module';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';

async function bootstrap() {
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

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Invoicerr API')
    .setDescription('Authenticate with an API key (Settings > API Keys) via the Authorization: Bearer header or the X-Api-Key header.')
    .setVersion('1.0')
    .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'API key' }, 'apiKey')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, swaggerDocument);

  await app.listen(process.env.PORT || 3000);
}
bootstrap();
