import { Injectable } from '@nestjs/common';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import * as qrcode from 'qrcode';
import { PrismaService } from 'src/prisma/prisma.service';
import { Inject } from '@nestjs/common';
import { WhatsAppGateway } from './whatsapp.gateway';
import { replaceTemplateVariables, validateTemplateVariables } from './utils/template.utils';

@Injectable()
export class WhatsAppService {
    private clients = new Map<string, Client>();

    constructor(
        private prisma: PrismaService,
        @Inject(WhatsAppGateway) private readonly gateway: WhatsAppGateway,
    ) {
        this.restoreActiveSessions();
    }

    /**
     * Restore active WhatsApp sessions on startup
     */
    async restoreActiveSessions() {
        const activeSessions = await this.prisma.whatsAppSession.findMany({
            where: { status: 'active' },
        });

        console.log(`🔄 Restoring ${activeSessions.length} active WhatsApp sessions...`);

        for (const session of activeSessions) {
            await this.initializeClient(session.clientId);
        }

        console.log(`✅ Restored ${this.clients.size} WhatsApp sessions`);
    }

    /**
     * Initialize a WhatsApp client with event handlers
     */
    private async initializeClient(clientId: string) {
        if (this.clients.has(clientId)) {
            return;
        }

        console.log(`📱 Initializing WhatsApp client for: ${clientId}`);

        const client = new Client({
            authStrategy: new LocalAuth({ clientId }),
            puppeteer: {
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox'],
            },
        });

        this.setupEventHandlers(client, clientId);
        this.clients.set(clientId, client);

        try {
            await client.initialize();
            console.log(`✅ WhatsApp client initialized for ${clientId}`);
        } catch (error) {
            console.error(`❌ Failed to initialize WhatsApp client for ${clientId}:`, error);
        }
    }

    /**
     * Setup event handlers for WhatsApp client
     */
    private setupEventHandlers(client: Client, clientId: string) {
        // QR Code handler
        client.on('qr', async (qr) => {
            const qrCode = await qrcode.toDataURL(qr);
            await this.updateSession(clientId, 'pending', { qr, qrCode });
        });

        // Ready handler
        client.on('ready', async () => {
            // Get the WhatsApp number (jid)
            const meNumber = client.info?.wid?._serialized || null;
            // Store the WhatsApp number in sessionData
            await this.updateSession(clientId, 'active', { meNumber });
            console.log(`✅ WhatsApp connected for client ${clientId} as ${meNumber}`);
            this.emitStatusUpdate(clientId, 'connected');
        });

        // Message handler
        client.on('message', async (message: Message) => {
            await this.handleIncomingMessage(clientId, message);
        });

        // Auth failure handler
        client.on('auth_failure', async () => {
            await this.updateSession(clientId, 'failed');
            console.log(`❌ WhatsApp auth failed for client ${clientId}`);
            this.emitStatusUpdate(clientId, 'auth_failed');
        });

        // Disconnection handler
        client.on('disconnected', async () => {
            await this.updateSession(clientId, 'disconnected');
            console.log(`📴 WhatsApp disconnected for client ${clientId}`);
            this.emitStatusUpdate(clientId, 'disconnected');
        });
    }

    /**
     * Update session status in database
     */
    private async updateSession(clientId: string, status: string, sessionData?: any) {
        const existingSession = await this.prisma.whatsAppSession.findFirst({
            where: { clientId },
        });

        const updateData: any = { status };
        if (sessionData) {
            updateData.sessionData = JSON.stringify(sessionData);
        }

        if (existingSession) {
            await this.prisma.whatsAppSession.update({
                where: { id: existingSession.id },
                data: updateData,
            });
        } else {
            await this.prisma.whatsAppSession.create({
                data: {
                    clientId,
                    ...updateData,
                },
            });
        }
    }

    /**
     * Emit status update to WebSocket clients
     */
    private emitStatusUpdate(clientId: string, status: string) {
        this.gateway.sendMessageToClient(clientId, {
            type: 'whatsapp_status',
            status,
            clientId,
            timestamp: Date.now() / 1000,
        });
    }

