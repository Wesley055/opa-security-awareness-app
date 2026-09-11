import { json, urlencoded } from "express";
import { ValidationPipe } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { DocumentBuilder, SwaggerModule } from "@nestjs/swagger";

import { initializeEnvironment } from "./shared/config/environment";
import { GlobalExceptionFilter } from "./shared/filters/global-exception.filter";

async function bootstrap(): Promise<void> {
  await initializeEnvironment();
  const { AppModule } = await import("./app.module");
  const app = await NestFactory.create(AppModule, { bodyParser: false });
  app.use(
    json({
      verify: (request, _response, buffer) => {
        // Only Resend signs exact JSON bytes. No other route retains raw PII.
        if (
          request.method === "POST" &&
          request.url?.split("?")[0] ===
            "/notifications/provider-receipts/resend"
        ) {
          (request as typeof request & { rawBody?: Buffer }).rawBody = buffer;
        }
      },
    }),
  );
  app.use(urlencoded({ extended: true }));

  // Azure App Service terminates traffic at its reverse proxy before the
  // Node process. Trust only that immediate hop so req.ip resolves to the
  // originating client for endpoint-level throttling.
  app.getHttpAdapter().getInstance().set("trust proxy", 1);

  const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter((o) => o.length > 0);
  app.enableCors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : false,
    credentials: true,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.useGlobalFilters(new GlobalExceptionFilter());

  const config = new DocumentBuilder()
    .setTitle("OPA Safety API")
    .setDescription(
      "Emergency response, SOS alerts, family notification, and responder management API",
    )
    .setVersion("1.0")
    .addBearerAuth()
    .build();

  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup("api/docs", app, document);

  await app.listen(process.env.PORT || 3000);
}

void bootstrap().catch(() => {
  console.error(
    "OPA startup rejected; review environment and migration preflight",
  );
  process.exitCode = 1;
});
