import { Injectable } from '@nestjs/common';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { PrismaService } from '../../../prisma/prisma.service';
import { DateHelper } from '../../../common/helper/date.helper';
import { SojebStorage } from '../../../common/lib/Disk/SojebStorage';
import appConfig from '../../../config/app.config';
import { StringHelper } from '../../../common/helper/string.helper';
import { FileUrlHelper } from '../../../common/helper/file-url.helper';

@Injectable()
export class ContactService {
  constructor(private prisma: PrismaService) { }

  async create(createContactDto: CreateContactDto, file?: Express.Multer.File) {
    try {
      const data = {};

      // Handle file upload
      if (file) {
        const fileName = StringHelper.generateRandomFileName(file.originalname);
        await SojebStorage.put(appConfig().storageUrl.avatar + fileName, file.buffer);
        data['avatar'] = fileName;
      }

      // Map all possible fields from DTO to database fields
      if (createContactDto.first_name) {
        data['first_name'] = createContactDto.first_name;
      }
      if (createContactDto.last_name) {
        data['last_name'] = createContactDto.last_name;
      }
      if (createContactDto.name) {
        data['name'] = createContactDto.name;
      }
      if (createContactDto.email) {
        data['email'] = createContactDto.email;
      }
      if (createContactDto.phone_number) {
        data['phone_number'] = createContactDto.phone_number;
      }
      if (createContactDto.role) {
        data['role'] = createContactDto.role;
      }
      if (createContactDto.message) {
        data['message'] = createContactDto.message;
      }
      if (createContactDto.avatar && !file) {
        data['avatar'] = createContactDto.avatar;
      }
      if (createContactDto.status !== undefined) {
        data['status'] = createContactDto.status;
      }
      if (createContactDto.whatsappNumber) {
        data['whatsappNumber'] = createContactDto.whatsappNumber;
      }

      const contact = await this.prisma.contact.create({
        data: {
          ...data,
          clientId: createContactDto.clientId,
          updated_at: DateHelper.now(),
        },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          name: true,
          email: true,
          phone_number: true,
          message: true,
          avatar: true,
          status: true,
          whatsappNumber: true,
          created_at: true,
          updated_at: true,
          client: {
            select: {
              id: true,
              name: true,
              email: true,
            }
          }
        }
      });

      // Add avatar URL to the contact
      const contactWithAvatar = FileUrlHelper.addAvatarUrl(contact);

      return {
        success: true,
        data: contactWithAvatar,
        message: 'Contact created successfully',
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async findAll({ q = null, status = null, clientId = null }: { q?: string; status?: number; clientId?: string }) {
    try {
      const whereClause = {};

      // Add search query
      if (q) {
        whereClause['OR'] = [
          { first_name: { contains: q, mode: 'insensitive' } },
          { last_name: { contains: q, mode: 'insensitive' } },
          { name: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
          { phone_number: { contains: q, mode: 'insensitive' } },
          { whatsappNumber: { contains: q, mode: 'insensitive' } },
        ];
      }

      // Add status filter
      if (status !== null && status !== undefined) {
        whereClause['status'] = Number(status);
      }

      // Add client filter
      if (clientId) {
        whereClause['clientId'] = clientId;
      }

      const contacts = await this.prisma.contact.findMany({
        where: whereClause,
        select: {
          id: true,
          first_name: true,
          last_name: true,
          name: true,
          email: true,
          phone_number: true,
          role: true,
          avatar: true,
          status: true,
          created_at: true,
          client: {
            select: {
              id: true,
              name: true,
              email: true,
            }
          }
        },
        orderBy: {
          created_at: 'desc'
        }
      });

      // Add avatar URL to each contact
      const contactsWithAvatar = contacts.map(contact => FileUrlHelper.addAvatarUrl(contact));

      return {
        success: true,
        data: contactsWithAvatar,
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
          first_name: true,
          last_name: true,
          name: true,
          email: true,
          phone_number: true,
          role: true,
          avatar: true,
          status: true,
          created_at: true,
          client: {
            select: {
              id: true,
              name: true,
              email: true,
            }
          }
        },
      });

      if (!contact) {
        return {
          success: false,
          message: 'Contact not found',
        };
      }

      // Add avatar URL to the contact
      const contactWithAvatar = FileUrlHelper.addAvatarUrl(contact);

      return {
        success: true,
        data: contactWithAvatar,
      };
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  async update(id: string, updateContactDto: UpdateContactDto, file?: Express.Multer.File) {
    try {
      const data = {};

      // Handle file upload
      if (file) {
        const fileName = StringHelper.generateRandomFileName(file.originalname);
        await SojebStorage.put(appConfig().storageUrl.avatar + fileName, file.buffer);
        data['avatar'] = fileName;
      }

      // Map all possible fields from DTO to database fields
      if (updateContactDto.first_name !== undefined) {
        data['first_name'] = updateContactDto.first_name;
      }
      if (updateContactDto.last_name !== undefined) {
        data['last_name'] = updateContactDto.last_name;
      }
      if (updateContactDto.name !== undefined) {
        data['name'] = updateContactDto.name;
      }
      if (updateContactDto.email !== undefined) {
        data['email'] = updateContactDto.email;
      }
      if (updateContactDto.phone_number !== undefined) {
        data['phone_number'] = updateContactDto.phone_number;
      }
      if (updateContactDto.role !== undefined) {
        data['role'] = updateContactDto.role;
      }
      if (updateContactDto.message !== undefined) {
        data['message'] = updateContactDto.message;
      }
      if (updateContactDto.avatar !== undefined && !file) {
        data['avatar'] = updateContactDto.avatar;
      }
      if (updateContactDto.status !== undefined) {
        data['status'] = updateContactDto.status;
      }
      if (updateContactDto.whatsappNumber !== undefined) {
        data['whatsappNumber'] = updateContactDto.whatsappNumber;
      }

      const contact = await this.prisma.contact.update({
        where: { id },
        data: {
          ...data,
          updated_at: DateHelper.now(),
        },
        select: {
          id: true,
          first_name: true,
          last_name: true,
          name: true,
          email: true,
          phone_number: true,
          message: true,
          avatar: true,
          status: true,
          whatsappNumber: true,
          created_at: true,
          updated_at: true,
        }
      });

      // Add avatar URL to the contact
      const contactWithAvatar = FileUrlHelper.addAvatarUrl(contact);

      return {
        success: true,
        data: contactWithAvatar,
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
      // Fetch the contact first to get the avatar filename
      const contact = await this.prisma.contact.findUnique({ where: { id } });
      if (!contact) {
        return {
          success: false,
          message: 'Contact not found',
        };
      }

      // Delete avatar file if it exists
      if (contact.avatar) {
        await SojebStorage.delete(appConfig().storageUrl.avatar + contact.avatar);
      }

      // Delete the contact from the database
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
