import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateBrandCustomizationDto } from './dto/create-brand-customization.dto';
import { UpdateBrandCustomizationDto } from './dto/update-brand-customization.dto';
import { SojebStorage } from 'src/common/lib/Disk/SojebStorage';
import { StringHelper } from 'src/common/helper/string.helper';
import appConfig from 'src/config/app.config';

@Injectable()
export class BrandCustomizationService {
  constructor(private readonly prisma: PrismaService) { }

  /**
   * Create a new brand customization (only one allowed)
   */
  async create(createBrandCustomizationDto: CreateBrandCustomizationDto, file?: Express.Multer.File) {
    try {
      // Check if brand customization already exists
      const existingBrand = await this.prisma.brandCustomization.findFirst({
        where: { deleted_at: null }
      });

      if (existingBrand) {
        throw new BadRequestException('Brand customization already exists. Only one is allowed.');
      }

      if (file) {
        const fileName = StringHelper.generateRandomFileName(file.originalname);
        await SojebStorage.put(appConfig().storageUrl.logo + fileName, file.buffer);
        createBrandCustomizationDto.logo = fileName as any;
      }

      const brandCustomization = await this.prisma.brandCustomization.create({
        data: {
          ...createBrandCustomizationDto,
        },
      });

      return brandCustomization;
    } catch (error) {
      throw error;
    }
  }

  /**
   * Find all brand customizations (admin only)
   */
  async findAll() {
    try {
      const brandCustomizations = await this.prisma.brandCustomization.findMany({
        where: { deleted_at: null },
        orderBy: { created_at: 'desc' }
      });

      if (brandCustomizations && brandCustomizations.length > 0) {
        for (const record of brandCustomizations) {
          // Add file URLs
          if (record.logo) {
            record['logo_url'] = SojebStorage.url(
              appConfig().storageUrl.logo + record.logo,
            );
          }
        }
      }

      return {success: true, data: brandCustomizations };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Find brand customization by ID
   */
  async findOne(id: string) {
    try {
      const brandCustomization = await this.prisma.brandCustomization.findFirst({
        where: { id, deleted_at: null },
      });

      if (!brandCustomization) {
        throw new NotFoundException(`Brand customization with ID ${id} not found`);
      }

      if (brandCustomization.logo) {
        brandCustomization['logo_url'] = SojebStorage.url(
          appConfig().storageUrl.logo + brandCustomization.logo,
        );
      }

      return {success: true, data: brandCustomization };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Update brand customization
   */
  async update(id: string, updateBrandCustomizationDto: UpdateBrandCustomizationDto, file?: Express.Multer.File) {
    try {
      // Check if brand customization exists
      const existingBrand = await this.prisma.brandCustomization.findFirst({
        where: { id, deleted_at: null }
      });

      if (!existingBrand) {
        throw new NotFoundException(`Brand customization with ID ${id} not found`);
      }

      // Handle file upload if provided
      if (file) {
        // Delete old logo file if exists
        if (existingBrand.logo) {
          await SojebStorage.delete(appConfig().storageUrl.logo + existingBrand.logo);
        }

        // Upload new logo
        const fileName = StringHelper.generateRandomFileName(file.originalname);
        await SojebStorage.put(appConfig().storageUrl.logo + fileName, file.buffer);
        updateBrandCustomizationDto.logo = fileName;
      }

      const updatedBrand = await this.prisma.brandCustomization.update({
        where: { id },
        data: updateBrandCustomizationDto,
      });

      if (updatedBrand.logo) {
        updatedBrand['logo_url'] = SojebStorage.url(
          appConfig().storageUrl.logo + updatedBrand.logo,
        );
      }

      return {success: true, data: updatedBrand };
    } catch (error) {
      throw error;
    }
  }

  /**
   * Remove brand customization (soft delete) with file cleanup
   */
  async remove(id: string) {
    try {
      // Check if brand customization exists
      const existingBrand = await this.prisma.brandCustomization.findFirst({
        where: { id, deleted_at: null }
      });

      if (!existingBrand) {
        throw new NotFoundException(`Brand customization with ID ${id} not found`);
      }

      // Delete logo file if exists
      if (existingBrand.logo) {
        await SojebStorage.delete(appConfig().storageUrl.logo + existingBrand.logo);
      }

      // Soft delete
      await this.prisma.brandCustomization.update({
        where: { id },
        data: { deleted_at: new Date() }
      });

      return { success: true, message: 'Brand customization deleted successfully' };
    } catch (error) {
      throw error;
    }
  }
}
