import { Injectable } from '@nestjs/common';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import * as qrcode from 'qrcode';
import { PrismaService } from 'src/prisma/prisma.service';

@Injectable()
export class WhatsAppService {
    private clients = new Map<string, Client>();

    constructor(private prisma: PrismaService) { }

    async connectWhatsApp(clientId: string) {
        try {
            // Check if already connected
            const existingSession = await this.prisma.whatsAppSession.findFirst({
                where: { clientId, status: 'active' },
            });

            if (existingSession) {
                return { success: false, message: 'WhatsApp already connected' };
            }

            // Create new client
            const client = new Client({
                authStrategy: new LocalAuth({ clientId }),
                puppeteer: {
                    headless: true,
                    args: ['--no-sandbox', '--disable-setuid-sandbox'],
                },
            });

            this.clients.set(clientId, client);

            // Handle QR code
            client.on('qr', async (qr) => {
                const qrCode = await qrcode.toDataURL(qr);

                const existingSession = await this.prisma.whatsAppSession.findFirst({
                    where: { clientId },
                });

                if (existingSession) {
                    await this.prisma.whatsAppSession.update({
                        where: { id: existingSession.id },
                        data: {
                            sessionData: JSON.stringify({ qr, qrCode }),
                            status: 'pending'
                        },
                    });
                } else {
                    await this.prisma.whatsAppSession.create({
                        data: {
                            clientId,
                            sessionData: JSON.stringify({ qr, qrCode }),
                            status: 'pending',
                        },
                    });
                }
            });

            // Handle ready event
            client.on('ready', async () => {
                await this.prisma.whatsAppSession.updateMany({
                    where: { clientId },
                    data: { status: 'active' },
                });
                console.log(`WhatsApp connected for client ${clientId}`);
            });

            // Handle messages
            client.on('message', async (message: Message) => {
                await this.handleIncomingMessage(clientId, message);
            });

            // Handle auth failure
            client.on('auth_failure', async () => {
                await this.prisma.whatsAppSession.updateMany({
                    where: { clientId },
                    data: { status: 'failed' },
                });
            });

            await client.initialize();

            return { success: true, message: 'QR code generated. Please scan to connect.' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    async getQRCode(clientId: string) {
        const session = await this.prisma.whatsAppSession.findFirst({
            where: { clientId },
            orderBy: { created_at: 'desc' },
        });

        if (!session || session.status !== 'pending') {
            return { success: false, message: 'No pending QR code found' };
        }

        const sessionData = JSON.parse(session.sessionData);
        return { success: true, data: { qrCode: sessionData.qrCode } };
    }

    async getConnectionStatus(clientId: string) {
        const session = await this.prisma.whatsAppSession.findFirst({
            where: { clientId },
            orderBy: { created_at: 'desc' },
        });

        return {
            success: true,
            data: {
                status: session?.status || 'disconnected',
                connected: session?.status === 'active',
                lastUpdated: session?.updated_at,
            },
        };
    }

    async sendMessage(clientId: string, phoneNumber: string, message: string) {
        const client = this.clients.get(clientId);
        if (!client) {
            return { success: false, message: 'WhatsApp not connected' };
        }

        try {
            const formattedNumber = phoneNumber.replace(/\D/g, '');
            const chatId = `${formattedNumber}@c.us`;

            const result = await client.sendMessage(chatId, message);

            // Log the message
            await this.prisma.log.create({
                data: {
                    clientId,
                    type: 'message_sent',
                    data: JSON.stringify({
                        phoneNumber,
                        message,
                        messageId: result.id._serialized,
                    }),
                },
            });

            return { success: true, data: result };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    async sendBulkMessage(clientId: string, phoneNumbers: string[], message: string) {
        const results = [];

        for (const phoneNumber of phoneNumbers) {
            const result = await this.sendMessage(clientId, phoneNumber, message);
            results.push({ phoneNumber, ...result });
        }

        return { success: true, data: results };
    }

    async disconnectWhatsApp(clientId: string) {
        const client = this.clients.get(clientId);
        if (client) {
            await client.destroy();
            this.clients.delete(clientId);
        }

        await this.prisma.whatsAppSession.updateMany({
            where: { clientId },
            data: { status: 'disconnected' },
        });

        return { success: true, message: 'WhatsApp disconnected' };
    }

    private async handleIncomingMessage(clientId: string, message: Message) {
        try {
            // Save incoming message to database
            await this.prisma.message.create({
                data: {
                    clientId,
                    message: message.body,
                    // Add other fields as needed
                },
            });

            // Log the incoming message
            await this.prisma.log.create({
                data: {
                    clientId,
                    type: 'message_received',
                    data: JSON.stringify({
                        from: message.from,
                        body: message.body,
                        timestamp: message.timestamp,
                    }),
                },
            });
        } catch (error) {
            console.error('Error handling incoming message:', error);
        }
    }
}
