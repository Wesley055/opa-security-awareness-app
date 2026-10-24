import { BadRequestException, Body, Controller, Get, Header, Put, Req, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import { ArrayMaxSize, IsArray, IsIn, IsLatitude, IsLongitude, IsOptional, IsString, Length, MaxLength, ValidateIf, ValidateNested } from "class-validator";
import { PrismaService } from "../../prisma/prisma.service";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";

class SavedPlaceDto {
  @IsString() @Length(1, 24) label!: string;
  @IsOptional() @IsString() @MaxLength(160) description?: string;
  @ValidateIf((d) => d.latitude !== undefined || d.longitude !== undefined) @IsLatitude() latitude?: number;
  @ValidateIf((d) => d.latitude !== undefined || d.longitude !== undefined) @IsLongitude() longitude?: number;
}

class SavedPlacesDto {
  @IsArray() @ArrayMaxSize(4) @ValidateNested({ each: true }) @Type(() => SavedPlaceDto) places!: SavedPlaceDto[];
}

class LanguageDto {
  @IsIn(["en", "ha", "pcm", "yo", "ig"]) language!: string;
}

/** A resident's saved places (offered on USSD as "1 Home") and language. Own account only. */
@Controller("emergency-delivery")
@UseGuards(JwtAuthGuard)
export class SavedPlacesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get("saved-places")
  @Header("Cache-Control", "no-store")
  async list(@Req() request: { user: { sub: string } }) {
    const [places, user] = await Promise.all([
      this.prisma.savedPlace.findMany({ where: { userId: request.user.sub }, orderBy: { position: "asc" } }),
      this.prisma.user.findUnique({ where: { id: request.user.sub }, select: { preferredLanguage: true } }),
    ]);
    return {
      language: user?.preferredLanguage ?? "en",
      places: places.map((p) => ({
        position: p.position,
        label: p.label,
        description: p.description,
        latitude: p.latitude === null ? null : Number(p.latitude),
        longitude: p.longitude === null ? null : Number(p.longitude),
      })),
    };
  }

  /** Replaces the whole list in order (positions 1-4). */
  @Put("saved-places")
  async replace(@Req() request: { user: { sub: string } }, @Body() body: SavedPlacesDto) {
    const labels = body.places.map((p) => p.label.trim().toLowerCase());
    if (new Set(labels).size !== labels.length) throw new BadRequestException("Each place needs a different name.");
    await this.prisma.$transaction(async (tx) => {
      await tx.savedPlace.deleteMany({ where: { userId: request.user.sub } });
      if (body.places.length)
        await tx.savedPlace.createMany({
          data: body.places.map((p, i) => ({
            userId: request.user.sub,
            position: i + 1,
            label: p.label.trim(),
            description: p.description?.trim() || null,
            latitude: p.latitude ?? null,
            longitude: p.longitude ?? null,
          })),
        });
    });
    return this.list(request);
  }

  @Put("language")
  async language(@Req() request: { user: { sub: string } }, @Body() body: LanguageDto) {
    await this.prisma.user.update({ where: { id: request.user.sub }, data: { preferredLanguage: body.language } });
    return { language: body.language };
  }
}
