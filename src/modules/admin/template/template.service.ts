import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Injectable()
export class TemplateService {
  constructor(private prisma: PrismaService) { }

  async create(dto: CreateTemplateDto, userId: string) {
    try {
      const data = await this.prisma.template.create({
        data: { ...dto, clientId: userId },
        select: {
          id: true,
          name: true,
          content: true,
          clientId: true,
          businessType: true,
          category: true,
          variables: true,
          created_at: true,
          updated_at: true,
        },
      });
      return { success: true, data };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async findAll(clientId: string, searchParams: any = {}) {
    try {
      const { search, category, businessType, page = 1, limit = 20 } = searchParams;
      const offset = (page - 1) * limit;

      // Build where conditions
      const whereConditions: any = { clientId };

      // Add search functionality
      if (search) {
        whereConditions.OR = [
          { name: { contains: search, mode: 'insensitive' } },
          { content: { contains: search, mode: 'insensitive' } },
          { category: { contains: search, mode: 'insensitive' } },
          { businessType: { contains: search, mode: 'insensitive' } },
        ];
      }

      // Add category filter
      if (category) {
        whereConditions.category = { contains: category, mode: 'insensitive' };
      }

      // Add business type filter
      if (businessType) {
        whereConditions.businessType = { contains: businessType, mode: 'insensitive' };
      }

      const [templates, total] = await this.prisma.$transaction([
        this.prisma.template.findMany({
          where: whereConditions,
          select: {
            id: true,
            name: true,
            content: true,
            clientId: true,
            businessType: true,
            category: true,
            variables: true,
            created_at: true,
            updated_at: true,
            client: {
              select: {
                id: true,
                name: true,
                email: true,
              },
            },
          },
          orderBy: { created_at: 'desc' },
          take: limit,
          skip: offset,
        }),
        this.prisma.template.count({ where: whereConditions })
      ]);

      const totalPages = Math.ceil(total / limit);
      const hasNextPage = page < totalPages;
      const hasPreviousPage = page > 1;

      return {
        success: true,
        data: templates,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNextPage,
          hasPreviousPage,
        }
      };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async findOne(id: string) {
    try {
      const data = await this.prisma.template.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          content: true,
          clientId: true,
          businessType: true,
          category: true,
          variables: true,
          created_at: true,
          updated_at: true,
          client: {
            select: {
              id: true,
              name: true,
              email: true,
            },
          },
        },
      });
      if (!data) return { success: false, message: 'Template not found' };
      return { success: true, data };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async update(id: string, dto: UpdateTemplateDto) {
    try {
      const data = await this.prisma.template.update({
        where: { id },
        data: dto,
        select: {
          id: true,
          name: true,
          content: true,
          clientId: true,
          businessType: true,
          category: true,
          variables: true,
          created_at: true,
          updated_at: true,
        },
      });
      return { success: true, data };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  async remove(id: string) {
    try {
      const data = await this.prisma.template.delete({
        where: { id },
        select: {
          id: true,
          name: true,
          content: true,
          clientId: true,
          businessType: true,
          category: true,
          variables: true,
          created_at: true,
          updated_at: true,
        },
      });
      return { success: true, data };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }
}

