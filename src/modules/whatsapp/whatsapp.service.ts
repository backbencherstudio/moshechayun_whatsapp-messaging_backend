import { Injectable, Logger } from '@nestjs/common';
import { Client, LocalAuth, Message, MessageMedia } from 'whatsapp-web.js';
import * as qrcode from 'qrcode';
import { PrismaService } from 'src/prisma/prisma.service';
import { Inject } from '@nestjs/common';
import { WhatsAppGateway } from './whatsapp.gateway';
import { replaceTemplateVariables, validateTemplateVariables } from './utils/template.utils';
import { MessageHandlerService } from './services/message-handler.service';
import { MessageType } from './dto/send-message.dto';
import { SojebStorage } from 'src/common/lib/Disk/SojebStorage'; // adjust import as needed
import appConfig from 'src/config/app.config';
import { MessageStatus } from '@prisma/client';

@Injectable()
export class WhatsAppService {
    private readonly logger = new Logger(WhatsAppService.name);
    private clients = new Map<string, Client>();

    /**
     * Standard success response
     */
    private successResponse<T>(data: T, message?: string) {
        return { success: true, data, ...(message ? { message } : {}) };
    }

    /**
     * Standard error response
     */
    private errorResponse(error: any, message?: string) {
        this.logger.error(message || error?.message || error, error?.stack || error);
        return { success: false, message: message || error?.message || 'Unknown error' };
    }

    constructor(
        private prisma: PrismaService,
        @Inject(WhatsAppGateway) private readonly gateway: WhatsAppGateway,
        private messageHandler: MessageHandlerService,
    ) {
        this.restoreActiveSessions();
        this.startPeriodicAutoSync();
        MessageHandlerService.clients = this.clients;
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

        // Auto-sync messages for all restored sessions after a delay
        setTimeout(async () => {
            for (const session of activeSessions) {
                try {
                    console.log(`🔄 Auto-syncing messages for restored client ${session.clientId}...`);
                    await this.syncAllMessages(session.clientId);
                    console.log(`✅ Auto-sync completed for restored client ${session.clientId}`);
                } catch (syncError) {
                    console.error(`❌ Auto-sync failed for restored client ${session.clientId}:`, syncError);
                }
            }
        }, 10000); // Wait 10 seconds after restoration to ensure clients are fully ready
    }

    /**
     * Initialize a WhatsApp client with event handlers
     */
    private async initializeClient(clientId: string) {
        if (this.clients.has(clientId)) {
            console.log(`📱 WhatsApp client already exists for: ${clientId}`);
            return;
        }

        console.log(`📱 Initializing WhatsApp client for: ${clientId}`);

        const client = new Client({
            authStrategy: new LocalAuth({ clientId }),
            puppeteer: {
                headless: true,
                args: [
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--no-first-run',
                    '--no-zygote',
                    '--disable-gpu'
                ],
            },
        });

        this.setupEventHandlers(client, clientId);
        this.clients.set(clientId, client);

        try {
            await client.initialize();
            console.log(`✅ WhatsApp client initialized for ${clientId}`);

            // Update session status after successful initialization
            await this.updateSession(clientId, 'active');
        } catch (error) {
            console.error(`❌ Failed to initialize WhatsApp client for ${clientId}:`, error);

            // Remove the failed client from the map
            this.clients.delete(clientId);

            // Update session status to failed
            await this.updateSession(clientId, 'failed');

            // Log the error
            await this.prisma.log.create({
                data: {
                    clientId,
                    type: 'client_initialization_error',
                    data: JSON.stringify({
                        error: error.message,
                        stack: error.stack,
                        timestamp: new Date().toISOString(),
                    }),
                },
            });
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

            // Auto-sync messages when client is ready
            try {
                console.log(`🔄 Auto-syncing messages for client ${clientId}...`);
                await this.syncAllMessages(clientId);
                console.log(`✅ Auto-sync completed for client ${clientId}`);
            } catch (syncError) {
                console.error(`❌ Auto-sync failed for client ${clientId}:`, syncError);
            }
        });

