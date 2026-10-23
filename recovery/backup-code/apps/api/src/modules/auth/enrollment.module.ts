import { Module } from "@nestjs/common";
import { PrismaModule } from "../../prisma/prisma.module";
import { EnrollmentService } from "./enrollment.service";
@Module({
  imports: [PrismaModule],
  providers: [EnrollmentService],
  exports: [EnrollmentService],
})
export class EnrollmentModule {}
