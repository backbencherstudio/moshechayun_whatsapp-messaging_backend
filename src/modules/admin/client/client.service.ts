import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { SojebStorage } from 'src/common/lib/Disk/SojebStorage';
import appConfig from 'src/config/app.config';
import { StringHelper } from 'src/common/helper/string.helper';
import { UcodeRepository } from 'src/common/repository/ucode/ucode.repository';
import { FileUrlHelper } from 'src/common/helper/file-url.helper';

@Injectable()
export class ClientService {
  constructor(private readonly prisma: PrismaService) { }

  async create(createClientDto: CreateClientDto, file?: Express.Multer.File) {
    // Check if email already exists
    const existing = await this.prisma.user.findUnique({
      where: { email: createClientDto.email },
    });
    if (existing) {
      return { success: false, message: 'Email already exists' };
    }

    if (file) {
      const fileName = StringHelper.generateRandomFileName(file.originalname);
      await SojebStorage.put(appConfig().storageUrl.avatar + fileName, file.buffer);
      createClientDto.avatar = fileName as any; // add avatar to DTO if not present
    }

    const client = await this.prisma.user.create({
      data: {
        ...createClientDto,
        type: 'client', // or user_type: 'CLIENT'
      },
    });

    await UcodeRepository.createVerificationToken({
      userId: client.id,
      email: client.email,
    });

    return { success: true, data: client };
  }

  async findAll() {
    const clients = await this.prisma.user.findMany({
      where: { type: 'client' },
      select: {
        id: true,
        name: true,
        email: true,
        phone_number: true,
        website: true,
        created_at: true,
        status: true,
        avatar: true,
      },
    });

    // Add avatar URL to each client
    const clientsWithAvatar = clients.map(client => FileUrlHelper.addAvatarUrl(client));
    return { success: true, data: clientsWithAvatar };
  }

  async findOne(id: string) {
    const client = await this.prisma.user.findUnique({
      where: { id, type: 'client' },
      select: {
        id: true,
        name: true,
        email: true,
        phone_number: true,
        website: true,
        created_at: true,
        status: true,
        avatar: true,
      },
    });
    if (!client) return { success: false, message: 'Client not found' };

    // Add avatar URL to the client
    const clientWithAvatar = FileUrlHelper.addAvatarUrl(client);
    return { success: true, data: clientWithAvatar };
  }

  async update(id: string, updateClientDto: UpdateClientDto, file?: Express.Multer.File) {
    if (file) {
      const fileName = StringHelper.generateRandomFileName(file.originalname);
      await SojebStorage.put(appConfig().storageUrl.avatar + fileName, file.buffer);
      (updateClientDto as any).avatar = fileName;
    }
    const client = await this.prisma.user.update({
      where: { id },
      data: updateClientDto,
    });
    return { success: true, data: client };
  }

  async remove(id: string) {
    // Fetch the client first to get the avatar filename
    const client = await this.prisma.user.findUnique({ where: { id } });
    if (!client) return { success: false, message: 'Client not found' };

    // Delete avatar file if it exists
    if (client.avatar) {
      await SojebStorage.delete(appConfig().storageUrl.avatar + client.avatar);
    }

    // Delete the client from the database
    const deletedClient = await this.prisma.user.delete({ where: { id } });
    return { success: true, data: deletedClient };
  }
}
