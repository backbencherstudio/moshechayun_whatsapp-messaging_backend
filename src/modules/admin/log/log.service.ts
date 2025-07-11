import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetLogDto } from './dto/get-log.dto';

@Injectable()
export class LogService {
    constructor(private prisma: PrismaService) { }

    async findAll(query: GetLogDto) {
        const { clientId, type, page = 1, pageSize = 20 } = query;
        const where: any = {};
        if (clientId) where.clientId = clientId;
        if (type) where.type = type;

        const [rawData, total] = await Promise.all([
            this.prisma.log.findMany({
                where,
                orderBy: { created_at: 'desc' },
                skip: (page - 1) * pageSize,
                take: pageSize,
                select: {
                    id: true,
                    created_at: true,
                    clientId: true,
                    type: true,
                    data: true,
                },
            }),
            this.prisma.log.count({ where }),
        ]);

        const data = rawData.map(log => ({
            ...log,
            data: (() => {
                try {
                    return JSON.parse(log.data);
                } catch {
                    return log.data;
                }
            })(),
        }));

        return {
            success: true,
            data,
            pagination: {
                total,
                page,
                pageSize,
                totalPages: Math.ceil(total / pageSize),
            },
        };
    }
}
