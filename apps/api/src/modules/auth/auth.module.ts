import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { PrismaModule } from '../../prisma/prisma.module';
import { UsersModule } from '../users/users.module';
import { ActivationService } from './activation.service';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';

@Module({
  // PrismaModule is new here. AuthService reaches the database only
  // through UsersService, but activation needs a transaction, an advisory
  // lock and a lookup by activationTokenHash - none of which belong
  // behind UsersService's finder methods.
  imports: [PrismaModule, UsersModule, PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, ActivationService, JwtStrategy],
  exports: [AuthService],
})
export class AuthModule {}
