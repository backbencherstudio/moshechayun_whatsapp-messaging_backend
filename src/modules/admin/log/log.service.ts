import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetLogDto } from './dto/get-log.dto';

@Injectable()
export class LogService {
    constructor(private prisma: PrismaService) { }

    async findAll(query: GetLogDto) {
        const { clientId, type, page = 1, pageSize = 20, startDate, endDate, receiver, status } = query;
        const where: any = {};
        if (clientId) where.clientId = clientId;
        if (type) where.type = type;
        if (startDate || endDate) {
            where.created_at = {};
            if (startDate) where.created_at.gte = new Date(startDate);
            if (endDate) where.created_at.lte = new Date(endDate);
        }
        if (receiver) {
            const receiverJid = receiver.endsWith('@c.us') ? receiver : receiver + '@c.us';
            where["data.phoneNumber"] = receiverJid;
        }
        if (status) where["status"] = status;

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
                    action: true,
                    level: true,
                    status: true,
                    entityId: true,
                    error: true,
                    requestId: true,
                    extra: true,
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
            extra: (() => {
                try {
                    return typeof log.extra === 'string' ? JSON.parse(log.extra) : log.extra;
                } catch {
                    return log.extra;
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

    async findOne(id: string) {
        const log = await this.prisma.log.findUnique({
            where: { id },
            select: {
                id: true,
                created_at: true,
                clientId: true,
                type: true,
                action: true,
                level: true,
                status: true,
                entityId: true,
                error: true,
                requestId: true,
                extra: true,
                data: true,
            },
        });
        if (!log) {
            return { success: false, message: 'Log not found' };
        }
        return {
            success: true,
            data: {
                ...log,
                data: (() => {
                    try {
                        return JSON.parse(log.data);
                    } catch {
                        return log.data;
                    }
                })(),
                extra: (() => {
                    try {
                        return typeof log.extra === 'string' ? JSON.parse(log.extra) : log.extra;
                    } catch {
                        return log.extra;
                    }
                })(),
            },
        };
    }
}
