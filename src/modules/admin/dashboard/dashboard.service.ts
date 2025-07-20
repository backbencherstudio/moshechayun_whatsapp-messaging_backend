import { Injectable } from '@nestjs/common';
import { PrismaService } from 'src/prisma/prisma.service';
import { MessageStatus } from '@prisma/client';

@Injectable()
export class DashboardService {
    constructor(private prisma: PrismaService) { }

    async getStats(clientId?: string) {
        try {
            const [
                totalContacts,
                successfulMessages,
                failedMessages,
                pendingMessages
            ] = await Promise.all([
                this.prisma.contact.count({
                    where: clientId ? { clientId } : {}
                }),
                this.prisma.message.count({
                    where: {
                        ...(clientId && { clientId }),
                        status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED, MessageStatus.READ] },
                        direction: 'OUTBOUND',
                    },
                }),
                this.prisma.message.count({
                    where: {
                        ...(clientId && { clientId }),
                        status: MessageStatus.FAILED,
                        direction: 'OUTBOUND',
                    },
                }),
                this.prisma.message.count({
                    where: {
                        ...(clientId && { clientId }),
                        status: MessageStatus.PENDING,
                        direction: 'OUTBOUND',
                    },
                }),
            ]);
            return {
                success: true,
                data: {
                    totalContacts,
                    successfulMessages,
                    failedMessages,
                    pendingMessages,
                    isGlobal: !clientId
                },
            };
        } catch (error) {
            console.error('DashboardService.getStats error:', error);
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

    async getMessageTrends(clientId?: string, days: number = 7) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days + 1);
            startDate.setHours(0, 0, 0, 0);

            // Group by day
            const messages = await this.prisma.message.findMany({
                where: {
                    ...(clientId && { clientId }),
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
                data: {
                    trends: Object.entries(trends).map(([date, counts]) => ({ date, ...counts })),
                    isGlobal: !clientId
                },
            };
        } catch (error) {
            console.error('DashboardService.getMessageTrends error:', error);
            return { success: false, message: error.message || 'Internal server error' };
        }
    }

    async getCreditHistory(clientId?: string, days: number = 30) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days + 1);
            startDate.setHours(0, 0, 0, 0);

            const logs = await this.prisma.creditLog.findMany({
                where: {
                    ...(clientId && { clientId }),
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
                data: {
                    history: Object.entries(history).map(([date, values]) => ({ date, ...values })),
                    isGlobal: !clientId
                },
            };
        } catch (error) {
            console.error('DashboardService.getCreditHistory error:', error);
            return { success: false, message: error.message || 'Internal server error' };
        }
    }

    async getMessageStatusRatio(clientId?: string) {
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
                    this.prisma.message.count({
                        where: {
                            ...(clientId && { clientId }),
                            status
                        }
                    })
                )
            );
            const result: Record<string, number> = {};
            statuses.forEach((status, i) => {
                result[status] = counts[i];
            });
            // Add cumulative counts
            result.SENT = result[MessageStatus.SENT] + result[MessageStatus.DELIVERED] + result[MessageStatus.READ];
            result.DELIVERED = result[MessageStatus.DELIVERED] + result[MessageStatus.READ];
            return {
                success: true,
                data: {
                    ...result,
                    isGlobal: !clientId
                }
            };
        } catch (error) {
            console.error('DashboardService.getMessageStatusRatio error:', error);
            return { success: false, message: error.message || 'Internal server error' };
        }
    }

    async getDashboardSummary(clientId?: string) {
        try {
            const [
                totalVisitors,
                pageViews,
                answeredChats,
                archivedChats
            ] = await Promise.all([
                // Total Visitors (unique contacts)
                this.prisma.contact.count({
                    where: clientId ? { clientId } : {}
                }),

                // Page Views (total messages received)
                this.prisma.message.count({
                    where: {
                        ...(clientId && { clientId }),
                        direction: 'INBOUND'
                    }
                }),

                // Answered Chats (messages with responses)
                this.prisma.message.count({
                    where: {
                        ...(clientId && { clientId }),
                        direction: 'OUTBOUND',
                        status: { in: [MessageStatus.SENT, MessageStatus.DELIVERED, MessageStatus.READ] }
                    }
                }),

                // Archived Chats (old conversations)
                this.prisma.message.count({
                    where: {
                        ...(clientId && { clientId }),
                        timestamp: {
                            lt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) // 30 days ago
                        }
                    }
                })
            ]);

            return {
                success: true,
                data: {
                    summary: {
                        totalVisitors: totalVisitors,
                        pageViews: pageViews,
                        chats: `${answeredChats} answered`,
                        archived: archivedChats
                    },
                    isGlobal: !clientId
                }
            };
        } catch (error) {
            console.error('DashboardService.getDashboardSummary error:', error);
            return { success: false, message: error.message || 'Internal server error' };
        }
    }

    async getDashboardChartData(clientId?: string, days: number = 12) {
        try {
            const startDate = new Date();
            startDate.setDate(startDate.getDate() - days + 1);
            startDate.setHours(0, 0, 0, 0);

            const messages = await this.prisma.message.findMany({
                where: {
                    ...(clientId && { clientId }),
                    timestamp: { gte: startDate },
                },
                select: {
                    timestamp: true,
                    direction: true,
                    status: true,
                },
            });

            // Prepare daily buckets with two segments (like the image)
            const chartData: Record<string, { inbound: number; outbound: number }> = {};
            for (let i = 0; i < days; i++) {
                const d = new Date(startDate);
                d.setDate(d.getDate() + i);
                const key = d.toISOString().slice(0, 10);
                chartData[key] = { inbound: 0, outbound: 0 };
            }

            messages.forEach(msg => {
                const key = new Date(msg.timestamp).toISOString().slice(0, 10);
                if (!chartData[key]) return;

                if (msg.direction === 'INBOUND') {
                    chartData[key].inbound++;
                } else if (msg.direction === 'OUTBOUND') {
                    chartData[key].outbound++;
                }
            });

            return {
                success: true,
                data: {
                    chartData: Object.entries(chartData).map(([date, counts]) => ({
                        date,
                        inbound: counts.inbound,
                        outbound: counts.outbound,
                        total: counts.inbound + counts.outbound
                    })),
                    isGlobal: !clientId
                }
            };
        } catch (error) {
            console.error('DashboardService.getDashboardChartData error:', error);
            return { success: false, message: error.message || 'Internal server error' };
        }
    }

    async getLiveVisitors(clientId?: string, timeRange: string = 'Live Now') {
        try {
            let startDate: Date;
            let endDate: Date = new Date();
            let interval: 'hour' | 'day' | 'week' | 'month' = 'hour';

            // Calculate date range based on timeRange
            switch (timeRange) {
                case 'Live Now':
                    startDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // Last 24 hours
                    interval = 'hour';
                    break;
                case 'This Week':
                    startDate = new Date();
                    startDate.setDate(startDate.getDate() - startDate.getDay()); // Start of current week (Sunday)
                    startDate.setHours(0, 0, 0, 0);
                    interval = 'day';
                    break;
                case 'Last Week':
                    startDate = new Date();
                    startDate.setDate(startDate.getDate() - startDate.getDay() - 7); // Start of last week
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(startDate);
                    endDate.setDate(endDate.getDate() + 6);
                    endDate.setHours(23, 59, 59, 999);
                    interval = 'day';
                    break;
                case 'This Month':
                    startDate = new Date();
                    startDate.setDate(1); // Start of current month
                    startDate.setHours(0, 0, 0, 0);
                    interval = 'day';
                    break;
                case 'Last Month':
                    startDate = new Date();
                    startDate.setMonth(startDate.getMonth() - 1);
                    startDate.setDate(1); // Start of last month
                    startDate.setHours(0, 0, 0, 0);
                    endDate = new Date(startDate);
                    endDate.setMonth(endDate.getMonth() + 1);
                    endDate.setDate(0); // Last day of last month
                    endDate.setHours(23, 59, 59, 999);
                    interval = 'day';
                    break;
                case 'Last 12 Months':
                    startDate = new Date();
                    startDate.setFullYear(startDate.getFullYear() - 1);
                    interval = 'month';
                    break;
                default:
                    startDate = new Date(Date.now() - 24 * 60 * 60 * 1000);
                    interval = 'hour';
            }

            // Get visitor data based on message activity
            const messages = await this.prisma.message.findMany({
                where: {
                    ...(clientId && { clientId }),
                    timestamp: {
                        gte: startDate,
                        lte: endDate
                    },
                    direction: 'INBOUND' // Only count inbound messages as "visitors"
                },
                select: {
                    timestamp: true,
                    from: true, // This represents the visitor
                },
                orderBy: { timestamp: 'asc' }
            });

            // Group visitors by time interval
            const visitorData = this.groupVisitorsByInterval(messages, startDate, endDate, interval);

            // Calculate current live visitors (active in last 5 minutes)
            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            const liveVisitors = await this.prisma.message.count({
                where: {
                    ...(clientId && { clientId }),
                    timestamp: { gte: fiveMinutesAgo },
                    direction: 'INBOUND'
                }
            });

            // Get unique visitors in last 5 minutes
            const uniqueLiveVisitors = await this.prisma.message.groupBy({
                by: ['from'],
                where: {
                    ...(clientId && { clientId }),
                    timestamp: { gte: fiveMinutesAgo },
                    direction: 'INBOUND'
                }
            });

            return {
                success: true,
                data: {
                    timeRange,
                    currentLiveVisitors: uniqueLiveVisitors.length,
                    chartData: visitorData,
                    totalVisitors: messages.length > 0 ? new Set(messages.map(m => m.from)).size : 0
                }
            };
        } catch (error) {
            console.error('DashboardService.getLiveVisitors error:', error);
            return { success: false, message: error.message || 'Internal server error' };
        }
    }

    private groupVisitorsByInterval(messages: any[], startDate: Date, endDate: Date, interval: 'hour' | 'day' | 'week' | 'month') {
        const data: { [key: string]: number } = {};

        // Initialize data points
        const current = new Date(startDate);
        while (current <= endDate) {
            let key: string;

            switch (interval) {
                case 'hour':
                    key = current.toISOString().slice(0, 13) + ':00:00.000Z';
                    current.setHours(current.getHours() + 1);
                    break;
                case 'day':
                    key = current.toISOString().slice(0, 10);
                    current.setDate(current.getDate() + 1);
                    break;
                case 'week':
                    key = current.toISOString().slice(0, 10);
                    current.setDate(current.getDate() + 7);
                    break;
                case 'month':
                    key = current.toISOString().slice(0, 7);
                    current.setMonth(current.getMonth() + 1);
                    break;
            }

            data[key] = 0;
        }

        // Count visitors for each interval
        messages.forEach(message => {
            let key: string;
            const messageDate = new Date(message.timestamp);

            switch (interval) {
                case 'hour':
                    key = messageDate.toISOString().slice(0, 13) + ':00:00.000Z';
                    break;
                case 'day':
                    key = messageDate.toISOString().slice(0, 10);
                    break;
                case 'week':
                    key = messageDate.toISOString().slice(0, 10);
                    break;
                case 'month':
                    key = messageDate.toISOString().slice(0, 7);
                    break;
            }

            if (data[key] !== undefined) {
                data[key]++;
            }
        });

        // Convert to array format for chart
        return Object.entries(data).map(([timestamp, count]) => ({
            timestamp,
            visitors: count
        }));
    }
}
