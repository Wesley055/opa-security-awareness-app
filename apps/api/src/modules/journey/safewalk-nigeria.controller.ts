import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Type } from "class-transformer";
import { IsLatitude, IsLongitude, IsNumber, IsOptional, IsString, Length, Max, Min } from "class-validator";
import type { Request } from "express";
import type { JwtPayload } from "../auth/jwt.strategy";
import { JwtAuthGuard } from "../auth/jwt-auth.guard";
import { SafeWalkContactsService } from "./safewalk-contacts.service";
import { SafeWalkPlacesService } from "./safewalk-places.service";
import { SafeWalkService } from "./safewalk.service";

class PlaceSearchQuery {
  @IsString() @Length(2, 80) q!: string;
  @IsOptional() @Type(() => Number) @IsLatitude() lat?: number;
  @IsOptional() @Type(() => Number) @IsLongitude() lng?: number;
}

class ArrivalDetectedDto {
  @IsNumber() @Min(-90) @Max(90) latitude!: number;
  @IsNumber() @Min(-180) @Max(180) longitude!: number;
  @IsOptional() @IsNumber() @Min(0) @Max(10_000) accuracy?: number;
}

type AuthRequest = Request & { user: JwtPayload };
const uuid = new ParseUUIDPipe({ version: "4" });

@Controller("safewalk")
@UseGuards(JwtAuthGuard)
export class SafeWalkNigeriaController {
  constructor(
    private readonly contacts: SafeWalkContactsService,
    private readonly places: SafeWalkPlacesService,
    private readonly safeWalk: SafeWalkService,
  ) {}

  @Get("places")
  searchPlaces(@Req() req: AuthRequest, @Query() query: PlaceSearchQuery) {
    const near = query.lat !== undefined && query.lng !== undefined ? { latitude: query.lat, longitude: query.lng } : undefined;
    return this.places.search(req.user.sub, query.q, near);
  }

  @Get("contacts")
  listContacts(@Req() req: AuthRequest) {
    return this.contacts.list(req.user.sub);
  }

  @Post("contacts/:contactId/invite")
  invite(@Req() req: AuthRequest, @Param("contactId", uuid) contactId: string) {
    return this.contacts.invite(req.user.sub, contactId);
  }

  @Delete("contacts/:contactId")
  remove(@Req() req: AuthRequest, @Param("contactId", uuid) contactId: string) {
    return this.contacts.remove(req.user.sub, contactId);
  }

  /** The phone saw the person stay inside the destination area. Not a safety confirmation. */
  @Post("sessions/:sessionId/arrival-detected")
  arrivalDetected(@Req() req: AuthRequest, @Param("sessionId", uuid) sessionId: string, @Body() dto: ArrivalDetectedDto) {
    return this.safeWalk.arrivalDetected(req.user.sub, sessionId, dto);
  }
}