        // Message handler
        client.on('message', async (message: Message) => {
            await this.messageHandler.handleIncomingMessage(clientId, message);
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

        // Listen for message acknowledgment events
        client.on('message_ack', async (msg, ack) => {
            let status: MessageStatus;
            switch (ack) {
                case 0: status = MessageStatus.PENDING; break;
                case 1: status = MessageStatus.SENT; break;
                case 2: status = MessageStatus.DELIVERED; break;
                case 3: status = MessageStatus.READ; break;
                case -1: status = MessageStatus.FAILED; break;
                default: status = MessageStatus.PENDING;
            }
            await this.updateMessageStatus(msg.id._serialized, status);
        });
    }

    /**
     * Get the active WhatsApp session for a client
     */
    private async getActiveSession(clientId: string) {
        return this.prisma.whatsAppSession.findFirst({
            where: { clientId, status: 'active' },
        });
    }

    /**
     * Get the WhatsApp number for a client from sessionData
     */
    private async getClientNumber(clientId: string): Promise<string | null> {
        const session = await this.getActiveSession(clientId);
        if (session?.sessionData) {
            try {
                const sessionData = JSON.parse(session.sessionData);
                return sessionData.meNumber || null;
            } catch {
                return null;
            }
        }
        return null;
    }

    /**
     * Update session status in database
     */
    private async updateSession(clientId: string, status: string, sessionData?: any) {
        try {
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
                    data: { clientId, ...updateData },
                });
            }
        } catch (error) {
            this.logger.error(`Failed to update session for client ${clientId}: ${error.message}`);
        }
    }

    /**
     * Emit status update to WebSocket clients
     */
    private emitStatusUpdate(clientId: string, status: string) {
        try {
            if (!this.gateway) {
                this.logger.warn(`⚠️ Gateway not available for client ${clientId}, skipping status update`);
                return;
            }
            this.gateway.sendMessageToClient(clientId, {
                type: 'whatsapp_status',
                status,
                clientId,
                timestamp: Date.now() / 1000,
            });
        } catch (error) {
            this.logger.error(`❌ Error emitting status update for client ${clientId}:`, error);
        }
    }

    /**
     * Connect WhatsApp for a client
     */
    async connectWhatsApp(clientId: string) {
        try {
            const existingSession = await this.getActiveSession(clientId);
            if (existingSession) {
                return this.errorResponse(null, 'WhatsApp already connected');
            }
            await this.initializeClient(clientId);

            // Wait for QR code to be generated (max 30 seconds)
            let attempts = 0;
            const maxAttempts = 30;
            while (attempts < maxAttempts) {
                try {
                    const session = await this.prisma.whatsAppSession.findFirst({
                        where: { clientId, status: 'pending' },
                        orderBy: { created_at: 'desc' },
                    });
                    if (session && session.sessionData) {
                        try {
                            const sessionData = JSON.parse(session.sessionData);
                            if (sessionData.qrCode) {
                                return this.successResponse({ qrCode: sessionData.qrCode }, 'QR code generated. Please scan to connect.');
                            }
                        } catch (parseError) {
                            this.logger.error('Error parsing sessionData for QR code:', parseError);
                        }
                    }
                } catch (dbError) {
                    this.logger.error('Database error while polling for QR code:', dbError);
                    return this.errorResponse(dbError, 'Database error while waiting for QR code.');
                }
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }
            // If QR code was not generated in time, return a timeout error
            return this.errorResponse(null, 'QR code generation timeout. Please try again.');
            // console.log(`🔄 QR code generation timeout for client ${clientId}, retrying...`);
            // return this.getQRCode(clientId);
        } catch (error) {
            this.logger.error('Unexpected error in connectWhatsApp:', error);
            return this.errorResponse(error, error.message || 'Unknown error occurred during WhatsApp connection.');
        }
    }
    /**
     * Get QR code for a client
     */
    async getQRCode(clientId: string) {
        try {
            const allSessions = await this.prisma.whatsAppSession.findMany({
                where: { clientId },
                orderBy: { created_at: 'desc' },
            });
            this.logger.log(`Found ${allSessions.length} sessions for client ${clientId}`);
            if (allSessions.length === 0) {
                return this.errorResponse(null, 'No WhatsApp session found. Please connect WhatsApp first.');
            }
            const session = allSessions[0];
            if (session.status === 'active') {
                return this.errorResponse(null, 'WhatsApp is already connected. No QR code needed.');
            }
            if (session.status === 'disconnected') {
                return this.errorResponse(null, 'WhatsApp is disconnected. Please connect again to get a new QR code.');
            }
            if (session.status !== 'pending') {
                return this.errorResponse(null, `WhatsApp session status is '${session.status}'. Please try connecting again.`);
            }
            if (!session.sessionData) {
                return this.errorResponse(null, 'QR code is being generated. Please wait a moment and try again.');
            }
            const sessionData = JSON.parse(session.sessionData);
            if (!sessionData.qrCode) {
                return this.errorResponse(null, 'QR code is being generated. Please wait a moment and try again.');
            }
            return this.successResponse({ qrCode: sessionData.qrCode });
        } catch (error) {
            return this.errorResponse(error, `Error retrieving QR code: ${error.message}`);
        }
    }

    async regenerateQRCode(clientId: string) {
        try {
            this.logger.log(`🔄 Regenerating QR code for client ${clientId}`);

            // Check if client exists and get current status
            const existingSession = await this.prisma.whatsAppSession.findFirst({
                where: { clientId },
                orderBy: { created_at: 'desc' },
            });

            if (!existingSession) {
                return this.errorResponse(null, 'No WhatsApp session found. Please connect WhatsApp first.');
            }

            // If client is currently active, disconnect it first
            if (existingSession.status === 'active') {
                this.logger.log(`📴 Disconnecting active client ${clientId} before regenerating QR code`);
                await this.disconnectWhatsApp(clientId);
            }

            // Remove existing client from memory if it exists
            if (this.clients.has(clientId)) {
                const client = this.clients.get(clientId);
                try {
                    await client.destroy();
                } catch (destroyError) {
                    this.logger.warn(`Warning: Could not destroy existing client: ${destroyError.message}`);
                }
                this.clients.delete(clientId);
            }

            // Update session status to pending
            await this.updateSession(clientId, 'pending', { qrCode: null });

            // Reinitialize the client to generate new QR code
            await this.initializeClient(clientId);

            // Wait a moment for QR code generation
            await new Promise(resolve => setTimeout(resolve, 2000));

            // Get the new QR code
            const newSession = await this.prisma.whatsAppSession.findFirst({
                where: { clientId },
                orderBy: { created_at: 'desc' },
            });

            if (!newSession || !newSession.sessionData) {
                return this.errorResponse(null, 'QR code generation in progress. Please wait a moment and try again.');
            }

            const sessionData = JSON.parse(newSession.sessionData);
            if (!sessionData.qrCode) {
                return this.errorResponse(null, 'QR code is being generated. Please wait a moment and try again.');
            }

            this.logger.log(`✅ QR code regenerated successfully for client ${clientId}`);
            return this.successResponse({
                qrCode: sessionData.qrCode,
                message: 'QR code regenerated successfully. Please scan the new QR code to connect WhatsApp.'
            });

        } catch (error) {
            this.logger.error(`❌ Error regenerating QR code for client ${clientId}:`, error);
            return this.errorResponse(error, `Error regenerating QR code: ${error.message}`);
        }
    }

    /**
     * Get connection status for a client
     */
    async getConnectionStatus(clientId: string): Promise<{ success: boolean; data: any; message?: string }> {
        const session = await this.prisma.whatsAppSession.findFirst({
            where: { clientId },
            orderBy: { created_at: 'desc' },
        });

        const client = this.clients.get(clientId);
        const isClientActive = client && client.info && client.pupPage;

        return {
            success: true,
            data: {
                status: session?.status || 'disconnected',
                connected: session?.status === 'active' && isClientActive,
                lastUpdated: session?.updated_at,
                clientExists: !!client,
                clientReady: isClientActive,
            },
        };
    }

    /**
    * Disconnect WhatsApp for a client
    */
    async disconnectWhatsApp(clientId: string) {
        try {
            const client = this.clients.get(clientId);
            if (client) {
                // Log out from WhatsApp (removes from Linked Devices)
                await client.logout();
                // Destroy the client instance
                await client.destroy();
                this.clients.delete(clientId);
            }
            await this.prisma.whatsAppSession.deleteMany({ where: { clientId } });
            await this.prisma.message.deleteMany({ where: { clientId } });
            this.logger.log(`WhatsApp disconnected for client ${clientId} and all sessions updated`);
            return this.successResponse('WhatsApp disconnected and all message history cleared.');
        } catch (error) {
            return this.errorResponse(error);
        }
    }

    /**
     * Check and reconnect client if needed
     */
    async checkAndReconnectClient(clientId: string) {
        try {
            const client = this.clients.get(clientId);
            if (!client) {
                this.logger.log(`Client ${clientId} not found, initializing...`);
                await this.initializeClient(clientId);
                return this.successResponse(null, 'Client initialized');
            }
            if (!client.info || !client.pupPage) {
                this.logger.log(`Client ${clientId} not ready, reconnecting...`);
                this.clients.delete(clientId);
                await this.initializeClient(clientId);
                return this.successResponse(null, 'Client reconnected');
            }
            return this.successResponse(null, 'Client is healthy');
        } catch (error) {
            return this.errorResponse(error);
        }
    }

    /**
     * Auto-sync messages for a client (called periodically)
     */
    async autoSyncMessages(clientId: string) {
        try {
            const client = this.clients.get(clientId);
            if (!client || !client.info) {
                console.log(`⚠️ Client ${clientId} not ready for auto-sync`);
                return;
            }

            // Check if we need to sync (e.g., if last sync was more than 5 minutes ago)
            const lastSyncLog = await this.prisma.log.findFirst({
                where: {
                    clientId,
                    type: 'message_sync',
                },
                orderBy: { created_at: 'desc' },
            });

            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            if (lastSyncLog && lastSyncLog.created_at > fiveMinutesAgo) {
                console.log(`⏭️ Auto-sync skipped for client ${clientId} - last sync was recent`);
                return;
            }

            console.log(`🔄 Auto-syncing messages for client ${clientId}...`);
            await this.syncAllMessages(clientId);
            console.log(`✅ Auto-sync completed for client ${clientId}`);
        } catch (error) {
            console.error(`❌ Auto-sync failed for client ${clientId}:`, error);
        }
    }

    /**
     * Start periodic auto-sync for all active clients
     */
    private startPeriodicAutoSync() {
        // Run auto-sync every 5 minutes
        setInterval(async () => {
            try {
                const activeSessions = await this.prisma.whatsAppSession.findMany({
                    where: { status: 'active' },
                });

                console.log(`🔄 Periodic auto-sync: checking ${activeSessions.length} active clients...`);

                for (const session of activeSessions) {
                    await this.autoSyncMessages(session.clientId);
                }

                console.log(`✅ Periodic auto-sync completed for ${activeSessions.length} clients`);
            } catch (error) {
                console.error('❌ Periodic auto-sync failed:', error);
            }
        }, 5 * 60 * 1000); // 5 minutes

        console.log('🔄 Periodic auto-sync started (every 5 minutes)');
    }

    /**
     * Send a message to a phone number
     */
    async sendMessage(clientId: string, phoneNumber: string, message: string) {
        let sentMsg;
        try {
            // First check and reconnect client if needed
            const healthCheck = await this.checkAndReconnectClient(clientId);
            if (!healthCheck.success) {
                return healthCheck;
            }

            // Auto-sync messages before sending to ensure we have the latest state
            await this.autoSyncMessages(clientId);

            const client = this.clients.get(clientId);
            if (!client) {
                return { success: false, message: 'WhatsApp not connected' };
            }

            // Check if client is ready
            if (!client.info || !client.pupPage) {
                return { success: false, message: 'WhatsApp client not ready. Please reconnect.' };
            }

            // Check client credits before sending
            const user = await this.prisma.user.findUnique({
                where: { id: clientId },
                select: { id: true, credits: true, name: true, email: true }
            });

            if (!user) {
                return { success: false, message: 'Client not found' };
            }

            const requiredCredits = 1; // 1 credit per message
            if ((user.credits ?? 0) < requiredCredits) {
                return {
                    success: false,
                    message: `Insufficient credits. You have ${user.credits ?? 0} credits, but ${requiredCredits} credit is required to send a message.`
                };
            }

            const whatsappNumber = this.formatPhoneNumber(phoneNumber);
            console.log(`📤 Sending message to ${whatsappNumber}`);

            // Validate the phone number format
            if (!whatsappNumber.includes('@c.us')) {
                return { success: false, message: 'Invalid phone number format' };
            }

            // Try to get or create chat before sending message
            let chat;
            try {
                chat = await client.getChatById(whatsappNumber);
            } catch (chatError) {
                console.log(`⚠️ Could not get existing chat for ${whatsappNumber}, will create new chat`);
                // If chat doesn't exist, we'll try to send message anyway
                // WhatsApp Web.js will create the chat automatically
            }

            // Send the message with retry logic
            let retryCount = 0;
            const maxRetries = 3;

            while (retryCount < maxRetries) {
                try {
                    sentMsg = await client.sendMessage(whatsappNumber, message);
                    break; // Success, exit retry loop
                } catch (sendError) {
                    retryCount++;
                    console.log(`⚠️ Send attempt ${retryCount} failed for ${whatsappNumber}:`, sendError.message);

                    if (retryCount >= maxRetries) {
                        throw sendError;
                    }

                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                }
            }

            // Deduct credits after successful sending
            const updatedUser = await this.prisma.user.update({
                where: { id: clientId },
                data: { credits: { decrement: requiredCredits } },
                select: { id: true, credits: true, name: true, email: true }
            });

            // Log credit deduction
            await this.prisma.creditLog.create({
                data: {
                    clientId,
                    amount: requiredCredits,
                    type: 'DECREMENT',
                    description: `Credit deducted for sending message to ${whatsappNumber}`,
                },
            });

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

            const contact = await this.prisma.contact.findFirst({
                where: {
                    phone_number: phoneNumber
                }
            })

            const contactId = contact.id || "unknown contact"

            // Handle outgoing message through message handler
            await this.messageHandler.handleOutgoingMessage(clientId, {
                contactId,
                message,
                type: MessageType.TEXT
            }, sentMsg);

            // Clean up old messages to keep only the 20 most recent
            await this.cleanupOldMessages(clientId);

            // Log the message (as you already do)
            await this.prisma.log.create({
                data: {
                    clientId,
                    type: 'message',
                    action: 'SEND_MESSAGE',
                    level: 'info',
                    status: 'SUCCESS',
                    entityId: sentMsg.id?._serialized,
                    data: JSON.stringify({
                        contactId,
                        phoneNumber: whatsappNumber,
                        message,
                        retryCount,
                        creditsUsed: requiredCredits,
                        media: false,
                    }),
                    extra: {
                        messageType: 'text',
                        direction: 'OUTBOUND',
                    },
                },
            });

            // Save message as PENDING before sending
            const existingMessage = await this.prisma.message.findFirst({
                where: { messageId: sentMsg?.id?._serialized }
            });
            if (!existingMessage) {
                await this.prisma.message.create({
                    data: {
                        clientId,
                        from: clientNumber,
                        to: whatsappNumber,
                        body: message,
                        type: MessageType.TEXT,
                        timestamp: new Date(),
                        messageId: sentMsg?.id?._serialized || undefined,
                        direction: 'OUTBOUND',
                        status: MessageStatus.PENDING,
                    },
                });
            }

            // On send success, update to SENT
            if (sentMsg?.id?._serialized) {
                await this.updateMessageStatus(sentMsg.id._serialized, MessageStatus.SENT);
            }

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
                    retryCount,
                    creditsUsed: requiredCredits,
                    remainingCredits: updatedUser.credits,
                },
            };
        } catch (error) {
            console.error('❌ Error sending message:', error);

            // On error, update to FAILED
            if (sentMsg && sentMsg.id && sentMsg.id._serialized) {
                await this.updateMessageStatus(sentMsg.id._serialized, MessageStatus.FAILED);
            }

            // Log the error for debugging
            await this.prisma.log.create({
                data: {
                    clientId,
                    type: 'message',
                    action: 'SEND_MESSAGE',
                    level: 'error',
                    status: 'FAIL',
                    entityId: phoneNumber,
                    error: error.message,
                    data: JSON.stringify({
                        phoneNumber,
                        stack: error.stack,
                        timestamp: new Date().toISOString(),
                        media: false,
                    }),
                    extra: {
                        messageType: 'text',
                        direction: 'OUTBOUND',
                    },
                },
            });

            // Return more specific error messages
            if (error.message.includes('getChat')) {
                return { success: false, message: 'Failed to access chat. Please try reconnecting WhatsApp.' };
            } else if (error.message.includes('not-authorized')) {
                return { success: false, message: 'WhatsApp session expired. Please scan QR code again.' };
            } else if (error.message.includes('not-found')) {
                return { success: false, message: 'Phone number not found on WhatsApp.' };
            } else {
                return { success: false, message: `Send failed: ${error.message}` };
            }
        }
    }

    /**
     * Send bulk messages to multiple phone numbers
     */
    async sendBulkMessage(clientId: string, phoneNumbers: string[], message: string) {
        // First check and reconnect client if needed
        const healthCheck = await this.checkAndReconnectClient(clientId);
        if (!healthCheck.success) {
            return { success: false, message: 'Failed to connect WhatsApp client', data: [] };
        }

        await this.autoSyncMessages(clientId);
        const client = this.clients.get(clientId);
        if (!client) {
            return { success: false, message: 'WhatsApp not connected', data: [] };
        }
        if (!client.info || !client.pupPage) {
            return { success: false, message: 'WhatsApp client not ready. Please reconnect.', data: [] };
        }
        const user = await this.prisma.user.findUnique({
            where: { id: clientId },
            select: { id: true, credits: true, name: true, email: true }
        });
        if (!user) {
            return { success: false, message: 'Client not found', data: [] };
        }
        const requiredCredits = phoneNumbers.length;
        if ((user.credits ?? 0) < requiredCredits) {
            return {
                success: false,
                message: `Insufficient credits. You have ${user.credits ?? 0} credits, but ${requiredCredits} credits are required to send ${phoneNumbers.length} messages.`,
                data: []
            };
        }
        const results = [];
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
        let successfulMessages = 0;
        let failedMessages = 0;
        for (const phoneNumber of phoneNumbers) {
            try {
                const whatsappNumber = this.formatPhoneNumber(phoneNumber);
                if (!whatsappNumber.includes('@c.us')) {
                    results.push({
                        phoneNumber,
                        success: false,
                        message: 'Invalid phone number format'
                    });
                    failedMessages++;
                    continue;
                }

                // Find contact if exists
                const contact = await this.prisma.contact.findFirst({
                    where: { phone_number: phoneNumber }
                });
                const contactId = contact?.id || "unknown contact";

                let chat;
                try {
                    chat = await client.getChatById(whatsappNumber);
                } catch (chatError) { }
                let sentMsg;
                let retryCount = 0;
                const maxRetries = 3;
                while (retryCount < maxRetries) {
                    try {
                        sentMsg = await client.sendMessage(whatsappNumber, message);
                        break;
                    } catch (sendError) {
                        retryCount++;
                        if (retryCount >= maxRetries) {
                            throw sendError;
                        }
                        await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                    }
                }
                await this.prisma.message.create({
                    data: {
                        clientId,
                        from: clientNumber,
                        to: whatsappNumber,
                        body: message,
                        type: sentMsg.type || 'chat',
                        timestamp: sentMsg.timestamp
                            ? new Date(sentMsg.timestamp * 1000)
                            : new Date(),
                        messageId: sentMsg.id?._serialized,
                        direction: 'OUTBOUND',
                    },
                });
                await this.prisma.log.create({
                    data: {
                        clientId,
                        type: 'message',
                        action: 'SEND_MESSAGE',
                        level: 'info',
                        status: 'SUCCESS',
                        entityId: sentMsg.id?._serialized,
                        data: JSON.stringify({
                            contactId,
                            phoneNumber: whatsappNumber,
                            message,
                            retryCount,
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
                        retryCount,
                    },
                });
                successfulMessages++;
                await new Promise(resolve => setTimeout(resolve, 500));
            } catch (error) {
                results.push({
                    phoneNumber,
                    success: false,
                    message: error.message
                });
                failedMessages++;
            }
        }
        await this.cleanupOldMessages(clientId);
        if (successfulMessages > 0) {
            const updatedUser = await this.prisma.user.update({
                where: { id: clientId },
                data: { credits: { decrement: successfulMessages } },
                select: { id: true, credits: true, name: true, email: true }
            });
            await this.prisma.creditLog.create({
                data: {
                    clientId,
                    amount: successfulMessages,
                    type: 'DECREMENT',
                    description: `Credits deducted for sending ${successfulMessages} messages in bulk operation`,
                },
            });
            results.forEach(result => {
                if (result.success && result.data) {
                    result.data.creditsUsed = 1;
                    result.data.remainingCredits = updatedUser.credits;
                }
            });
        }
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;
        return {
            success: true,
            data: {
                results,
                summary: {
                    total: phoneNumbers.length,
                    successful,
                    failed,
                    successRate: (successful / phoneNumbers.length) * 100,
                    creditsUsed: successfulMessages,
                    creditsRemaining: successfulMessages > 0 ? (await this.prisma.user.findUnique({
                        where: { id: clientId },
                        select: { credits: true }
                    }))?.credits : user.credits,
                }
            }
        };
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
     * Clean up old messages to keep only the 20 most recent per client
     */
    private async cleanupOldMessages(clientId: string) {
        try {
            // Get the 20th most recent message timestamp
            const twentiethMessage = await this.prisma.message.findFirst({
                where: { clientId },
                orderBy: { timestamp: 'desc' },
                skip: 19, // Skip first 19 to get the 20th
                select: { timestamp: true }
            });

            if (twentiethMessage) {
                // Delete all messages older than the 20th most recent
                const deletedCount = await this.prisma.message.deleteMany({
                    where: {
                        clientId,
                        timestamp: {
                            lt: twentiethMessage.timestamp
                        }
                    }
                });

                if (deletedCount.count > 0) {
                    console.log(`🧹 Cleaned up ${deletedCount.count} old messages for client ${clientId}`);

                    // // Log the cleanup
                    // await this.prisma.log.create({
                    //     data: {
                    //         clientId,
                    //         type: 'message_cleanup',
                    //         data: JSON.stringify({
                    //             deletedCount: deletedCount.count,
                    //             timestamp: new Date().toISOString(),
                    //         }),
                    //     },
                    // });
                }
            }
        } catch (error) {
            console.error('❌ Error cleaning up old messages:', error);
        }
    }

    /**
     * Update message status in the database
     */
    private async updateMessageStatus(messageId: string, status: MessageStatus) {
        // Get previous status for logging
        const message = await this.prisma.message.findUnique({ where: { messageId } });
        const previousStatus = message?.status;

        // Update the message status
        await this.prisma.message.updateMany({
            where: { messageId },
            data: { status },
        });

        // Log the status change
        // await this.prisma.log.create({
        //     data: {
        //         clientId: message?.clientId,
        //         type: 'message_status',
        //         action: 'STATUS_UPDATE',
        //         status,
        //         entityId: messageId,
        //         extra: {
        //             from: message?.from,
        //             to: message?.to,
        //             status,
        //             previousStatus,
        //             timestamp: new Date().toISOString(),
        //         },
        //     },
        // });
    }

    /**
     * Manually trigger cleanup for all clients
     */
    async cleanupAllClients() {
        try {
            const clients = await this.prisma.user.findMany({
                where: { type: 'client' },
                select: { id: true, name: true }
            });

            let totalDeleted = 0;
            const results = [];

            for (const client of clients) {
                try {
                    // Get the 20th most recent message timestamp
                    const twentiethMessage = await this.prisma.message.findFirst({
                        where: { clientId: client.id },
                        orderBy: { timestamp: 'desc' },
                        skip: 19,
                        select: { timestamp: true }
                    });

                    if (twentiethMessage) {
                        const deletedCount = await this.prisma.message.deleteMany({
                            where: {
                                clientId: client.id,
                                timestamp: {
                                    lt: twentiethMessage.timestamp
                                }
                            }
                        });

                        if (deletedCount.count > 0) {
                            totalDeleted += deletedCount.count;
                            results.push({
                                clientId: client.id,
                                clientName: client.name,
                                deletedCount: deletedCount.count
                            });

                            console.log(`🧹 Cleaned up ${deletedCount.count} old messages for client ${client.name}`);
                        }
                    }
                } catch (error) {
                    console.error(`❌ Error cleaning up messages for client ${client.id}:`, error);
                    results.push({
                        clientId: client.id,
                        clientName: client.name,
                        error: error.message
                    });
                }
            }

            return {
                success: true,
                data: {
                    totalDeleted,
                    results,
                    timestamp: new Date().toISOString(),
                }
            };
        } catch (error) {
            return {
                success: false,
                message: error.message,
            };
        }
    }

    /**
     * Get message statistics for a client
     */
    async getMessageStats(clientId: string) {
        try {
            const [totalMessages, recentMessages] = await Promise.all([
                this.prisma.message.count({
                    where: { clientId },
                }),
                this.prisma.message.findMany({
                    where: { clientId },
                    orderBy: { timestamp: 'desc' },
                    take: 20,
                    select: {
                        id: true,
                        timestamp: true,
                        direction: true,
                    },
                }),
            ]);

            return {
                success: true,
                data: {
                    totalMessages,
                    recentMessageCount: recentMessages.length,
                    messageLimit: 20,
                    oldestMessageInMemory: recentMessages.length > 0 ? recentMessages[recentMessages.length - 1].timestamp : null,
                    newestMessageInMemory: recentMessages.length > 0 ? recentMessages[0].timestamp : null,
                }
            };
        } catch (error) {
            return {
                success: false,
                message: error.message,
            };
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
            await this.autoSyncMessages(clientId);
            // Dynamically get the client's own WhatsApp number (jid)
            const clientNumber = await this.getClientNumber(clientId);
            // Ensure the number is in the correct format (jid)
            const clientJid = clientNumber && clientNumber.endsWith('@c.us') ? clientNumber : clientNumber + '@c.us';
            const conversations = await this.prisma.message.groupBy({
                by: ['from'],
                where: {
                    clientId,
                    from: {
                        not: null,
                        notIn: clientJid ? [clientJid] : [], // Exclude the client's own number if available
                    }
                },
                _count: { id: true },
                _max: { timestamp: true },
            });
            const conversationsWithLatestMessage = await Promise.all(
                conversations.map(async (conv) => {
                    const latestMessage = await this.prisma.message.findFirst({
                        where: {
                            clientId,
                            OR: [
                                { from: conv.from, to: clientJid },
                                { from: clientJid, to: conv.from }
                            ]
                        },
                        orderBy: { timestamp: 'desc' },
                        select: {
                            id: true,
                            body: true,
                            timestamp: true,
                            direction: true,
                            type: true,
                            attachment: {
                                select: {
                                    id: true,
                                    name: true,
                                    type: true,
                                    size: true,
                                    file: true, // This is the URL or path
                                }
                            }
                        },
                    });
                    // Extract phone number (remove '@c.us' if present)
                    const phoneNumber = conv.from?.replace(/@c\.us$/, '');
                    // Lookup user by phone_number

                    let user = null;
                    if (phoneNumber) {
                        user = await this.prisma.contact.findFirst({
                            where: { phone_number: phoneNumber },
                            select: { id: true, name: true, avatar: true },
                        });
                    }

                    return {
                        phoneNumber: conv.from,
                        messageCount: conv._count.id,
                        lastMessage: latestMessage
                            ? {
                                ...latestMessage,
                                preview: latestMessage.body ||
                                    (latestMessage.type === 'image' ? 'Photo' :
                                        latestMessage.type === 'video' ? 'Video' :
                                            latestMessage.type === 'audio' ? 'Audio' :
                                                latestMessage.type === 'document' ? 'Document' :
                                                    latestMessage.type === 'sticker' ? 'Sticker' : ''),
                            }
                            : null,
                        lastActivity: conv._max.timestamp,
                        userId: user?.id || null,
                        name: user?.name || null,
                        avatar: user?.avatar || null,
                    };
                })
            );
            conversationsWithLatestMessage.sort((a, b) => {
                if (!a.lastActivity && !b.lastActivity) return 0;
                if (!a.lastActivity) return 1;
                if (!b.lastActivity) return -1;
                return new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime();
            });
            return {
                success: true,
                data: conversationsWithLatestMessage,
            };
        } catch (error) {
            this.logger.error('❌ Error getting conversations:', error);
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

            // Auto-sync messages before getting conversation messages to ensure we have the latest data
            await this.autoSyncMessages(clientId);

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

            // Fetch messages in WhatsApp-like order (most recent first)
            const [messages, totalCount] = await Promise.all([
                this.prisma.message.findMany({
                    where: { clientId, OR: orCondition },
                    orderBy: { timestamp: 'desc' }, // Most recent first
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
                        attachment: {
                            select: {
                                id: true,
                                name: true,
                                type: true,
                                size: true,
                                file: true, // This is the URL or path
                            }
                        }
                    },
                }),
                this.prisma.message.count({
                    where: { clientId, OR: orCondition },
                }),
            ]);

            // Return messages in chronological order (oldest to newest) for display
            // This mimics WhatsApp Web behavior where messages are displayed chronologically
            // but the conversation list shows most recent first
            const chronologicalMessages = messages.reverse().map(msg => {
                if (msg.attachment && msg.attachment.file) {
                    return {
                        ...msg,
                        attachment: {
                            ...msg.attachment,
                            url: SojebStorage.url(appConfig().storageUrl.attachment + msg.attachment.file),
                        },
                    };
                }
                return msg;
            });

            return {
                success: true,
                data: {
                    messages: chronologicalMessages,
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
            await this.autoSyncMessages(clientId);
            const [
                totalMessages,
                totalConversations,
                unreadCount,
                recentMessages,
            ] = await Promise.all([
                this.prisma.message.count({
                    where: { clientId },
                }),
                this.prisma.message.groupBy({
                    by: ['from'],
                    where: { clientId },
                    _count: { id: true },
                }),
                this.prisma.message.count({
                    where: {
                        clientId,
                        body: { not: '' },
                        // type: 'chat', // REMOVE THIS LINE
                    },
                }),
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
                        attachment: {
                            select: {
                                id: true,
                                name: true,
                                type: true,
                                size: true,
                                file: true, // This is the URL or path
                            }
                        }
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
                    recentMessages: recentMessages.map(msg => {
                        if (msg.attachment && msg.attachment.file) {
                            return {
                                ...msg,
                                attachment: {
                                    ...msg.attachment,
                                    url: SojebStorage.url(appConfig().storageUrl.attachment + msg.attachment.file),
                                },
                            };
                        }
                        return msg;
                    }),
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
        contactIds: string[],
        templateId: string,
        variables: Record<string, string> = {}
    ) {
        try {
            const healthCheck = await this.checkAndReconnectClient(clientId);
            if (!healthCheck.success) {
                return { success: false, message: 'Failed to connect WhatsApp client' };
            }
            await this.autoSyncMessages(clientId);
            const user = await this.prisma.user.findUnique({
                where: { id: clientId },
                select: { id: true, credits: true, name: true, email: true }
            });
            if (!user) {
                return { success: false, message: 'Client not found' };
            }
            const requiredCredits = contactIds.length;
            if ((user.credits ?? 0) < requiredCredits) {
                return {
                    success: false,
                    message: `Insufficient credits. You have ${user.credits ?? 0} credits, but ${requiredCredits} credits are required to send ${contactIds.length} template messages.`
                };
            }
            const template = await this.prisma.template.findFirst({
                where: {
                    id: templateId
                },
            });
            if (!template) {
                return {
                    success: false,
                    message: 'Template not found',
                };
            }
            const validation = validateTemplateVariables(template.content, variables);
            if (!validation.isValid) {
                return {
                    success: false,
                    message: `Missing required variables: ${validation.missingVariables.join(', ')}`,
                };
            }
            const processedMessage = replaceTemplateVariables(template.content, variables);
            await this.prisma.log.create({
                data: {
                    clientId,
                    type: 'template_message_sent',
                    data: JSON.stringify({
                        templateId,
                        templateName: template.name,
                        contactIds,
                        variables,
                        processedMessage: processedMessage.substring(0, 500),
                        recipientCount: contactIds.length,
                        creditsRequired: requiredCredits,
                        availableCredits: user.credits,
                    }),
                },
            });
            const result = await this.sendBulkMessage(clientId, contactIds, processedMessage);
            if (result.success && 'data' in result) {
                (result as any).data = {
                    ...(result as any).data,
                    template: {
                        id: template.id,
                        name: template.name,
                        businessType: template.businessType,
                        category: template.category,
                    },
                    variables,
                    originalContent: template.content,
                    processedContent: processedMessage,
                };
            }
            return result;
        } catch (error) {
            await this.prisma.log.create({
                data: {
                    clientId,
                    type: 'template_message_error',
                    action: 'SEND_TEMPLATE_MESSAGE',
                    level: 'error',
                    status: 'FAIL',
                    entityId: templateId,
                    error: error.message,
                    data: JSON.stringify({
                        templateId,
                        contactIds,
                        variables,
                        stack: error.stack,
                        timestamp: new Date().toISOString(),
                    }),
                    extra: {
                        recipientCount: contactIds.length,
                        variables,
                    },
                },
            });
            return {
                success: false,
                message: `Template message failed: ${error.message}`,
            };
        }
    }

    /**
     * Get client credit information
     */
    async getClientCredits(clientId: string) {
        try {
            const user = await this.prisma.user.findUnique({
                where: { id: clientId },
                select: {
                    id: true,
                    credits: true,
                    name: true,
                    email: true
                }
            });

            if (!user) {
                return { success: false, message: 'Client not found' };
            }

            return {
                success: true,
                data: {
                    clientId: user.id,
                    name: user.name,
                    email: user.email,
                    credits: user.credits ?? 0,
                }
            };
        } catch (error) {
            return {
                success: false,
                message: error.message,
            };
        }
    }

    /**
     * Get client credit history
     */
    async getCreditHistory(clientId: string, limit: number = 50, offset: number = 0) {
        try {
            const [logs, totalCount] = await Promise.all([
                this.prisma.creditLog.findMany({
                    where: { clientId },
                    orderBy: { createdAt: 'desc' },
                    take: limit,
                    skip: offset,
                    select: {
                        id: true,
                        amount: true,
                        type: true,
                        description: true,
                        createdAt: true,
                    },
                }),
                this.prisma.creditLog.count({
                    where: { clientId },
                }),
            ]);

            return {
                success: true,
                data: {
                    logs,
                    pagination: {
                        total: totalCount,
                        limit,
                        offset,
                        hasMore: offset + limit < totalCount,
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

    /**
     * Send a file message to a phone number
     */
    async sendFileMessage(
        clientId: string,
        phoneNumber: string,
        file: Express.Multer.File,
        caption?: string
    ) {
        const whatsappNumber = this.formatPhoneNumber(phoneNumber);

        // 2. Check WhatsApp client/session
        const healthCheck = await this.checkAndReconnectClient(clientId);
        if (!healthCheck.success) return healthCheck;
        await this.autoSyncMessages(clientId);
        const client = this.clients.get(clientId);
        if (!client || !client.info || !client.pupPage) {
            return { success: false, message: 'WhatsApp client not ready. Please reconnect.' };
        }

        // 3. Credit check
        const user = await this.prisma.user.findUnique({ where: { id: clientId }, select: { credits: true } });
        const requiredCredits = 1;
        if ((user.credits ?? 0) < requiredCredits) {
            return { success: false, message: `Insufficient credits. You have ${user.credits ?? 0} credits, but ${requiredCredits} credit is required to send a file.` };
        }

        // 4. Send file (media) message with retry
        let sentMsg, retryCount = 0, maxRetries = 3;
        while (retryCount < maxRetries) {
            try {
                const base64 = file.buffer.toString('base64');
                const mediaMsg = new MessageMedia(file.mimetype, base64, file.originalname);
                sentMsg = await client.sendMessage(whatsappNumber, mediaMsg, { caption });
                break;
            } catch (err) {
                retryCount++;
                if (retryCount >= maxRetries) throw err;
                await new Promise(res => setTimeout(res, 1000 * retryCount));
            }
        }

        // 5. Deduct credits and log
        await this.prisma.user.update({
            where: { id: clientId },
            data: { credits: { decrement: requiredCredits } },
        });
        await this.prisma.creditLog.create({
            data: {
                clientId,
                amount: requiredCredits,
                type: 'DECREMENT',
                description: `Credit deducted for sending file to ${whatsappNumber}`,
            },
        });

        // Find contact if exists
        const contact = await this.prisma.contact.findFirst({
            where: { phone_number: phoneNumber }
        });
        const contactId = contact?.id || "unknown contact";

        // 6. Delegate message and attachment creation to the message handler
        const handlerResult = await this.messageHandler.handleOutgoingMessage({
            clientId,
            contactId,
            type: 'media',
            caption,
            media: file,
            sentMsg,
        });

        // 7. Log and return
        await this.prisma.log.create({
            data: {
                clientId,
                type: 'message',
                action: 'SEND_MESSAGE',
                level: 'info',
                status: 'SUCCESS',
                entityId: sentMsg.id?._serialized,
                data: JSON.stringify({
                    contactId,
                    phoneNumber: whatsappNumber,
                    retryCount,
                    creditsUsed: requiredCredits,
                    media: true,
                    attachmentId: handlerResult.attachmentId,
                    fileUrl: handlerResult.fileUrl,
                }),
                extra: {
                    messageType: 'media',
                    direction: 'OUTBOUND',
                },
            },
        });

        return {
            success: true,
            data: {
                id: sentMsg.id?._serialized,
                to: whatsappNumber,
                body: caption,
                timestamp: sentMsg.timestamp || Date.now(),
                type: sentMsg.type || 'media',
                direction: 'OUTBOUND',
                retryCount,
                creditsUsed: requiredCredits,
                handlerResult,
            },
        };
    }

    /**
     * Sync all messages from WhatsApp for a client
     */
    async syncAllMessages(clientId: string) {
        try {
            const client = this.clients.get(clientId);
            if (!client) {
                return { success: false, message: 'WhatsApp client not connected' };
            }

            console.log(`🔄 Starting message sync for client ${clientId}`);

            // Get all chats
            const chats = await client.getChats();
            let totalSynced = 0;
            let totalSkipped = 0;

            for (const chat of chats) {
                try {
                    console.log(`📱 Syncing messages for chat: ${chat.id._serialized}`);

                    // Get messages from this chat
                    const messages = await chat.fetchMessages({ limit: 50 });

                    for (const message of messages) {
                        try {
                            // Check if message already exists
                            const existingMessage = await this.prisma.message.findFirst({
                                where: {
                                    clientId,
                                    messageId: message.id._serialized,
                                },
                            });

                            if (existingMessage) {
                                totalSkipped++;
                                continue;
                            }

                            // Determine message direction
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

                            const direction = message.fromMe ? 'OUTBOUND' : 'INBOUND';

                            // Save message to database
                            await this.prisma.message.create({
                                data: {
                                    clientId,
                                    from: message.from,
                                    to: message.to || null,
                                    body: message.body,
                                    type: message.type || 'chat',
                                    timestamp: new Date(message.timestamp * 1000),
                                    messageId: message.id._serialized,
                                    direction,
                                    status: MessageStatus.PENDING,
                                },
                            });

                            totalSynced++;
                        } catch (messageError) {
                            console.error(`❌ Error syncing message ${message.id._serialized}:`, messageError);
                        }
                    }
                } catch (chatError) {
                    console.error(`❌ Error syncing chat ${chat.id._serialized}:`, chatError);
                }
            }

            // Clean up old messages after sync
            await this.cleanupOldMessages(clientId);

            // Log the sync operation
            // await this.prisma.log.create({
            //     data: {
            //         clientId,
            //         type: 'message_sync',
            //         data: JSON.stringify({
            //             totalSynced,
            //             totalSkipped,
            //             timestamp: new Date().toISOString(),
            //         }),
            //     },
            // });

            console.log(`✅ Message sync completed for client ${clientId}: ${totalSynced} synced, ${totalSkipped} skipped`);

            return {
                success: true,
                data: {
                    totalSynced,
                    totalSkipped,
                    timestamp: new Date().toISOString(),
                },
            };
        } catch (error) {
            console.error('❌ Error syncing messages:', error);
            return {
                success: false,
                message: error.message,
            };
        }
    }

    /**
     * Get all messages for a client (including both sent and received)
     */
    async getAllMessages(clientId: string, limit: number = 100, offset: number = 0) {
        try {
            const [messages, totalCount] = await Promise.all([
                this.prisma.message.findMany({
                    where: { clientId },
                    orderBy: { timestamp: 'desc' }, // Most recent first
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
                        attachment: {
                            select: {
                                id: true,
                                name: true,
                                type: true,
                                size: true,
                                file: true, // This is the URL or path
                            }
                        }
                    },
                }),
                this.prisma.message.count({
                    where: { clientId },
                }),
            ]);

            return {
                success: true,
                data: {
                    messages,
                    pagination: {
                        total: totalCount,
                        limit,
                        offset,
                        hasMore: offset + limit < totalCount,
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