    /**
     * Connect WhatsApp for a client
     */
    async connectWhatsApp(clientId: string) {
        try {
            const existingSession = await this.prisma.whatsAppSession.findFirst({
                where: { clientId, status: 'active' },
            });

            if (existingSession) {
                return { success: false, message: 'WhatsApp already connected' };
            }

            await this.initializeClient(clientId);
            return { success: true, message: 'QR code generated. Please scan to connect.' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Get QR code for a client
     */
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

    /**
     * Get connection status for a client
     */
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

    /**
     * Send a message to a phone number
     */
    async sendMessage(clientId: string, phoneNumber: string, message: string) {
        const client = this.clients.get(clientId);
        if (!client) {
            return { success: false, message: 'WhatsApp not connected' };
        }

        try {
            const whatsappNumber = this.formatPhoneNumber(phoneNumber);
            console.log(`📤 Sending message to ${whatsappNumber}`);

            const sentMsg = await client.sendMessage(whatsappNumber, message);

            // Fetch the client's WhatsApp number from the sessionData
            const session = await this.prisma.whatsAppSession.findFirst({
                where: { clientId, status: 'active' },
            });
            let clientNumber = null;
            if (session?.sessionData) {
                try {
                    const sessionData = JSON.parse(session.sessionData);
                    clientNumber = sessionData.meNumber || null;
                } catch (e) {
                    clientNumber = null;
                }
            }

            // Save the sent message to the Message model
            await this.prisma.message.create({
                data: {
                    clientId,
                    from: clientNumber, // your WhatsApp number
                    to: whatsappNumber, // recipient's WhatsApp number
                    body: message,
                    type: sentMsg.type || 'chat',
                    timestamp: sentMsg.timestamp
                        ? new Date(sentMsg.timestamp * 1000)
                        : new Date(),
                    messageId: sentMsg.id?._serialized,
                    direction: 'OUTBOUND', // distinguish as sent
                },
            });

            // Log the message (as you already do)
            await this.prisma.log.create({
                data: {
                    clientId,
                    type: 'message_sent',
                    data: JSON.stringify({
                        phoneNumber: whatsappNumber,
                        originalNumber: phoneNumber,
                        message,
                    }),
                },
            });

            // Return details about the sent message
            return {
                success: true,
                data: {
                    id: sentMsg.id?._serialized,
                    to: whatsappNumber,
                    from: clientNumber,
                    body: message,
                    timestamp: sentMsg.timestamp || Date.now(),
                    type: sentMsg.type || 'chat',
                    direction: 'OUTBOUND',
                },
            };
        } catch (error) {
            console.error('❌ Error sending message:', error);
            return { success: false, message: error.message };
        }
    }

    /**
     * Send bulk messages to multiple phone numbers
     */
    async sendBulkMessage(clientId: string, phoneNumbers: string[], message: string) {
        const results = [];

        // Fetch the client's WhatsApp number from the sessionData once
        const session = await this.prisma.whatsAppSession.findFirst({
            where: { clientId, status: 'active' },
        });
        let clientNumber = null;
        if (session?.sessionData) {
            try {
                const sessionData = JSON.parse(session.sessionData);
                clientNumber = sessionData.meNumber || null;
            } catch (e) {
                clientNumber = null;
            }
        }

        for (const phoneNumber of phoneNumbers) {
            const client = this.clients.get(clientId);
            if (!client) {
                results.push({ phoneNumber, success: false, message: 'WhatsApp not connected' });
                continue;
            }

            try {
                const whatsappNumber = this.formatPhoneNumber(phoneNumber);
                const sentMsg = await client.sendMessage(whatsappNumber, message);

                // Save the sent message to the Message model
                await this.prisma.message.create({
                    data: {
                        clientId,
                        from: clientNumber, // your WhatsApp number
                        to: whatsappNumber, // recipient's WhatsApp number
                        body: message,
                        type: sentMsg.type || 'chat',
                        timestamp: sentMsg.timestamp
                            ? new Date(sentMsg.timestamp * 1000)
                            : new Date(),
                        messageId: sentMsg.id?._serialized,
                        direction: 'OUTBOUND', // distinguish as sent
                    },
                });

                // Log the message
                await this.prisma.log.create({
                    data: {
                        clientId,
                        type: 'message_sent',
                        data: JSON.stringify({
                            phoneNumber: whatsappNumber,
                            originalNumber: phoneNumber,
                            message,
                        }),
                    },
                });

                results.push({
                    phoneNumber,
                    success: true,
                    data: {
                        id: sentMsg.id?._serialized,
                        to: whatsappNumber,
                        from: clientNumber,
                        body: message,
                        timestamp: sentMsg.timestamp || Date.now(),
                        type: sentMsg.type || 'chat',
                        direction: 'OUTBOUND',
                    },
                });
            } catch (error) {
                console.error('❌ Error sending bulk message:', error);
                results.push({ phoneNumber, success: false, message: error.message });
            }
        }

        return { success: true, data: results };
    }

    /**
     * Disconnect WhatsApp for a client
     */
    async disconnectWhatsApp(clientId: string) {
        const client = this.clients.get(clientId);
        if (client) {
            await client.destroy();
            this.clients.delete(clientId);
        }

        await this.updateSession(clientId, 'disconnected');
        return { success: true, message: 'WhatsApp disconnected' };
    }

    /**
     * Format phone number for WhatsApp Web.js
     */
    private formatPhoneNumber(phoneNumber: string): string {
        let formattedNumber = phoneNumber.replace(/\D/g, '');

        // Handle Bangladesh numbers
        if (!formattedNumber.startsWith('880') && !formattedNumber.startsWith('1') && !formattedNumber.startsWith('44')) {
            if (formattedNumber.length === 11 && formattedNumber.startsWith('01')) {
                formattedNumber = '880' + formattedNumber.substring(1);
            } else if (formattedNumber.length === 10 && formattedNumber.startsWith('1')) {
                formattedNumber = '880' + formattedNumber;
            } else {
                formattedNumber = '880' + formattedNumber;
            }
        }

        return formattedNumber + '@c.us';
    }

    /**
     * Handle incoming WhatsApp messages
     */
    private async handleIncomingMessage(clientId: string, message: Message) {
        try {
            console.log(`📨 Incoming WhatsApp message for client ${clientId}:`, {
                from: message.from,
                body: message.body,
                timestamp: message.timestamp,
                messageId: message.id._serialized,
            });

            // Save message to database
            await this.prisma.message.create({
                data: {
                    clientId,
                    from: message.from,
                    to: message.to || null,
                    body: message.body,
                    type: message.type,
                    timestamp: new Date(message.timestamp * 1000),
                    messageId: message.id._serialized,
                    direction: 'INBOUND', // (add this if you want to distinguish)
                },
            });

            // Log the message
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

            // Emit to WebSocket
            this.gateway.sendMessageToClient(clientId, {
                from: message.from,
                body: message.body,
                timestamp: message.timestamp,
                messageId: message.id._serialized,
            });

            console.log(`✅ Message processed and emitted for client ${clientId}`);
        } catch (error) {
            console.error('❌ Error handling incoming message:', error);
        }
    }

    /**
     * Get active sessions status
     */
    async getActiveSessionsStatus() {
        const activeSessions = await this.prisma.whatsAppSession.findMany({
            where: { status: 'active' },
        });

        return {
            success: true,
            data: {
                totalActiveSessions: activeSessions.length,
                connectedClients: this.clients.size,
                sessions: activeSessions.map(session => ({
                    clientId: session.clientId,
                    status: session.status,
                    isConnected: this.clients.has(session.clientId),
                    lastUpdated: session.updated_at,
                })),
            },
        };
    }

    /**
 * Get conversations/inbox for a client
 */
    async getConversations(clientId: string) {
        try {
            // Get all unique phone numbers that have messages (excluding null values)
            const conversations = await this.prisma.message.groupBy({
                by: ['from'],
                where: {
                    clientId,
                    from: { not: null } // Exclude null values
                },
                _count: {
                    id: true,
                },
                _max: {
                    timestamp: true,
                },
            });

            // Get the latest message for each conversation
            const conversationsWithLatestMessage = await Promise.all(
                conversations.map(async (conv) => {
                    const latestMessage = await this.prisma.message.findFirst({
                        where: {
                            clientId,
                            from: conv.from,
                        },
                        orderBy: { timestamp: 'desc' },
                        select: {
                            id: true,
                            body: true,
                            timestamp: true,
                            direction: true,
                            type: true,
                        },
                    });

                    return {
                        phoneNumber: conv.from,
                        messageCount: conv._count.id,
                        lastMessage: latestMessage,
                        lastActivity: conv._max.timestamp,
                    };
                })
            );

            // Sort by last activity (most recent first)
            conversationsWithLatestMessage.sort((a, b) =>
                new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
            );

            return {
                success: true,
                data: conversationsWithLatestMessage,
            };
        } catch (error) {
            console.error('❌ Error getting conversations:', error);
            return {
                success: false,
                message: error.message,
            };
        }
    }

    /**
 * Get messages for a specific conversation
 */
    async getConversationMessages(
        clientId: string,
        phoneNumber: string,
        limit: number = 50,
        offset: number = 0
    ): Promise<{ success: boolean; data?: any; message?: string }> {
        try {
            if (!phoneNumber) {
                return { success: false, message: 'Phone number is required' };
            }

            // Format phone/group JID
            let waJid = phoneNumber;
            if (!waJid.endsWith('@c.us') && !waJid.endsWith('@g.us')) {
                waJid = waJid + '@c.us';
            }
            const isGroup = waJid.endsWith('@g.us');

            // Get client number
            const session = await this.prisma.whatsAppSession.findFirst({
                where: { clientId, status: 'active' },
            });
            let clientNumber: string | null = null;
            if (session?.sessionData) {
                try {
                    const sessionData = JSON.parse(session.sessionData);
                    clientNumber = sessionData.meNumber || null;
                } catch {
                    clientNumber = null;
                }
            }

            // Build query
            const orCondition = isGroup
                ? [{ from: waJid }, { to: waJid }]
                : [
                    { from: clientNumber, to: waJid },
                    { from: waJid, to: clientNumber },
                ];

            // Fetch messages
            const [messages, totalCount] = await Promise.all([
                this.prisma.message.findMany({
                    where: { clientId, OR: orCondition },
                    orderBy: { timestamp: 'desc' },
                    take: limit,
                    skip: offset,
                    select: {
                        id: true,
                        body: true,
                        timestamp: true,
                        direction: true,
                        type: true,
                        messageId: true,
                        from: true,
                        to: true,
                    },
                }),
                this.prisma.message.count({
                    where: { clientId, OR: orCondition },
                }),
            ]);

            return {
                success: true,
                data: {
                    messages: messages.reverse(),
                    clientNumber,
                    pagination: {
                        total: totalCount,
                        limit,
                        offset,
                        hasMore: offset + limit < totalCount,
                    },
                },
            };
        } catch (error) {
            // Use a logger here in production
            return { success: false, message: error.message };
        }
    }

    /**
     * Get inbox summary for a client
     */
    async getInbox(clientId: string) {
        try {
            const [
                totalMessages,
                totalConversations,
                unreadCount,
                recentMessages,
            ] = await Promise.all([
                // Total messages
                this.prisma.message.count({
                    where: { clientId },
                }),
                // Total conversations
                this.prisma.message.groupBy({
                    by: ['from'],
                    where: { clientId },
                    _count: { id: true },
                }),
                // Unread messages (you can add a read field to track this)
                this.prisma.message.count({
                    where: {
                        clientId,
                        // Add read field when implemented
                        // read: false,
                    },
                }),
                // Recent messages (last 10)
                this.prisma.message.findMany({
                    where: { clientId },
                    orderBy: { timestamp: 'desc' },
                    take: 10,
                    select: {
                        id: true,
                        body: true,
                        timestamp: true,
                        from: true,
                        direction: true,
                        type: true,
                    },
                }),
            ]);

            return {
                success: true,
                data: {
                    summary: {
                        totalMessages,
                        totalConversations: totalConversations.length,
                        unreadCount,
                    },
                    recentMessages,
                },
            };
        } catch (error) {
            console.error('❌ Error getting inbox:', error);
            return {
                success: false,
                message: error.message,
            };
        }
    }

    /**
     * Get all templates for a client
     */
    async getTemplates(clientId: string) {
        try {
            const templates = await this.prisma.template.findMany({
                where: { clientId },
                select: {
                    id: true,
                    name: true,
                    content: true,
                    businessType: true,
                    category: true,
                    variables: true,
                    created_at: true,
                    updated_at: true,
                },
                orderBy: { created_at: 'desc' },
            });

            return {
                success: true,
                data: templates,
            };
        } catch (error) {
            return {
                success: false,
                message: error.message,
            };
        }
    }

    /**
     * Get a specific template by ID
     */
    async getTemplate(templateId: string, clientId: string) {
        try {
            const template = await this.prisma.template.findFirst({
                where: {
                    id: templateId,
                    clientId
                },
                select: {
                    id: true,
                    name: true,
                    content: true,
                    businessType: true,
                    category: true,
                    variables: true,
                    created_at: true,
                    updated_at: true,
                },
            });

            if (!template) {
                return {
                    success: false,
                    message: 'Template not found',
                };
            }

            return {
                success: true,
                data: template,
            };
        } catch (error) {
            return {
                success: false,
                message: error.message,
            };
        }
    }

    /**
     * Send a message using a template
     */
    async sendTemplateMessage(
        clientId: string,
        phoneNumbers: string[],
        templateId: string,
        variables: Record<string, string> = {}
    ) {
        try {
            // Get the template
            const template = await this.prisma.template.findFirst({
                where: {
                    id: templateId,
                    clientId
                },
            });

            if (!template) {
                return {
                    success: false,
                    message: 'Template not found',
                };
            }

            // Validate template variables
            const validation = validateTemplateVariables(template.content, variables);
            if (!validation.isValid) {
                return {
                    success: false,
                    message: `Missing required variables: ${validation.missingVariables.join(', ')}`,
                };
            }

            // Process template content
            const processedMessage = replaceTemplateVariables(template.content, variables);
            return {
                validation,
                processedMessage
            }
            // Send to single or multiple recipients
            if (phoneNumbers.length === 1) {
                return this.sendMessage(clientId, phoneNumbers[0], processedMessage);
            } else {
                return this.sendBulkMessage(clientId, phoneNumbers, processedMessage);
            }
        } catch (error) {
            return {
                success: false,
                message: error.message,
            };
        }
    }

    /**
     * Preview template with variables (without sending)
     */
    async previewTemplate(
        clientId: string,
        templateId: string,
        variables: Record<string, string> = {}
    ) {
        try {
            const template = await this.prisma.template.findFirst({
                where: {
                    id: templateId,
                    clientId
                },
            });

            if (!template) {
                return {
                    success: false,
                    message: 'Template not found',
                };
            }

            // Validate template variables
            const validation = validateTemplateVariables(template.content, variables);
            const processedMessage = replaceTemplateVariables(template.content, variables);

            return {
                success: true,
                data: {
                    originalContent: template.content,
                    processedContent: processedMessage,
                    variables: variables,
                    validation: validation,
                    template: {
                        id: template.id,
                        name: template.name,
                        businessType: template.businessType,
                        category: template.category,
                    },
                },
            };
        } catch (error) {
            return {
                success: false,
                message: error.message,
            };
        }
    }
}
