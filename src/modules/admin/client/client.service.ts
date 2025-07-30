import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { SojebStorage } from 'src/common/lib/Disk/SojebStorage';
import appConfig from 'src/config/app.config';
import { StringHelper } from 'src/common/helper/string.helper';
import { UcodeRepository } from 'src/common/repository/ucode/ucode.repository';
import { FileUrlHelper } from 'src/common/helper/file-url.helper';
import * as bcrypt from 'bcrypt';
import { SearchClientDto } from './dto/search-client.dto';



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

    const hashedPassword = await bcrypt.hash(createClientDto.password, appConfig().security.salt);
    const client = await this.prisma.user.create({
      data: {
        ...createClientDto,
        password: hashedPassword,
        type: 'client', // or user_type: 'CLIENT'
      },
    });

    await UcodeRepository.createVerificationToken({
      userId: client.id,
      email: client.email,
    });

    return { success: true, data: client };
  }

  async findAll(searchParams: SearchClientDto) {
    const { search, page = 1, limit = 10 } = searchParams;
    const offset = (page - 1) * limit;

    // Build where conditions
    const whereConditions: any = { type: 'client' };

    // Add search functionality
    if (search) {
      whereConditions.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone_number: { contains: search, mode: 'insensitive' } },
        { website: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [clients, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where: whereConditions,
        select: {
          id: true,
          name: true,
          email: true,
          phone_number: true,
          user_type: true,
          website: true,
          created_at: true,
          credits: true,
          status: true,
          avatar: true,
        },
        take: limit,
        skip: offset,
        orderBy: { created_at: 'desc' },
      }),
      this.prisma.user.count({ where: whereConditions })
    ]);
    const clientsWithAvatar = clients.map(client => FileUrlHelper.addAvatarUrl(client));
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;
    return {
      success: true,
      data: clientsWithAvatar,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage,
        hasPreviousPage,
      }
    };
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
        credits: true,
        user_type: true,
        status: true,
        avatar: true,
        contacts: {
          select: {
            id: true,
            name: true,
            email: true,
            phone_number: true,
            role: true,
            status: true,
            avatar: true,
          }
        }
      },
    });
    if (!client) return { success: false, message: 'Client not found' };

    // Add avatar URL to the client
    const clientWithAvatar = FileUrlHelper.addAvatarUrl(client);
    // Add avatarUrl to each contact
    if (clientWithAvatar.contacts && Array.isArray(clientWithAvatar.contacts)) {
      clientWithAvatar.contacts = clientWithAvatar.contacts.map(contact => FileUrlHelper.addAvatarUrl(contact));
    }
    return { success: true, data: clientWithAvatar };
  }

  async update(id: string, updateClientDto: UpdateClientDto, file?: Express.Multer.File) {
    if (file) {
      const fileName = StringHelper.generateRandomFileName(file.originalname);
      await SojebStorage.put(appConfig().storageUrl.avatar + fileName, file.buffer);
      (updateClientDto as any).avatar = fileName;
    }

    let data = { ...updateClientDto };
    console.log("updateClientDto", updateClientDto)
    if (updateClientDto.password) {
      data.password = await bcrypt.hash(updateClientDto.password, appConfig().security.salt);
    }

    const client = await this.prisma.user.update({
      where: { id },
      data,
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

  async incrementCredits(clientId: string, amount: number, description?: string) {
    const client = await this.prisma.user.update({
      where: { id: clientId },
      data: { credits: { increment: amount } },
      select: {
        id: true,
        name: true,
        email: true,
        credits: true,
        // add any other fields you want to return
      },
    });
    await this.prisma.creditLog.create({
      data: {
        clientId,
        amount,
        type: 'INCREMENT',
        description: description || `Credits increased by ${amount}`,
      },
    });
    return { success: true, data: client };
  }

  async decrementCredits(clientId: string, amount: number, description?: string) {
    // Fetch current credits
    const user = await this.prisma.user.findUnique({
      where: { id: clientId },
      select: { id: true, name: true, email: true, credits: true },
    });

    if (!user) {
      return { success: false, message: 'Client not found' };
    }

    if ((user.credits ?? 0) < amount) {
      return { success: false, message: 'Insufficient credits. Cannot decrement below 0.' };
    }

    const client = await this.prisma.user.update({
      where: { id: clientId },
      data: { credits: { decrement: amount } },
      select: {
        id: true,
        name: true,
        email: true,
        credits: true,
      },
    });

    await this.prisma.creditLog.create({
      data: {
        clientId,
        amount,
        type: 'DECREMENT',
        description: description || `Credits decreased by ${amount}`,
      },
    });

    return { success: true, data: client };
  }


  async getClientCreditHistory(startDate?: Date, endDate?: Date, type?: string, page: number = 1, limit: number = 20) {
    const offset = (page - 1) * limit;
    const [logs, total] = await this.prisma.$transaction([
      this.prisma.creditLog.findMany({
        where: {
          ...(type && { type }),
          ...(startDate && { createdAt: { gte: startDate } }),
          ...(endDate && { createdAt: { lte: endDate } }),
        },
        orderBy: { createdAt: 'desc' },
        include: {
          client: {
            select: {
              name: true,
              credits: true
            }
          }
        },
        take: limit,
        skip: offset,
      }),
      this.prisma.creditLog.count({
        where: {
          ...(type && { type }),
          ...(startDate && { createdAt: { gte: startDate } }),
          ...(endDate && { createdAt: { lte: endDate } }),
        },
      })
    ]);
    const totalPages = Math.ceil(total / limit);
    const hasNextPage = page < totalPages;
    const hasPreviousPage = page > 1;
    return {
      success: true,
      data: logs,
      pagination: {
        page,
        limit,
        total,
        totalPages,
        hasNextPage,
        hasPreviousPage,
      }
    };
  }

  async getMessageCredits(clientId: string) {
    // Get current credits and last updated
    const client = await this.prisma.user.findUnique({
      where: { id: clientId, type: 'client' },
      select: {
        credits: true,
        updated_at: true,
      },
    });
    if (!client) return { success: false, message: 'Client not found' };

    // Count messages sent this month
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const usedThisMonth = await this.prisma.message.count({
      where: {
        clientId,
        direction: 'OUTBOUND',
        created_at: { gte: startOfMonth },
      },
    });

    return {
      success: true,
      data: {
        credits: client.credits,
        lastUpdated: client.updated_at,
        usedThisMonth,
      },
    };
  }
}
