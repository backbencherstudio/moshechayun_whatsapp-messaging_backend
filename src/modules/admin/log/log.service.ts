import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { GetLogDto } from './dto/get-log.dto';

@Injectable()
export class LogService {
    constructor(private prisma: PrismaService) { }

    async findAll(query: GetLogDto) {
        try {
            const { clientId, type, page = 1, pageSize = 20, startDate, endDate, receiver, status } = query;
            const where: any = {};
            if (clientId) where.clientId = clientId;
            if (type) where.type = type;
            if (startDate || endDate) {
                where.created_at = {};
                if (startDate) where.created_at.gte = new Date(startDate);
                if (endDate) where.created_at.lte = new Date(endDate);
            }
            if (status) where.status = status;

            // Note: receiver filtering will be done after fetching data since data is JSON string

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

            // Parse and filter data
            let processedData = rawData.map(log => ({
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

            // Apply receiver filter after parsing JSON
            if (receiver) {
                const receiverJid = receiver.endsWith('@c.us') ? receiver : receiver + '@c.us';
                processedData = processedData.filter(log => {
                    // Check in data.phoneNumber, extra.phoneNumber, or extra.to fields
                    const logData = log.data || {};
                    const logExtra = log.extra || {};

                    return (
                        logData.phoneNumber === receiverJid ||
                        logExtra.phoneNumber === receiverJid ||
                        logExtra.to === receiverJid ||
                        logExtra.from === receiverJid
                    );
                });
            }

            return {
                success: true,
                data: processedData,
                pagination: {
                    total: processedData.length, // Use filtered count
                    page,
                    pageSize,
                    totalPages: Math.ceil(processedData.length / pageSize),
                },
            };
        } catch (error) {
            console.error('LogService.findAll error:', error);
            return {
                success: false,
                message: error.message || 'Internal server error',
                error: process.env.NODE_ENV === 'development' ? error.stack : undefined
            };
        }
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
