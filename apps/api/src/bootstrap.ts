import { INestApplication, ValidationPipe } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';

function parseCorsOrigins(value: string | undefined): string[] {
  return (value ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

export function configureApp(app: INestApplication): void {
  const isProduction = process.env.NODE_ENV === 'production';

  app.use(
    helmet({
      contentSecurityPolicy: isProduction
        ? {
            directives: {
              baseUri: ["'self'"],
              defaultSrc: ["'self'"],
              frameAncestors: ["'none'"],
              objectSrc: ["'none'"],
            },
          }
        : false,
      hsts: isProduction,
    }),
  );

  app.enableCors({
    origin: parseCorsOrigins(process.env.CORS_ORIGIN),
    methods: ['GET', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
  });

  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );

  const shouldEnableSwagger =
    !isProduction || process.env.ENABLE_SWAGGER === 'true';

  if (shouldEnableSwagger) {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Smart To-Do List API')
      .setDescription('Task management and AI-powered task decomposition API.')
      .setVersion('1.0')
      .build();

    SwaggerModule.setup(
      'docs',
      app,
      SwaggerModule.createDocument(app, swaggerConfig),
    );
  }
}
