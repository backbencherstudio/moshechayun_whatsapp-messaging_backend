import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';

@Injectable()
export class TemplateService {
  constructor(private prisma: PrismaService) { }

  async create(dto: CreateTemplateDto) {
    try {
      const data = await this.prisma.template.create({
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

  async findAll(clientId: string) {
    try {
      const data = await this.prisma.template.findMany({
        where: { clientId },
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

