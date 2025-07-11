import { Injectable } from '@nestjs/common';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { PrismaService } from '../../../prisma/prisma.service';
import { DateHelper } from '../../../common/helper/date.helper';

@Injectable()
export class ContactService {
  constructor(private prisma: PrismaService) { }

  async create(createContactDto: CreateContactDto) {
    try {
      const data = {};
      if (createContactDto.name) {
        data['name'] = createContactDto.name;
      }
      if (createContactDto.email) {
        data['email'] = createContactDto.email;
      }
      if (createContactDto.phone_number) {
        data['phone_number'] = createContactDto.phone_number;
      }
      if (createContactDto.message) {
        data['message'] = createContactDto.message;
      }

      await this.prisma.contact.create({
        data: {
          ...data,
          clientId: createContactDto.clientId || 'default', // Add clientId
          updated_at: DateHelper.now(),
        },
      });
      return {
        success: true,
        message: 'Contact created successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async findAll({ q = null, status = null }: { q?: string; status?: number }) {
    try {
      const whereClause = {};
      if (q) {
        whereClause['OR'] = [
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone_number: { contains: q, mode: 'insensitive' } },
        ];
      }
      if (status) {
        whereClause['status'] = Number(status);
      }

      const contacts = await this.prisma.contact.findMany({
        select: {
          id: true,
          name: true,
          email: true,
          phone_number: true,
          message: true,
        },
      });
      return {
        success: true,
        data: contacts,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async findOne(id: string) {
    try {
      const contact = await this.prisma.contact.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          email: true,
          phone_number: true,
          message: true,
        },
      });
      return {
        success: true,
        data: contact,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async update(id: string, updateContactDto: UpdateContactDto) {
    try {
      const data = {};
      if (updateContactDto.name) {
        data['name'] = updateContactDto.name;
      }
      if (updateContactDto.email) {
        data['email'] = updateContactDto.email;
      }
      if (updateContactDto.phone_number) {
        data['phone_number'] = updateContactDto.phone_number;
      }
      if (updateContactDto.message) {
        data['message'] = updateContactDto.message;
      }

      await this.prisma.contact.update({
        where: { id },
        data: {
          ...data,
          updated_at: DateHelper.now(),
        },
      });
      return {
        success: true,
        message: 'Contact updated successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async remove(id: string) {
    try {
      await this.prisma.contact.delete({
        where: { id },
      });
      return {
        success: true,
        message: 'Contact deleted successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }
}
