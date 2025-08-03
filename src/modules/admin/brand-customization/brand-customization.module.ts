import { Module } from '@nestjs/common';
import { BrandCustomizationService } from './brand-customization.service';
import { BrandCustomizationController } from './brand-customization.controller';
import { PrismaService } from 'src/prisma/prisma.service';

@Module({
  controllers: [BrandCustomizationController],
  providers: [BrandCustomizationService, PrismaService],
  exports: [BrandCustomizationService],
})
export class BrandCustomizationModule { }
