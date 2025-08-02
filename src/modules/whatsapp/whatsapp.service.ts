import { Injectable, Logger } from '@nestjs/common';
import { Client, LocalAuth, Message, MessageMedia } from 'whatsapp-web.js';
import * as qrcode from 'qrcode';
import { PrismaService } from 'src/prisma/prisma.service';
import { Inject } from '@nestjs/common';
import { WhatsAppGateway } from './whatsapp.gateway';
import { replaceTemplateVariables, validateTemplateVariables } from './utils/template.utils';
import { MessageHandlerService } from './services/message-handler.service';
import { MessageType } from './dto/send-message.dto';
import { SojebStorage } from 'src/common/lib/Disk/SojebStorage';
import appConfig from 'src/config/app.config';
import { MessageStatus } from '@prisma/client';
import { FileUrlHelper } from 'src/common/helper/file-url.helper';

@Injectable()
export class WhatsAppService {
    private readonly logger = new Logger(WhatsAppService.name);
    private clients = new Map<string, Client>();
    private qrCodeCache = new Map<string, { qrCode: string; timestamp: number }>();
    private initializationPromises = new Map<string, Promise<void>>();
    private readonly QR_CACHE_TTL = 30000; // 30 seconds
    private readonly INITIALIZATION_TIMEOUT = 15000; // 15 seconds instead of 30

    constructor(
        private prisma: PrismaService,
        @Inject(WhatsAppGateway) private readonly gateway: WhatsAppGateway,
        private messageHandler: MessageHandlerService,
    ) {
        this.restoreActiveSessions();
        this.startPeriodicAutoSync();
        this.startQRCodeCacheCleanup();
        MessageHandlerService.clients = this.clients;
    }

    /**
     * Standard response helpers
     */
    private successResponse<T>(data: T, message?: string) {
        return { success: true, data, ...(message ? { message } : {}) };
    }

    private errorResponse(error: any, message?: string) {
        this.logger.error(message || error?.message || error, error?.stack || error);
        return { success: false, message: message || error?.message || 'Unknown error' };
    }

    /**
     * Get cached QR code if still valid
     */
    private getCachedQRCode(clientId: string): string | null {
        const cached = this.qrCodeCache.get(clientId);
        if (cached && Date.now() - cached.timestamp < this.QR_CACHE_TTL) {
            return cached.qrCode;
        }
        this.qrCodeCache.delete(clientId);
        return null;
    }

    /**
     * Cache QR code with timestamp
     */
    private cacheQRCode(clientId: string, qrCode: string) {
        this.qrCodeCache.set(clientId, {
            qrCode,
            timestamp: Date.now()
        });
    }

    /**
     * Restore active WhatsApp sessions on startup
     */
    async restoreActiveSessions() {
        try {
            const activeSessions = await this.prisma.whatsAppSession.findMany({
                where: { status: 'active' },
            });

            this.logger.log(`Restoring ${activeSessions.length} active WhatsApp sessions`);

            // Initialize clients in parallel for faster restoration
            const initializationPromises = activeSessions.map(session =>
                this.initializeClient(session.clientId)
            );

            await Promise.allSettled(initializationPromises);

            this.logger.log(`Restored ${this.clients.size} WhatsApp sessions`);

            // Auto-sync messages after restoration
            setTimeout(async () => {
                const syncPromises = activeSessions.map(session =>
                    this.syncAllMessages(session.clientId).catch(error =>
                        this.logger.error(`Auto-sync failed for client ${session.clientId}:`, error)
                    )
                );
                await Promise.allSettled(syncPromises);
            }, 10000);
        } catch (error) {
            this.logger.error('Failed to restore active sessions:', error);
        }
    }

    /**
     * Initialize a WhatsApp client with event handlers
     */
    private async initializeClient(clientId: string) {
        if (this.clients.has(clientId)) {
            this.logger.log(`WhatsApp client already exists for: ${clientId}`);
            return;
        }

        // Check if initialization is already in progress
        if (this.initializationPromises.has(clientId)) {
            this.logger.log(`Initialization already in progress for: ${clientId}`);
            return this.initializationPromises.get(clientId);
        }

        const initPromise = this.performClientInitialization(clientId);
        this.initializationPromises.set(clientId, initPromise);

        try {
            await initPromise;
        } finally {
            this.initializationPromises.delete(clientId);
        }
    }

