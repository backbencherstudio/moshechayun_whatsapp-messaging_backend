import { Injectable } from '@nestjs/common';
import { Client, LocalAuth, Message } from 'whatsapp-web.js';
import * as qrcode from 'qrcode';
import { PrismaService } from 'src/prisma/prisma.service';
import { Inject } from '@nestjs/common';
import { WhatsAppGateway } from './whatsapp.gateway';
import { replaceTemplateVariables, validateTemplateVariables } from './utils/template.utils';
import { MessageHandlerService } from './services/message-handler.service';
import { MessageType } from './dto/send-message.dto';

@Injectable()
export class WhatsAppService {
    private clients = new Map<string, Client>();

    constructor(
        private prisma: PrismaService,
        @Inject(WhatsAppGateway) private readonly gateway: WhatsAppGateway,
        private messageHandler: MessageHandlerService,
    ) {
        this.restoreActiveSessions();
        this.startPeriodicAutoSync();
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

            // Initialize client and wait for QR code
            await this.initializeClient(clientId);

            // Wait for QR code to be generated (max 30 seconds)
            let attempts = 0;
            const maxAttempts = 30; // 30 seconds

            while (attempts < maxAttempts) {
                const session = await this.prisma.whatsAppSession.findFirst({
                    where: { clientId, status: 'pending' },
                    orderBy: { created_at: 'desc' },
                });

                if (session && session.sessionData) {
                    try {
                        const sessionData = JSON.parse(session.sessionData);
                        if (sessionData.qrCode) {
                            return { success: true, message: 'QR code generated. Please scan to connect.' };
                        }
                    } catch (e) {
                        // Continue waiting if sessionData is invalid
                    }
                }

                // Wait 1 second before next attempt
                await new Promise(resolve => setTimeout(resolve, 1000));
                attempts++;
            }

            return { success: false, message: 'QR code generation timeout. Please try again.' };
        } catch (error) {
            return { success: false, message: error.message };
        }
    }

    /**
     * Get QR code for a client
     */
    async getQRCode(clientId: string) {
        try {
            // Get all sessions for this client to debug
            const allSessions = await this.prisma.whatsAppSession.findMany({
                where: { clientId },
                orderBy: { created_at: 'desc' },
            });

            console.log(`🔍 Found ${allSessions.length} sessions for client ${clientId}:`,
                allSessions.map(s => ({ id: s.id, status: s.status, createdAt: s.created_at })));

            if (allSessions.length === 0) {
                return { success: false, message: 'No WhatsApp session found. Please connect WhatsApp first.' };
            }

            // Get the most recent session
            const session = allSessions[0];

            if (session.status === 'active') {
                return { success: false, message: 'WhatsApp is already connected. No QR code needed.' };
            }

            if (session.status === 'disconnected') {
                return { success: false, message: 'WhatsApp is disconnected. Please connect again to get a new QR code.' };
            }

            if (session.status !== 'pending') {
                return { success: false, message: `WhatsApp session status is '${session.status}'. Please try connecting again.` };
            }

            if (!session.sessionData) {
                return { success: false, message: 'QR code is being generated. Please wait a moment and try again.' };
            }

            const sessionData = JSON.parse(session.sessionData);
            if (!sessionData.qrCode) {
                return { success: false, message: 'QR code is being generated. Please wait a moment and try again.' };
            }

            return { success: true, data: { qrCode: sessionData.qrCode } };
        } catch (error) {
            console.error(`❌ Error getting QR code for client ${clientId}:`, error);
            return { success: false, message: `Error retrieving QR code: ${error.message}` };
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
     * Check and reconnect client if needed
     */
    async checkAndReconnectClient(clientId: string) {
        const client = this.clients.get(clientId);

        if (!client) {
            console.log(`🔄 Client ${clientId} not found, initializing...`);
            await this.initializeClient(clientId);
            return { success: true, message: 'Client initialized' };
        }

        // Check if client is healthy
        if (!client.info || !client.pupPage) {
            console.log(`🔄 Client ${clientId} not ready, reconnecting...`);
            this.clients.delete(clientId);
            await this.initializeClient(clientId);
            return { success: true, message: 'Client reconnected' };
        }

        return { success: true, message: 'Client is healthy' };
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

        try {
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
            let sentMsg;
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

            // Handle outgoing message through message handler
            await this.messageHandler.handleOutgoingMessage(clientId, {
                phoneNumber,
                message,
                type: MessageType.TEXT
            }, sentMsg);

            // Clean up old messages to keep only the 20 most recent
            await this.cleanupOldMessages(clientId);

            // Log the message (as you already do)
            await this.prisma.log.create({
                data: {
                    clientId,
                    type: 'message_sent',
                    data: JSON.stringify({
                        phoneNumber: whatsappNumber,
                        originalNumber: phoneNumber,
                        message,
                        retryCount,
                        creditsUsed: requiredCredits,
                        remainingCredits: updatedUser.credits,
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
                    retryCount,
                    creditsUsed: requiredCredits,
                    remainingCredits: updatedUser.credits,
                },
            };
        } catch (error) {
            console.error('❌ Error sending message:', error);

            // Log the error for debugging
            await this.prisma.log.create({
                data: {
                    clientId,
                    type: 'message_error',
                    data: JSON.stringify({
                        phoneNumber,
                        error: error.message,
                        stack: error.stack,
                        timestamp: new Date().toISOString(),
                    }),
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

        // Auto-sync messages before sending to ensure we have the latest state
        await this.autoSyncMessages(clientId);

        const client = this.clients.get(clientId);
        if (!client) {
            return { success: false, message: 'WhatsApp not connected', data: [] };
        }

        // Check if client is ready
        if (!client.info || !client.pupPage) {
            return { success: false, message: 'WhatsApp client not ready. Please reconnect.', data: [] };
        }

        // Check client credits before sending bulk messages
        const user = await this.prisma.user.findUnique({
            where: { id: clientId },
            select: { id: true, credits: true, name: true, email: true }
        });

        if (!user) {
            return { success: false, message: 'Client not found', data: [] };
        }

        const requiredCredits = phoneNumbers.length; // 1 credit per message
        if ((user.credits ?? 0) < requiredCredits) {
            return {
                success: false,
                message: `Insufficient credits. You have ${user.credits ?? 0} credits, but ${requiredCredits} credits are required to send ${phoneNumbers.length} messages.`,
                data: []
            };
        }

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

        console.log(`📤 Sending bulk message to ${phoneNumbers.length} recipients`);

        let successfulMessages = 0;
        let failedMessages = 0;

        for (const phoneNumber of phoneNumbers) {
            try {
                const whatsappNumber = this.formatPhoneNumber(phoneNumber);

                // Validate the phone number format
                if (!whatsappNumber.includes('@c.us')) {
                    results.push({
                        phoneNumber,
                        success: false,
                        message: 'Invalid phone number format'
                    });
                    failedMessages++;
                    continue;
                }

                console.log(`📤 Sending message to ${whatsappNumber}`);

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
                let sentMsg;
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

                // Add a small delay between messages to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 500));

            } catch (error) {
                console.error(`❌ Error sending bulk message to ${phoneNumber}:`, error);

                // Log the error for debugging
                await this.prisma.log.create({
                    data: {
                        clientId,
                        type: 'bulk_message_error',
                        data: JSON.stringify({
                            phoneNumber,
                            error: error.message,
                            stack: error.stack,
                            timestamp: new Date().toISOString(),
                        }),
                    },
                });

                // Return specific error messages
                let errorMessage = 'Send failed';
                if (error.message.includes('getChat')) {
                    errorMessage = 'Failed to access chat. Please try reconnecting WhatsApp.';
                } else if (error.message.includes('not-authorized')) {
                    errorMessage = 'WhatsApp session expired. Please scan QR code again.';
                } else if (error.message.includes('not-found')) {
                    errorMessage = 'Phone number not found on WhatsApp.';
                } else {
                    errorMessage = `Send failed: ${error.message}`;
                }

                results.push({
                    phoneNumber,
                    success: false,
                    message: errorMessage
                });
                failedMessages++;
            }
        }

        // Clean up old messages after bulk sending
        await this.cleanupOldMessages(clientId);

        // Deduct credits only for successful messages
        if (successfulMessages > 0) {
            const updatedUser = await this.prisma.user.update({
                where: { id: clientId },
                data: { credits: { decrement: successfulMessages } },
                select: { id: true, credits: true, name: true, email: true }
            });

            // Log credit deduction
            await this.prisma.creditLog.create({
                data: {
                    clientId,
                    amount: successfulMessages,
                    type: 'DECREMENT',
                    description: `Credits deducted for sending ${successfulMessages} messages in bulk operation`,
                },
            });

            // Add credit information to results
            results.forEach(result => {
                if (result.success && result.data) {
                    result.data.creditsUsed = 1;
                    result.data.remainingCredits = updatedUser.credits;
                }
            });
        }

        // Calculate summary statistics
        const successful = results.filter(r => r.success).length;
        const failed = results.filter(r => !r.success).length;

        console.log(`📊 Bulk message summary: ${successful} successful, ${failed} failed`);

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
     * Disconnect WhatsApp for a client
     */
    async disconnectWhatsApp(clientId: string) {
        try {
            const client = this.clients.get(clientId);
            if (client) {
                await client.destroy();
                this.clients.delete(clientId);
            }

            // Update all sessions for this client to disconnected
            const whatsapp = await this.prisma.whatsAppSession.updateMany({
                where: { clientId },
                data: { status: 'disconnected' }
            });
            console.log(whatsapp)
            // Delete all messages for this client
            await this.prisma.message.deleteMany({
                where: { clientId },
            });

            console.log(`✅ WhatsApp disconnected for client ${clientId} and all sessions updated`);

            return { success: true, message: 'WhatsApp disconnected and all message history cleared.' };
        } catch (error) {
            console.error(`❌ Error disconnecting WhatsApp for client ${clientId}:`, error);
            return { success: false, message: error.message };
        }
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

                    // Log the cleanup
                    await this.prisma.log.create({
                        data: {
                            clientId,
                            type: 'message_cleanup',
                            data: JSON.stringify({
                                deletedCount: deletedCount.count,
                                timestamp: new Date().toISOString(),
                            }),
                        },
                    });
                }
            }
        } catch (error) {
            console.error('❌ Error cleaning up old messages:', error);
        }
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
            // Auto-sync messages before getting conversations to ensure we have the latest data
            await this.autoSyncMessages(clientId);

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

            // Sort by last activity (most recent first) - WhatsApp-like ordering
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
                    },
                }),
                this.prisma.message.count({
                    where: { clientId, OR: orCondition },
                }),
            ]);

            // Return messages in chronological order (oldest to newest) for display
            // This mimics WhatsApp Web behavior where messages are displayed chronologically
            // but the conversation list shows most recent first
            const chronologicalMessages = messages.reverse();

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
            // Auto-sync messages before getting inbox to ensure we have the latest data
            await this.autoSyncMessages(clientId);

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
                // Recent messages (last 10) - most recent first
                this.prisma.message.findMany({
                    where: { clientId },
                    orderBy: { timestamp: 'desc' }, // Most recent first
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
                    recentMessages, // Already in correct order (most recent first)
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
            // First check and reconnect client if needed
            const healthCheck = await this.checkAndReconnectClient(clientId);
            if (!healthCheck.success) {
                return { success: false, message: 'Failed to connect WhatsApp client' };
            }

            // Auto-sync messages before sending to ensure we have the latest state
            await this.autoSyncMessages(clientId);

            // Check client credits before processing template
            const user = await this.prisma.user.findUnique({
                where: { id: clientId },
                select: { id: true, credits: true, name: true, email: true }
            });

            if (!user) {
                return { success: false, message: 'Client not found' };
            }

            const requiredCredits = phoneNumbers.length; // 1 credit per message
            if ((user.credits ?? 0) < requiredCredits) {
                return {
                    success: false,
                    message: `Insufficient credits. You have ${user.credits ?? 0} credits, but ${requiredCredits} credits are required to send ${phoneNumbers.length} template messages.`
                };
            }

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

            console.log(`📤 Sending template message using template: ${template.name}`);
            console.log(`📝 Processed message: ${processedMessage.substring(0, 100)}...`);

            // Log template usage
            await this.prisma.log.create({
                data: {
                    clientId,
                    type: 'template_message_sent',
                    data: JSON.stringify({
                        templateId,
                        templateName: template.name,
                        phoneNumbers,
                        variables,
                        processedMessage: processedMessage.substring(0, 500), // Limit log size
                        recipientCount: phoneNumbers.length,
                        creditsRequired: requiredCredits,
                        availableCredits: user.credits,
                    }),
                },
            });

            // Send to single or multiple recipients
            if (phoneNumbers.length === 1) {
                const result = await this.sendMessage(clientId, phoneNumbers[0], processedMessage);

                // Add template information to the result if successful
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
            } else {
                const result = await this.sendBulkMessage(clientId, phoneNumbers, processedMessage);

                // Add template information to the result if successful
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
            }
        } catch (error) {
            console.error('❌ Error sending template message:', error);

            // Log the error for debugging
            await this.prisma.log.create({
                data: {
                    clientId,
                    type: 'template_message_error',
                    data: JSON.stringify({
                        templateId,
                        phoneNumbers,
                        variables,
                        error: error.message,
                        stack: error.stack,
                        timestamp: new Date().toISOString(),
                    }),
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
            await this.prisma.log.create({
                data: {
                    clientId,
                    type: 'message_sync',
                    data: JSON.stringify({
                        totalSynced,
                        totalSkipped,
                        timestamp: new Date().toISOString(),
                    }),
                },
            });

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
