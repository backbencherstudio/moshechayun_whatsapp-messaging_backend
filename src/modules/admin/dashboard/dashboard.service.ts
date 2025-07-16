import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MessageStatus } from '@prisma/client';

@Injectable()
export class DashboardService {
    constructor(private prisma: PrismaService) { }

    async getStats(clientId: string) {
        try {
            const client = await this.prisma.user.findUnique({
                where: { id: clientId }
            });

            if (!client) {
                return { success: false, message: 'Client not found' };
            }

            console.log(client)

            // Total contacts
            const totalContacts = await this.prisma.contact.count({ where: { clientId } });

            // Successful messages (e.g., status: 'SENT' or 'DELIVERED')
            const successfulMessages = await this.prisma.message.count({
                where: {
                    clientId,
                    status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED, MessageStatus.READ] },
                    direction: 'OUTBOUND',
                },
            });

            // Failed messages (e.g., status: 'FAILED')
            const failedMessages = await this.prisma.message.count({
                where: {
                    clientId,
                    status: MessageStatus.FAILED,
                    direction: 'OUTBOUND',
                },
            });

            // Pending messages (e.g., status: 'PENDING')
            const pendingMessages = await this.prisma.message.count({
                where: {
                    clientId,
                    status: MessageStatus.PENDING,
                    direction: 'OUTBOUND',
                },
            });

            // You can also add logic for % change, last week, etc.

            return {
                success: true,
                data: {
                    totalContacts,
                    successfulMessages,
                    failedMessages,
                    pendingMessages,
                    // Add more fields as needed
                },
            };
        } catch (error) {
            console.error('DashboardService.getStats error:', error);
            return { success: false, message: error.message || 'Internal server error' };
        }
    }

    async getGlobalStats() {
        try {
            const [totalContacts, totalMessages, totalClients, totalCredits] = await Promise.all([
                this.prisma.contact.count(),
                this.prisma.message.count(),
                this.prisma.user.count({ where: { type: 'client' } }),
                this.prisma.user.aggregate({
                    where: { type: 'client' },
                    _sum: { credits: true },
                })
            ]);
            return {
                success: true,
                data: {
                    totalContacts,
                    totalMessages,
                    totalClients,
                    totalCredits: totalCredits._sum.credits || 0,
                },
            };
        } catch (error) {
            console.error('DashboardService.getGlobalStats error:', error);
            return { success: false, message: error.message || 'Internal server error' };
        }
    }

    async getTopClients(limit = 10) {
        try {
            // Aggregate outbound message counts per client
            const topClients = await this.prisma.message.groupBy({
                by: ['clientId'],
                where: { direction: 'OUTBOUND' },
                _count: { clientId: true },
                orderBy: { _count: { clientId: 'desc' } },
                take: limit,
            });
            // Fetch client details
            const clientIds = topClients.map(tc => tc.clientId);
            const clients = await this.prisma.user.findMany({
                where: { id: { in: clientIds } },
                select: { id: true, name: true, email: true, credits: true },
            });
            // Merge counts with client info
            const result = topClients.map(tc => ({
                ...clients.find(c => c.id === tc.clientId),
                messageCount: tc._count.clientId,
            }));
            return { success: true, data: result };
        } catch (error) {
            console.error('DashboardService.getTopClients error:', error);
            return { success: false, message: error.message || 'Internal server error' };
        }
    }

    async getRecentErrors(limit = 20) {
        try {
            const errors = await this.prisma.log.findMany({
                where: { level: 'error' },
                orderBy: { created_at: 'desc' },
                take: limit,
                select: {
                    id: true,
                    clientId: true,
                    type: true,
                    action: true,
                    status: true,
                    error: true,
                    created_at: true,
                    data: true,
                },
            });
            return { success: true, data: errors };
        } catch (error) {
            console.error('DashboardService.getRecentErrors error:', error);
            return { success: false, message: error.message || 'Internal server error' };
        }
    }

    async getMessageTrends(clientId: string, days: number = 7) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days + 1);
            startDate.setHours(0, 0, 0, 0);

            // Group by day
            const messages = await this.prisma.message.findMany({
                where: {
                    clientId,
                    timestamp: { gte: startDate },
                },
                select: {
                    timestamp: true,
                    direction: true,
                    status: true,
                },
            });

            // Prepare daily buckets
            const trends: Record<string, { sent: number; received: number; failed: number }> = {};
            for (let i = 0; i < days; i++) {
                const d = new Date(startDate);
                d.setDate(d.getDate() + i);
                const key = d.toISOString().slice(0, 10);
                trends[key] = { sent: 0, received: 0, failed: 0 };
            }

            messages.forEach(msg => {
                const key = new Date(msg.timestamp).toISOString().slice(0, 10);
                if (!trends[key]) return;
                if (msg.direction === 'OUTBOUND') {
                    trends[key].sent++;
                    if (msg.status === 'FAILED') trends[key].failed++;
                } else if (msg.direction === 'INBOUND') {
                    trends[key].received++;
                }
            });

            return {
                success: true,
                data: Object.entries(trends).map(([date, counts]) => ({ date, ...counts })),
            };
        } catch (error) {
            console.error('DashboardService.getMessageTrends error:', error);
            return { success: false, message: error.message || 'Internal server error' };
        }
    }

    async getCreditHistory(clientId: string, days: number = 30) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days + 1);
            startDate.setHours(0, 0, 0, 0);

            const logs = await this.prisma.creditLog.findMany({
                where: {
                    clientId,
                    createdAt: { gte: startDate },
                },
                select: {
                    createdAt: true,
                    amount: true,
                    type: true,
                },
            });

            // Prepare daily buckets
            const history: Record<string, { used: number; added: number }> = {};
            for (let i = 0; i < days; i++) {
                const d = new Date(startDate);
                d.setDate(d.getDate() + i);
                const key = d.toISOString().slice(0, 10);
                history[key] = { used: 0, added: 0 };
            }

            logs.forEach(log => {
                const key = new Date(log.createdAt).toISOString().slice(0, 10);
                if (!history[key]) return;
                if (log.type === 'DECREMENT') {
                    history[key].used += Math.abs(log.amount);
                } else if (log.type === 'INCREMENT') {
                    history[key].added += Math.abs(log.amount);
                }
            });

            return {
                success: true,
                data: Object.entries(history).map(([date, values]) => ({ date, ...values })),
            };
        } catch (error) {
            console.error('DashboardService.getCreditHistory error:', error);
            return { success: false, message: error.message || 'Internal server error' };
        }
    }

    async getMessageStatusRatio(clientId: string) {
        try {
            const statuses = [
                MessageStatus.SENT,
                MessageStatus.DELIVERED,
                MessageStatus.READ,
                MessageStatus.FAILED,
                MessageStatus.PENDING
            ];
            const counts = await Promise.all(
                statuses.map(status =>
                    this.prisma.message.count({ where: { clientId, status } })
                )
            );
            const result: Record<string, number> = {};
            statuses.forEach((status, i) => {
                result[status] = counts[i];
            });
            return { success: true, data: result };
        } catch (error) {
            console.error('DashboardService.getMessageStatusRatio error:', error);
            return { success: false, message: error.message || 'Internal server error' };
        }
    }
}