    /**
     * Perform the actual client initialization with optimized settings
     */
    private async performClientInitialization(clientId: string) {
        this.logger.log(`Initializing WhatsApp client for: ${clientId}`);

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
                    '--disable-gpu',
                    '--disable-web-security',
                    '--disable-features=VizDisplayCompositor',
                    '--disable-background-timer-throttling',
                    '--disable-backgrounding-occluded-windows',
                    '--disable-renderer-backgrounding',
                    '--disable-field-trial-config',
                    '--disable-ipc-flooding-protection',
                    '--memory-pressure-off',
                    '--max_old_space_size=4096'
                ],
                timeout: this.INITIALIZATION_TIMEOUT,
            },
        });

        this.setupEventHandlers(client, clientId);
        this.clients.set(clientId, client);

        try {
            // Set a timeout for initialization
            const initPromise = client.initialize();
            const timeoutPromise = new Promise((_, reject) =>
                setTimeout(() => reject(new Error('Initialization timeout')), this.INITIALIZATION_TIMEOUT)
            );

            await Promise.race([initPromise, timeoutPromise]);
            this.logger.log(`WhatsApp client initialized for ${clientId}`);
            await this.updateSession(clientId, 'active');
        } catch (error) {
            this.logger.error(`Failed to initialize WhatsApp client for ${clientId}:`, error);
            this.clients.delete(clientId);
            await this.updateSession(clientId, 'failed');
            await this.logError(clientId, 'client_initialization_error', error);
            throw error;
        }
    }

    /**
     * Setup event handlers for WhatsApp client
     */
    private setupEventHandlers(client: Client, clientId: string) {
        client.on('qr', async (qr) => {
            try {
                // Generate QR code with optimized settings
                const qrCode = await qrcode.toDataURL(qr, {
                    errorCorrectionLevel: 'M',
                    type: 'image/png',
                    margin: 1,
                    width: 256
                });

                // Cache the QR code
                this.cacheQRCode(clientId, qrCode);

                // Update session with both raw QR and data URL
                await this.updateSession(clientId, 'pending', { qr, qrCode });

                // Emit real-time QR code via WebSocket
                this.emitQRCodeUpdate(clientId, qrCode);

                this.logger.log(`QR code generated for client ${clientId}`);
            } catch (error) {
                this.logger.error(`Error generating QR code for client ${clientId}:`, error);
            }
        });

        client.on('ready', async () => {
            const meNumber = client.info?.wid?._serialized || null;
            await this.updateSession(clientId, 'active', { meNumber });
            this.logger.log(`WhatsApp connected for client ${clientId} as ${meNumber}`);
            this.emitStatusUpdate(clientId, 'connected');

            // Clear QR code cache when connected
            this.qrCodeCache.delete(clientId);

            try {
                await this.syncAllMessages(clientId);
            } catch (error) {
                this.logger.error(`Auto-sync failed for client ${clientId}:`, error);
            }
        });

        client.on('message', async (message: Message) => {
            await this.messageHandler.handleIncomingMessage(clientId, message);
        });

        client.on('auth_failure', async () => {
            await this.updateSession(clientId, 'failed');
            this.logger.error(`WhatsApp auth failed for client ${clientId}`);
            this.emitStatusUpdate(clientId, 'auth_failed');
            this.qrCodeCache.delete(clientId);
        });

        client.on('disconnected', async () => {
            await this.updateSession(clientId, 'disconnected');
            this.logger.log(`WhatsApp disconnected for client ${clientId}`);
            this.emitStatusUpdate(clientId, 'disconnected');
            this.qrCodeCache.delete(clientId);
        });

        client.on('message_ack', async (msg, ack) => {
            const status = this.mapAckToStatus(ack);
            await this.updateMessageStatus(msg.id._serialized, status);
        });
    }

    /**
     * Emit QR code update via WebSocket for real-time delivery
     */
    private emitQRCodeUpdate(clientId: string, qrCode: string) {
        try {
            if (!this.gateway) {
                this.logger.warn(`Gateway not available for client ${clientId}`);
                return;
            }
            this.gateway.sendMessageToClient(clientId, {
                type: 'qr_code_update',
                qrCode,
                clientId,
                timestamp: Date.now() / 1000,
            });
        } catch (error) {
            this.logger.error(`Error emitting QR code update for client ${clientId}:`, error);
        }
    }

    /**
     * Map acknowledgment to message status
     */
    private mapAckToStatus(ack: number): MessageStatus {
        switch (ack) {
            case 0: return MessageStatus.PENDING;
            case 1: return MessageStatus.SENT;
            case 2: return MessageStatus.DELIVERED;
            case 3: return MessageStatus.READ;
            case -1: return MessageStatus.FAILED;
            default: return MessageStatus.PENDING;
        }
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
            this.logger.error(`Failed to update session for client ${clientId}:`, error);
        }
    }

    /**
     * Emit status update to WebSocket clients
     */
    private emitStatusUpdate(clientId: string, status: string) {
        try {
            if (!this.gateway) {
                this.logger.warn(`Gateway not available for client ${clientId}`);
                return;
            }
            this.gateway.sendMessageToClient(clientId, {
                type: 'whatsapp_status',
                status,
                clientId,
                timestamp: Date.now() / 1000,
            });
        } catch (error) {
            this.logger.error(`Error emitting status update for client ${clientId}:`, error);
        }
    }

    /**
     * Log error to database
     */
    private async logError(clientId: string, type: string, error: any) {
        try {
            await this.prisma.log.create({
                data: {
                    clientId,
                    type,
                    data: JSON.stringify({
                        error: error.message,
                        stack: error.stack,
                        timestamp: new Date().toISOString(),
                    }),
                },
            });
        } catch (logError) {
            this.logger.error('Failed to log error:', logError);
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

            // Check for cached QR code first
            const cachedQRCode = this.getCachedQRCode(clientId);
            if (cachedQRCode) {
                this.logger.log(`Returning cached QR code for client ${clientId}`);
                return this.successResponse(
                    { qrCode: cachedQRCode },
                    'QR code retrieved from cache. Please scan to connect.'
                );
            }

            await this.initializeClient(clientId);

            // Wait for QR code to be generated with optimized polling
            const maxAttempts = 15; // Reduced from 30 to 15 seconds
            for (let attempts = 0; attempts < maxAttempts; attempts++) {
                // Check cache first
                const cachedQR = this.getCachedQRCode(clientId);
                if (cachedQR) {
                    return this.successResponse(
                        { qrCode: cachedQR },
                        'QR code generated. Please scan to connect.'
                    );
                }

                // Check database with longer intervals
                if (attempts % 2 === 0) { // Check every 2 seconds instead of every second
                    const session = await this.prisma.whatsAppSession.findFirst({
                        where: { clientId, status: 'pending' },
                        orderBy: { created_at: 'desc' },
                    });

                    if (session?.sessionData) {
                        try {
                            const sessionData = JSON.parse(session.sessionData);
                            if (sessionData.qrCode) {
                                // Cache the QR code for future requests
                                this.cacheQRCode(clientId, sessionData.qrCode);
                                return this.successResponse(
                                    { qrCode: sessionData.qrCode },
                                    'QR code generated. Please scan to connect.'
                                );
                            }
                        } catch (error) {
                            this.logger.error('Error parsing sessionData for QR code:', error);
                        }
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 1000));
            }

            return this.errorResponse(null, 'QR code generation timeout. Please try again.');
        } catch (error) {
            this.logger.error('Error in connectWhatsApp:', error);
            return this.errorResponse(error, 'Failed to connect WhatsApp');
        }
    }
    /**
     * Get QR code for a client
     */
    async getQRCode(clientId: string) {
        try {
            // Check cache first for fastest response
            const cachedQRCode = this.getCachedQRCode(clientId);
            if (cachedQRCode) {
                this.logger.log(`Returning cached QR code for client ${clientId}`);
                return this.successResponse({ qrCode: cachedQRCode });
            }

            const session = await this.prisma.whatsAppSession.findFirst({
                where: { clientId },
                orderBy: { created_at: 'desc' },
            });

            if (!session) {
                return this.errorResponse(null, 'No WhatsApp session found. Please connect WhatsApp first.');
            }

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

            // Cache the QR code for future requests
            this.cacheQRCode(clientId, sessionData.qrCode);

            return this.successResponse({ qrCode: sessionData.qrCode });
        } catch (error) {
            return this.errorResponse(error, 'Error retrieving QR code');
        }
    }

    async regenerateQRCode(clientId: string) {
        try {
            this.logger.log(`Regenerating QR code for client ${clientId}`);

            const existingSession = await this.prisma.whatsAppSession.findFirst({
                where: { clientId },
                orderBy: { created_at: 'desc' },
            });

            if (!existingSession) {
                return this.errorResponse(null, 'No WhatsApp session found. Please connect WhatsApp first.');
            }

            // Clear any cached QR code
            this.qrCodeCache.delete(clientId);

            // Disconnect active client if needed
            if (existingSession.status === 'active') {
                this.logger.log(`Disconnecting active client ${clientId} before regenerating QR code`);
                await this.disconnectWhatsApp(clientId);
            }

            // Clean up existing client
            if (this.clients.has(clientId)) {
                const client = this.clients.get(clientId);
                try {
                    await client.destroy();
                } catch (error) {
                    this.logger.warn(`Could not destroy existing client: ${error.message}`);
                }
                this.clients.delete(clientId);
            }

            // Update session and reinitialize
            await this.updateSession(clientId, 'pending', { qrCode: null });
            await this.initializeClient(clientId);

            // Wait for QR code generation with optimized polling
            const maxAttempts = 10; // Reduced wait time
            for (let attempts = 0; attempts < maxAttempts; attempts++) {
                // Check cache first
                const cachedQR = this.getCachedQRCode(clientId);
                if (cachedQR) {
                    this.logger.log(`QR code regenerated successfully for client ${clientId}`);
                    return this.successResponse({
                        qrCode: cachedQR,
                        message: 'QR code regenerated successfully. Please scan the new QR code to connect WhatsApp.'
                    });
                }

                // Check database
                const newSession = await this.prisma.whatsAppSession.findFirst({
                    where: { clientId },
                    orderBy: { created_at: 'desc' },
                });

                if (newSession?.sessionData) {
                    const sessionData = JSON.parse(newSession.sessionData);
                    if (sessionData.qrCode) {
                        // Cache the new QR code
                        this.cacheQRCode(clientId, sessionData.qrCode);
                        this.logger.log(`QR code regenerated successfully for client ${clientId}`);
                        return this.successResponse({
                            qrCode: sessionData.qrCode,
                            message: 'QR code regenerated successfully. Please scan the new QR code to connect WhatsApp.'
                        });
                    }
                }

                await new Promise(resolve => setTimeout(resolve, 500)); // Faster polling
            }

            return this.errorResponse(null, 'QR code regeneration timeout. Please try again.');

        } catch (error) {
            this.logger.error(`Error regenerating QR code for client ${clientId}:`, error);
            return this.errorResponse(error, 'Error regenerating QR code');
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
                await client.logout();
                await client.destroy();
                this.clients.delete(clientId);
            }

            await this.prisma.whatsAppSession.deleteMany({ where: { clientId } });
            await this.prisma.message.deleteMany({ where: { clientId } });

            this.logger.log(`WhatsApp disconnected for client ${clientId}`);
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
            if (!client?.info) {
                this.logger.warn(`Client ${clientId} not ready for auto-sync`);
                return;
            }

            // Check if we need to sync (if last sync was more than 5 minutes ago)
            const lastSyncLog = await this.prisma.log.findFirst({
                where: { clientId, type: 'message_sync' },
                orderBy: { created_at: 'desc' },
            });

            const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
            if (lastSyncLog?.created_at > fiveMinutesAgo) {
                this.logger.log(`Auto-sync skipped for client ${clientId} - last sync was recent`);
                return;
            }

            this.logger.log(`Auto-syncing messages for client ${clientId}...`);
            const syncResult = await this.syncAllMessages(clientId);
            if (!syncResult.success) {
                this.logger.error(`Auto-sync failed for client ${clientId}:`, syncResult.message);
            } else {
                this.logger.log(`Auto-sync completed for client ${clientId}: ${syncResult.data?.totalSynced || 0} messages synced`);
            }
        } catch (error) {
            this.logger.error(`Auto-sync failed for client ${clientId}:`, error);
        }
    }

    /**
     * Start periodic auto-sync for all active clients
     */
    private startPeriodicAutoSync() {
        setInterval(async () => {
            try {
                const activeSessions = await this.prisma.whatsAppSession.findMany({
                    where: { status: 'active' },
                });

                this.logger.log(`Periodic auto-sync: checking ${activeSessions.length} active clients`);

                for (const session of activeSessions) {
                    await this.autoSyncMessages(session.clientId);
                }

                this.logger.log(`Periodic auto-sync completed for ${activeSessions.length} clients`);
            } catch (error) {
                this.logger.error('Periodic auto-sync failed:', error);
            }
        }, 5 * 60 * 1000); // 5 minutes

        this.logger.log('Periodic auto-sync started (every 5 minutes)');
    }

    /**
     * Start periodic QR code cache cleanup
     */
    private startQRCodeCacheCleanup() {
        setInterval(() => {
            try {
                const now = Date.now();
                let cleanedCount = 0;

                for (const [clientId, cached] of this.qrCodeCache.entries()) {
                    if (now - cached.timestamp > this.QR_CACHE_TTL) {
                        this.qrCodeCache.delete(clientId);
                        cleanedCount++;
                    }
                }

                if (cleanedCount > 0) {
                    this.logger.log(`Cleaned up ${cleanedCount} expired QR code cache entries`);
                }
            } catch (error) {
                this.logger.error('QR code cache cleanup failed:', error);
            }
        }, 60 * 1000); // Every minute
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
                select: { id: true, credits: true, name: true, email: true, type: true }
            });

            if (!user) {
                return { success: false, message: 'Client not found' };
            }

            // Skip credit check for admin users
            const isAdmin = user.type === 'admin' || user.type === 'su_admin';
            const requiredCredits = 1; // 1 credit per message

            if (!isAdmin && (user.credits ?? 0) < requiredCredits) {
                return {
                    success: false,
                    message: `Insufficient credits. You have ${user.credits ?? 0} credits, but ${requiredCredits} credit is required to send a message.`
                };
            }

            const whatsappNumber = this.formatPhoneNumber(phoneNumber);
            this.logger.log(`Sending message to ${whatsappNumber}`);

            // Validate the phone number format (individual only)
            if (!whatsappNumber.includes('@c.us')) {
                return { success: false, message: 'Invalid phone number format' };
            }

            // Reject group messages
            if (whatsappNumber.includes('@g.us')) {
                return { success: false, message: 'Group messaging is not supported' };
            }

            // Try to get or create chat before sending message
            let chat;
            try {
                chat = await client.getChatById(whatsappNumber);
            } catch (chatError) {
                this.logger.log(`Could not get existing chat for ${whatsappNumber}, will create new chat`);
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
                    this.logger.log(`Send attempt ${retryCount} failed for ${whatsappNumber}:`, sendError.message);

                    if (retryCount >= maxRetries) {
                        throw sendError;
                    }

                    // Wait before retry
                    await new Promise(resolve => setTimeout(resolve, 1000 * retryCount));
                }
            }

            // Deduct credits after successful sending (skip for admin users)
            let updatedUser = user;
            if (!isAdmin) {
                updatedUser = await this.prisma.user.update({
                    where: { id: clientId },
                    data: { credits: { decrement: requiredCredits } },
                    select: { id: true, credits: true, name: true, email: true, type: true }
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
            }

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

            const contactId = contact?.id || "unknown contact"

            // Handle outgoing message through message handler
            // Message sent successfully, no need for additional handling

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

            // Prepare message data for broadcasting
            const messageData = {
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
                status: MessageStatus.SENT,
            };

            // Broadcast to all clients in the conversation room
            try {
                const conversationRoom = `conversation_${clientId}_${phoneNumber}`;
                this.gateway.server.to(conversationRoom).emit('newMessage', {
                    message: messageData,
                    conversationId: phoneNumber,
                    clientId: clientId,
                    timestamp: new Date().toISOString(),
                });

                // Also emit to the specific client for immediate feedback
                this.gateway.sendMessageToClient(clientId, {
                    type: 'message_sent',
                    data: messageData,
                    conversationId: phoneNumber,
                });

                this.logger.log(`Broadcasted message to room: ${conversationRoom}`);
            } catch (broadcastError) {
                this.logger.error('Error broadcasting message:', broadcastError);
            }

            // Return details about the sent message
            return {
                success: true,
                data: messageData,
            };
        } catch (error) {
            this.logger.error('Error sending message:', error);

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
            select: { id: true, credits: true, name: true, email: true, type: true }
        });
        if (!user) {
            return { success: false, message: 'Client not found', data: [] };
        }

        // Skip credit check for admin users
        const isAdmin = user.type === 'admin' || user.type === 'su_admin';
        const requiredCredits = phoneNumbers.length;

        if (!isAdmin && (user.credits ?? 0) < requiredCredits) {
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
            let updatedUser = user;
            if (!isAdmin) {
                updatedUser = await this.prisma.user.update({
                    where: { id: clientId },
                    data: { credits: { decrement: successfulMessages } },
                    select: { id: true, credits: true, name: true, email: true, type: true }
                });
                await this.prisma.creditLog.create({
                    data: {
                        clientId,
                        amount: successfulMessages,
                        type: 'DECREMENT',
                        description: `Credits deducted for sending ${successfulMessages} messages in bulk operation`,
                    },
                });
            }
            results.forEach(result => {
                if (result.success && result.data) {
                    result.data.creditsUsed = isAdmin ? 0 : 1;
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
                    creditsUsed: isAdmin ? 0 : successfulMessages,
                    creditsRemaining: isAdmin ? user.credits : (successfulMessages > 0 ? (await this.prisma.user.findUnique({
                        where: { id: clientId },
                        select: { credits: true }
                    }))?.credits : user.credits),
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
 * Clean up old messages to keep only the 100 most recent per conversation
 */
    private async cleanupOldMessages(clientId: string) {
        try {
            // Get all unique conversations for this client (individual only)
            const conversations = await this.prisma.message.groupBy({
                by: ['from'],
                where: {
                    clientId,
                    from: {
                        not: null
                    },
                    NOT: {
                        from: {
                            contains: '@g.us'
                        }
                    }
                },
                _count: { id: true }
            });

            let totalDeleted = 0;

            for (const conversation of conversations) {
                if (!conversation.from) continue;

                // Get the 100th most recent message timestamp for this conversation
                const hundredthMessage = await this.prisma.message.findFirst({
                    where: {
                        clientId,
                        from: conversation.from
                    },
                    orderBy: { timestamp: 'desc' },
                    skip: 99, // Skip first 99 to get the 100th
                    select: { timestamp: true }
                });

                if (hundredthMessage) {
                    // Delete all messages older than the 100th most recent for this conversation
                    const deletedCount = await this.prisma.message.deleteMany({
                        where: {
                            clientId,
                            from: conversation.from,
                            timestamp: {
                                lt: hundredthMessage.timestamp
                            }
                        }
                    });

                    if (deletedCount.count > 0) {
                        totalDeleted += deletedCount.count;
                        this.logger.log(`Cleaned up ${deletedCount.count} old messages for individual conversation ${conversation.from} (client ${clientId})`);
                    }
                }
            }

            if (totalDeleted > 0) {
                this.logger.log(`Total cleaned up ${totalDeleted} old messages for client ${clientId}`);
            }
        } catch (error) {
            this.logger.error('Error cleaning up old messages:', error);
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
                    // Get all unique conversations for this client (individual only)
                    const conversations = await this.prisma.message.groupBy({
                        by: ['from'],
                        where: {
                            clientId: client.id,
                            from: {
                                not: null
                            },
                            NOT: {
                                from: {
                                    contains: '@g.us'
                                }
                            }
                        },
                        _count: { id: true }
                    });

                    let clientDeleted = 0;

                    for (const conversation of conversations) {
                        if (!conversation.from) continue;

                        // Get the 100th most recent message timestamp for this conversation
                        const hundredthMessage = await this.prisma.message.findFirst({
                            where: {
                                clientId: client.id,
                                from: conversation.from
                            },
                            orderBy: { timestamp: 'desc' },
                            skip: 99, // Skip first 99 to get the 100th
                            select: { timestamp: true }
                        });

                        if (hundredthMessage) {
                            const deletedCount = await this.prisma.message.deleteMany({
                                where: {
                                    clientId: client.id,
                                    from: conversation.from,
                                    timestamp: {
                                        lt: hundredthMessage.timestamp
                                    }
                                }
                            });

                            if (deletedCount.count > 0) {
                                clientDeleted += deletedCount.count;
                                this.logger.log(`Cleaned up ${deletedCount.count} old messages for individual conversation ${conversation.from} (client ${client.name})`);
                            }
                        }
                    }

                    if (clientDeleted > 0) {
                        totalDeleted += clientDeleted;
                        results.push({
                            clientId: client.id,
                            clientName: client.name,
                            deletedCount: clientDeleted
                        });

                        this.logger.log(`Total cleaned up ${clientDeleted} old messages for client ${client.name}`);
                    }
                } catch (error) {
                    this.logger.error(`Error cleaning up messages for client ${client.id}:`, error);
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
                    take: 100,
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
                    messageLimit: 100,
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

            // Get individual conversations only (excluding e2e_notification messages)
            // First, get all unique phone numbers that have messages (both as sender and receiver)
            const allMessages = await this.prisma.message.findMany({
                where: {
                    clientId,
                    NOT: {
                        OR: [
                            {
                                from: {
                                    contains: '@g.us'
                                }
                            },
                            {
                                type: 'e2e_notification'
                            }
                        ]
                    }
                },
                select: {
                    from: true,
                    to: true,
                    timestamp: true
                }
            });

            // Extract unique phone numbers (excluding the client's own number)
            const uniqueNumbers = new Set<string>();
            allMessages.forEach(msg => {
                if (msg.from && msg.from !== clientJid && !msg.from.includes('@g.us')) {
                    uniqueNumbers.add(msg.from);
                }
                if (msg.to && msg.to !== clientJid && !msg.to.includes('@g.us')) {
                    uniqueNumbers.add(msg.to);
                }
            });

            // Get conversation data for each unique number
            const conversations = await Promise.all(
                Array.from(uniqueNumbers).map(async (phoneNumber) => {
                    const messages = await this.prisma.message.findMany({
                        where: {
                            clientId,
                            OR: [
                                { from: phoneNumber },
                                { to: phoneNumber }
                            ],
                            NOT: {
                                type: 'e2e_notification'
                            }
                        },
                        orderBy: { timestamp: 'desc' },
                        select: { id: true, timestamp: true }
                    });

                    return {
                        from: phoneNumber,
                        _count: { id: messages.length },
                        _max: { timestamp: messages[0]?.timestamp || null }
                    };
                })
            );

            const conversationsWithLatestMessage = await Promise.all(
                conversations.map(async (conv) => {
                    // For individual chats only (excluding e2e_notification messages)
                    // Build a more flexible query to find the latest message
                    const latestMessage = await this.prisma.message.findFirst({
                        where: {
                            clientId,
                            OR: [
                                { from: conv.from },
                                { to: conv.from }
                            ],
                            NOT: {
                                type: 'e2e_notification'
                            }
                        },
                        orderBy: { timestamp: 'desc' },
                        select: {
                            id: true,
                            body: true,
                            timestamp: true,
                            direction: true,
                            type: true,
                            from: true,
                            to: true,
                            attachment: {
                                select: {
                                    id: true,
                                    name: true,
                                    type: true,
                                    size: true,
                                    file: true,
                                }
                            }
                        },
                    });

                    // Extract phone number
                    const identifier = conv.from?.replace(/@c\.us$/, '');

                    // For individual contacts
                    const user = await this.prisma.contact.findFirst({
                        where: { phone_number: identifier },
                        select: { id: true, name: true, avatar: true },
                    });

                    // Debug logging to understand why lastMessage might be null
                    if (!latestMessage && conv._count.id > 0) {
                        this.logger.warn(`No latest message found for conversation ${conv.from} despite having ${conv._count.id} messages`);

                        // Try to find any message for this conversation to debug
                        const debugMessage = await this.prisma.message.findFirst({
                            where: {
                                clientId,
                                OR: [
                                    { from: conv.from },
                                    { to: conv.from }
                                ]
                            },
                            select: { id: true, from: true, to: true, type: true, timestamp: true }
                        });

                        if (debugMessage) {
                            this.logger.log(`Debug: Found message for ${conv.from}:`, {
                                id: debugMessage.id,
                                from: debugMessage.from,
                                to: debugMessage.to,
                                type: debugMessage.type,
                                timestamp: debugMessage.timestamp
                            });
                        }
                    }

                    // Process attachment URL if present
                    let processedLatestMessage = null;
                    if (latestMessage) {
                        processedLatestMessage = {
                            ...latestMessage,
                            preview: latestMessage.body ||
                                (latestMessage.type === 'image' ? 'Photo' :
                                    latestMessage.type === 'video' ? 'Video' :
                                        latestMessage.type === 'audio' ? 'Audio' :
                                            latestMessage.type === 'document' ? 'Document' :
                                                latestMessage.type === 'sticker' ? 'Sticker' : ''),
                        };

                        // Add attachment URL if present
                        if (latestMessage.attachment && latestMessage.attachment.name) {
                            processedLatestMessage.attachment = {
                                ...latestMessage.attachment,
                                url: SojebStorage.url(
                                    appConfig().storageUrl.attachment + latestMessage.attachment.name,
                                ),
                            };
                        }
                    }

                    return {
                        phoneNumber: conv.from,
                        messageCount: conv._count.id,
                        lastMessage: processedLatestMessage,
                        lastActivity: conv._max.timestamp,
                        userId: user?.id || null,
                        name: user?.name || identifier || null,
                        avatar: user?.avatar || null,
                        isGroup: false,
                        groupInfo: null,
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
            this.logger.error('Error getting conversations:', error);
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
        limit: number = 20,
        offset: number = 0,
        page: number = 1
    ): Promise<{ success: boolean; data?: any; message?: string }> {
        try {
            if (!phoneNumber) {
                return { success: false, message: 'Phone number is required' };
            }

            // Auto-sync messages before getting conversation messages to ensure we have the latest data
            await this.autoSyncMessages(clientId);

            // Format phone JID (individual only)
            let waJid = phoneNumber;
            if (!waJid.endsWith('@c.us')) {
                waJid = waJid + '@c.us';
            }

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

            // Build query for individual conversations only
            const orCondition = [
                { from: clientNumber, to: waJid },
                { from: waJid, to: clientNumber },
            ];

            // Fetch messages in WhatsApp-like order (most recent first), excluding e2e_notification messages
            const [messages, totalCount] = await Promise.all([
                this.prisma.message.findMany({
                    where: {
                        clientId,
                        OR: orCondition,
                        NOT: {
                            type: 'e2e_notification'
                        }
                    },
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
                    where: {
                        clientId,
                        OR: orCondition,
                        NOT: {
                            type: 'e2e_notification'
                        }
                    },
                }),
            ]);

            // Return messages in chronological order (oldest to newest) for display
            // This mimics WhatsApp Web behavior where messages are displayed chronologically
            // but the conversation list shows most recent first
            const chronologicalMessages = messages.reverse().map(msg => {
                if (msg.attachment && msg.attachment.name) {
                    return {
                        ...msg,
                        attachment: {
                            ...msg.attachment,
                            url: SojebStorage.url(
                                appConfig().storageUrl.attachment + msg.attachment.name,
                            ),
                        },
                    };
                } else if (msg.type && ['image', 'video', 'audio', 'document', 'media', 'sticker'].includes(msg.type)) {
                    // For messages with media types but no attachments, provide a placeholder
                    return {
                        ...msg,
                        attachment: {
                            id: null,
                            name: null,
                            type: msg.type === 'image' ? 'image/jpeg' :
                                msg.type === 'video' ? 'video/mp4' :
                                    msg.type === 'audio' ? 'audio/mp3' :
                                        msg.type === 'document' ? 'application/pdf' :
                                            'application/octet-stream',
                            size: 0,
                            file: null,
                            url: null,
                            needsFix: true, // Flag to indicate this needs the fix endpoint
                        },
                    };
                }
                return msg;
            });

            // Calculate pagination info
            const totalPages = Math.ceil(totalCount / limit);
            const hasNextPage = page < totalPages;
            const hasPreviousPage = page > 1;

            return {
                success: true,
                data: {
                    messages: chronologicalMessages,
                    clientNumber,
                    pagination: {
                        page,
                        limit,
                        total: totalCount,
                        totalPages,
                        hasNextPage,
                        hasPreviousPage,
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
                        if (msg.attachment && msg.attachment.name) {
                            return {
                                ...msg,
                                attachment: {
                                    ...msg.attachment,
                                    url: SojebStorage.url(appConfig().storageUrl.attachment + msg.attachment.name),
                                },
                            };
                        }
                        return msg;
                    }),
                },
            };
        } catch (error) {
            this.logger.error('Error getting inbox:', error);
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
            const healthCheck = await this.checkAndReconnectClient(clientId);
            if (!healthCheck.success) {
                return { success: false, message: 'Failed to connect WhatsApp client' };
            }
            await this.autoSyncMessages(clientId);
            const user = await this.prisma.user.findUnique({
                where: { id: clientId },
                select: { id: true, credits: true, name: true, email: true, type: true }
            });
            if (!user) {
                return { success: false, message: 'Client not found' };
            }

            // Skip credit check for admin users
            const isAdmin = user.type === 'admin' || user.type === 'su_admin';
            const requiredCredits = phoneNumbers.length;

            if (!isAdmin && (user.credits ?? 0) < requiredCredits) {
                return {
                    success: false,
                    message: `Insufficient credits. You have ${user.credits ?? 0} credits, but ${requiredCredits} credits are required to send ${phoneNumbers.length} template messages.`
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
                        phoneNumbers,
                        variables,
                        processedMessage: processedMessage.substring(0, 500),
                        recipientCount: phoneNumbers.length,
                        creditsRequired: isAdmin ? 0 : requiredCredits,
                        availableCredits: user.credits,
                        isAdmin,
                    }),
                },
            });
            const result = await this.sendBulkMessage(clientId, phoneNumbers, processedMessage);
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
                        phoneNumbers,
                        variables,
                        stack: error.stack,
                        timestamp: new Date().toISOString(),
                    }),
                    extra: {
                        recipientCount: phoneNumbers.length,
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
        const user = await this.prisma.user.findUnique({
            where: { id: clientId },
            select: { credits: true, type: true }
        });

        // Skip credit check for admin users
        const isAdmin = user.type === 'admin' || user.type === 'su_admin';
        const requiredCredits = 1;

        if (!isAdmin && (user.credits ?? 0) < requiredCredits) {
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

        // 5. Deduct credits and log (skip for admin users)
        if (!isAdmin) {
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
        }

        // Find contact if exists
        const contact = await this.prisma.contact.findFirst({
            where: { phone_number: phoneNumber }
        });
        const contactId = contact?.id || "unknown contact";
        // 6. Save message to database directly
        let fileName = null;
        if (file) {
            fileName = FileUrlHelper.generateRandomFileName(file.originalname);
            await SojebStorage.put(
                appConfig().storageUrl.attachment + fileName,
                file.buffer,
            );
        }

        // Only create attachment if we have a file
        let attachment = null;
        if (fileName) {
            attachment = await this.prisma.attachment.create({
                data: {
                    name: fileName,
                    type: file.mimetype,
                    size: file.size,
                    file: fileName,
                    file_alt: '',
                },
            });
        }

        // Get client number from session
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

        const savedMessage = await this.prisma.message.create({
            data: {
                clientId,
                from: clientNumber,
                to: whatsappNumber,
                body: caption || '',
                type: 'media',
                timestamp: new Date(sentMsg.timestamp * 1000),
                messageId: sentMsg.id._serialized,
                direction: 'OUTBOUND',
                attachment_id: attachment?.id || undefined,
            },
        });

        const handlerResult = {
            attachmentId: attachment?.id || null,
            fileUrl: null, // File is stored locally, no URL needed
            savedMessageId: savedMessage.id,
        };

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
                    creditsUsed: isAdmin ? 0 : requiredCredits,
                    media: true,
                    attachmentId: handlerResult.attachmentId,
                    fileUrl: handlerResult.fileUrl,
                    isAdmin,
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
                creditsUsed: isAdmin ? 0 : requiredCredits,
                handlerResult,
            },
        };
    }

    /**
     * Sync all messages from WhatsApp for a client
     */
    async syncAllMessages(clientId: string, retryCount: number = 0) {
        const maxRetries = 2; // Prevent infinite recursion

        if (retryCount >= maxRetries) {
            this.logger.error(`Max retries (${maxRetries}) reached for client ${clientId}, aborting sync`);
            return { success: false, message: 'Max retries reached for message sync' };
        }
        try {
            const client = this.clients.get(clientId);
            if (!client) {
                this.logger.warn(`Client ${clientId} not found in memory, attempting to reconnect...`);
                const healthCheck = await this.checkAndReconnectClient(clientId);
                if (!healthCheck.success) {
                    return { success: false, message: 'WhatsApp client not connected and reconnection failed' };
                }
                // Get the client again after reconnection
                const reconnectedClient = this.clients.get(clientId);
                if (!reconnectedClient) {
                    return { success: false, message: 'Failed to get reconnected client' };
                }
                // Add a small delay before retry to avoid overwhelming the system
                await new Promise(resolve => setTimeout(resolve, 1000));
                return await this.syncAllMessages(clientId, retryCount + 1); // Recursive call with reconnected client
            }

            // Check if client is properly initialized and ready
            if (!client.info || !client.pupPage) {
                this.logger.warn(`Client ${clientId} not ready, attempting to reconnect...`);
                this.clients.delete(clientId);
                const healthCheck = await this.checkAndReconnectClient(clientId);
                if (!healthCheck.success) {
                    return { success: false, message: 'WhatsApp client not ready and reconnection failed' };
                }
                // Get the client again after reconnection
                const reconnectedClient = this.clients.get(clientId);
                if (!reconnectedClient) {
                    return { success: false, message: 'Failed to get reconnected client' };
                }
                // Add a small delay before retry to avoid overwhelming the system
                await new Promise(resolve => setTimeout(resolve, 1000));
                return await this.syncAllMessages(clientId, retryCount + 1); // Recursive call with reconnected client
            }

            this.logger.log(`Starting message sync for client ${clientId}`);

            // Get individual chats only with error handling
            let chats;
            try {
                chats = await client.getChats();
            } catch (chatError) {
                this.logger.error(`Failed to get chats for client ${clientId}:`, chatError);

                // If getting chats fails, try to reconnect and retry once
                this.logger.log(`Attempting to reconnect client ${clientId} due to chat fetch failure...`);
                this.clients.delete(clientId);
                const healthCheck = await this.checkAndReconnectClient(clientId);
                if (!healthCheck.success) {
                    return { success: false, message: 'Failed to get chats and reconnection failed' };
                }

                // Try again with reconnected client
                const reconnectedClient = this.clients.get(clientId);
                if (!reconnectedClient) {
                    return { success: false, message: 'Failed to get reconnected client' };
                }

                try {
                    chats = await reconnectedClient.getChats();
                } catch (retryError) {
                    this.logger.error(`Failed to get chats on retry for client ${clientId}:`, retryError);
                    return { success: false, message: 'Failed to get chats after reconnection attempt' };
                }
            }

            const individualChats = chats.filter(chat => !chat.id._serialized.endsWith('@g.us'));

            let totalSynced = 0;
            let totalSkipped = 0;

            for (const chat of individualChats) {
                try {
                    this.logger.log(`Syncing messages for individual chat: ${chat.id._serialized}`);

                    // Get messages from this chat with error handling
                    let messages;
                    try {
                        messages = await chat.fetchMessages({ limit: 50 });
                    } catch (fetchError) {
                        this.logger.error(`Failed to fetch messages for chat ${chat.id._serialized}:`, fetchError);
                        continue; // Skip this chat and continue with others
                    }

                    for (const message of messages) {
                        try {
                            // Skip e2e_notification messages completely
                            if (message.type === 'e2e_notification') {
                                totalSkipped++;
                                continue;
                            }

                            // Check if message already exists
                            const existingMessage = await this.prisma.message.findFirst({
                                where: {
                                    clientId,
                                    messageId: message.id._serialized,
                                },
                            });

                            if (existingMessage) {
                                totalSkipped++;
                                continue; // Skip this message as it already exists
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

                            // Save message to database using upsert to handle duplicates gracefully
                            let attachmentId = null;
                            let fileUrl = null;

                            // Handle media attachment if present
                            if (message.hasMedia) {
                                try {
                                    this.logger.log(`Processing media message during sync: ${message.type}`);

                                    // Extract media data
                                    const media = await message.downloadMedia();
                                    if (media) {
                                        const buffer = Buffer.from(media.data, 'base64');
                                        const fileName = FileUrlHelper.generateRandomFileName(message.id._serialized);
                                        const storagePath = appConfig().storageUrl.attachment + fileName;

                                        // Save file to storage
                                        await SojebStorage.put(storagePath, buffer);
                                        fileUrl = SojebStorage.url(storagePath);

                                        // Create attachment record
                                        const attachment = await this.prisma.attachment.create({
                                            data: {
                                                name: fileName,
                                                type: media.mimetype,
                                                size: buffer.length,
                                                file: fileName,
                                                file_alt: '',
                                            },
                                        });
                                        attachmentId = attachment.id;

                                        this.logger.log(`Successfully saved media attachment: ${media.mimetype}, size: ${buffer.length}`);
                                    }
                                } catch (mediaError) {
                                    this.logger.error(`Error processing media during sync for message ${message.id._serialized}:`, mediaError);
                                }
                            }

                            await this.prisma.message.upsert({
                                where: {
                                    messageId: message.id._serialized,
                                },
                                update: {
                                    // Update fields if message already exists (though this shouldn't happen often)
                                    body: message.hasMedia && message.body && (message.body.startsWith('/9j/') || message.body.startsWith('iVBORw0KGgo') || message.body.startsWith('R0lGODlh')) ? '' : message.body, // Don't save base64 data in body for media messages
                                    type: message.type || 'chat',
                                    timestamp: new Date(message.timestamp * 1000),
                                    direction,
                                    status: MessageStatus.READ,
                                    attachment_id: attachmentId || undefined,
                                },
                                create: {
                                    clientId,
                                    from: message.from,
                                    to: message.to || null,
                                    body: message.hasMedia && message.body && (message.body.startsWith('/9j/') || message.body.startsWith('iVBORw0KGgo') || message.body.startsWith('R0lGODlh')) ? '' : message.body, // Don't save base64 data in body for media messages
                                    type: message.type || 'chat',
                                    timestamp: new Date(message.timestamp * 1000),
                                    messageId: message.id._serialized,
                                    direction,
                                    status: MessageStatus.READ,
                                    attachment_id: attachmentId || undefined,
                                },
                            });

                            totalSynced++;
                        } catch (messageError) {
                            this.logger.error(`Error syncing message ${message.id._serialized}:`, messageError);
                        }
                    }
                } catch (chatError) {
                    this.logger.error(`Error syncing chat ${chat.id._serialized}:`, chatError);
                }
            }

            // Clean up old messages after sync
            await this.cleanupOldMessages(clientId);

            // Log sync completion
            await this.prisma.log.create({
                data: {
                    clientId,
                    type: 'message_sync',
                    action: 'SYNC_COMPLETED',
                    level: 'info',
                    status: 'SUCCESS',
                    data: JSON.stringify({
                        totalSynced,
                        totalSkipped,
                        totalChats: individualChats.length,
                        timestamp: new Date().toISOString(),
                    }),
                    extra: {
                        syncType: 'auto',
                    },
                },
            });

            this.logger.log(`Message sync completed for client ${clientId}: ${totalSynced} synced, ${totalSkipped} skipped from ${individualChats.length} chats`);

            return {
                success: true,
                data: {
                    totalSynced,
                    totalSkipped,
                    totalChats: individualChats.length,
                    timestamp: new Date().toISOString(),
                },
            };
        } catch (error) {
            this.logger.error(`Error syncing messages for client ${clientId}:`, error);

            // Log the error to database
            await this.logError(clientId, 'message_sync_error', error);

            return {
                success: false,
                message: error.message,
            };
        }
    }

    /**
     * Mark messages as read for a conversation
     */
    async markMessagesAsRead(clientId: string, conversationId: string) {
        try {
            // Format conversation ID (individual only)
            let waJid = conversationId;
            if (!waJid.endsWith('@c.us')) {
                waJid = waJid + '@c.us';
            }

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

            // Build query to find unread messages (individual only)
            const whereCondition = {
                clientId,
                from: waJid,
                to: clientNumber,
                direction: 'INBOUND',
                status: { not: MessageStatus.READ }
            };

            // Update messages to READ status
            const updateResult = await this.prisma.message.updateMany({
                where: whereCondition,
                data: { status: MessageStatus.READ }
            });

            if (updateResult.count > 0) {
                // Broadcast read status to conversation room
                try {
                    const conversationRoom = `conversation_${clientId}_${conversationId}`;
                    this.gateway.server.to(conversationRoom).emit('messagesRead', {
                        conversationId: conversationId,
                        clientId: clientId,
                        readCount: updateResult.count,
                        timestamp: new Date().toISOString(),
                    });

                    this.logger.log(`Broadcasted read status for ${updateResult.count} messages in conversation: ${conversationId}`);
                } catch (broadcastError) {
                    this.logger.error('Error broadcasting read status:', broadcastError);
                }

                // Log the read action
                await this.prisma.log.create({
                    data: {
                        clientId,
                        type: 'message_read',
                        action: 'MARK_AS_READ',
                        level: 'info',
                        status: 'SUCCESS',
                        entityId: conversationId,
                        data: JSON.stringify({
                            conversationId,
                            readCount: updateResult.count,
                            isGroup: false,
                        }),
                        extra: {
                            conversationType: 'individual',
                        },
                    },
                });
            }

            return {
                success: true,
                data: {
                    conversationId: conversationId,
                    readCount: updateResult.count,
                    isGroup: false,
                }
            };
        } catch (error) {
            this.logger.error('Error marking messages as read:', error);
            return {
                success: false,
                message: error.message,
            };
        }
    }



    /**
     * Fix messages with media types but no attachments
     */
    async fixMessagesWithoutAttachments(clientId: string) {
        try {
            this.logger.log(`Fixing messages without attachments for client ${clientId}`);

            // Find messages that have media types but no attachments
            const messagesWithoutAttachments = await this.prisma.message.findMany({
                where: {
                    clientId,
                    type: {
                        in: ['image', 'video', 'audio', 'document', 'media', 'sticker']
                    },
                    attachment_id: null,
                    messageId: {
                        not: null
                    }
                },
                select: {
                    id: true,
                    messageId: true,
                    type: true,
                    from: true,
                    to: true,
                    timestamp: true
                }
            });

            this.logger.log(`Found ${messagesWithoutAttachments.length} messages without attachments`);

            let fixedCount = 0;
            let errorCount = 0;

            for (const message of messagesWithoutAttachments) {
                try {
                    // Try to get the message from WhatsApp to download media
                    const client = this.clients.get(clientId);
                    if (!client) {
                        this.logger.warn(`Client ${clientId} not available for message ${message.messageId}`);
                        continue;
                    }

                    // Get the message from WhatsApp
                    const whatsappMessage = await client.getMessageById(message.messageId);
                    if (!whatsappMessage || !whatsappMessage.hasMedia) {
                        this.logger.log(`Message ${message.messageId} has no media or not found`);
                        continue;
                    }

                    // Download media
                    const media = await whatsappMessage.downloadMedia();
                    if (!media) {
                        this.logger.log(`Could not download media for message ${message.messageId}`);
                        continue;
                    }

                    // Save attachment
                    const buffer = Buffer.from(media.data, 'base64');
                    const fileName = FileUrlHelper.generateRandomFileName(message.messageId);
                    const storagePath = appConfig().storageUrl.attachment + fileName;

                    await SojebStorage.put(storagePath, buffer);

                    const attachment = await this.prisma.attachment.create({
                        data: {
                            name: fileName,
                            type: media.mimetype || 'application/octet-stream',
                            size: buffer.length,
                            file: fileName,
                            file_alt: '',
                        },
                    });

                    // Update message with attachment
                    await this.prisma.message.update({
                        where: { id: message.id },
                        data: { attachment_id: attachment.id }
                    });

                    fixedCount++;
                    this.logger.log(`Fixed message ${message.messageId} with attachment ${attachment.id}`);

                } catch (error) {
                    errorCount++;
                    this.logger.error(`Error fixing message ${message.messageId}:`, error);
                }
            }

            return {
                success: true,
                data: {
                    totalFound: messagesWithoutAttachments.length,
                    fixedCount,
                    errorCount,
                    timestamp: new Date().toISOString(),
                }
            };

        } catch (error) {
            this.logger.error('Error fixing messages without attachments:', error);
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

            // Process attachments to include URLs
            const processedMessages = messages.map(msg => {
                if (msg.attachment && msg.attachment.name) {
                    return {
                        ...msg,
                        attachment: {
                            ...msg.attachment,
                            url: SojebStorage.url(
                                appConfig().storageUrl.attachment + msg.attachment.name,
                            ),
                        },
                    };
                }
                return msg;
            });

            return {
                success: true,
                data: {
                    messages: processedMessages,
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
