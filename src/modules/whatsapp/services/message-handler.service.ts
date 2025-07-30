import { Injectable, Logger } from '@nestjs/common';
import { Message } from 'whatsapp-web.js';
import { PrismaService } from 'src/prisma/prisma.service';
import { WhatsAppGateway } from '../whatsapp.gateway';
import { SojebStorage } from 'src/common/lib/Disk/SojebStorage';
import appConfig from 'src/config/app.config';
import { FileUrlHelper } from 'src/common/helper/file-url.helper';
import { PBXService } from '../pbx/pbx.service';
import { Client } from 'whatsapp-web.js';

@Injectable()
export class MessageHandlerService {
    private readonly logger = new Logger(MessageHandlerService.name);
    static clients: Map<string, Client>;

    constructor(
        private prisma: PrismaService,
        private gateway: WhatsAppGateway,
        private readonly pbxService: PBXService,
    ) { }

    /**
     * Handle incoming WhatsApp messages
     */
    async handleIncomingMessage(clientId: string, message: Message): Promise<any> {
        try {
            // Skip e2e_notification messages completely - don't process, don't save, don't display
            if (message.type === 'e2e_notification') {
                this.logger.log(`Skipping e2e_notification message ${message.id._serialized} - not processing`);
                return { success: false, skipped: true, reason: 'e2e_notification message filtered out' };
            }

            this.logger.log(`Processing incoming message for client ${clientId}: ${message.id._serialized}`);

            // Skip saving if message body is empty (but allow media messages with base64 data in body)
            if (!message.body && !message.hasMedia) {
                this.logger.log(`Skipping message ${message.id._serialized} (empty body and no media)`);
                return { success: false, skipped: true, reason: 'Empty body and no media' };
            }

            // Check if message already exists to avoid duplicates
            const existingMessage = await this.prisma.message.findFirst({
                where: {
                    clientId,
                    messageId: message.id._serialized,
                },
            });

            if (existingMessage) {
                this.logger.log(`Message ${message.id._serialized} already exists, skipping`);
                return { success: false, skipped: true, reason: 'Duplicate message', savedMessageId: existingMessage.id };
            }

            // Extract message data
            const messageData = await this.extractMessageData(message);

            // Handle media attachment if present
            let attachmentId = null;
            let fileUrl = null;
            if (messageData.mediaUrl) {
                const buffer = Buffer.from(messageData.mediaUrl.split(',')[1], 'base64');
                const fileName = FileUrlHelper.generateRandomFileName(message.id._serialized);
                const storagePath = appConfig().storageUrl.attachment + fileName;
                await SojebStorage.put(storagePath, buffer);
                fileUrl = SojebStorage.url(storagePath);
                const attachment = await this.prisma.attachment.create({
                    data: {
                        name: fileName,
                        type: messageData.mimeType || 'application/octet-stream',
                        size: buffer.length,
                        file: fileName,
                        file_alt: '',
                    },
                });
                attachmentId = attachment.id;
            }

            // Save message to database
            const savedMessage = await this.prisma.message.create({
                data: {
                    clientId,
                    from: message.from,
                    to: message.to || null,
                    body: message.hasMedia && message.body && (message.body.startsWith('/9j/') || message.body.startsWith('iVBORw0KGgo') || message.body.startsWith('R0lGODlh')) ? '' : message.body, // Don't save base64 data in body for media messages
                    type: message.type || 'chat',
                    timestamp: new Date(message.timestamp * 1000),
                    messageId: message.id._serialized,
                    direction: 'INBOUND',
                    attachment_id: attachmentId || undefined,
                },
            });



            // Broadcast incoming message to WebSocket clients (individual only)
            try {
                // Skip group messages
                if (message.from.endsWith('@g.us')) {
                    this.logger.log(`Skipping group message from ${message.from}`);
                    return;
                }

                const conversationId = message.from.replace('@c.us', '');

                // Prepare message data for broadcasting
                const broadcastMessage = {
                    id: savedMessage.id,
                    messageId: message.id._serialized,
                    from: message.from,
                    to: message.to || null,
                    body: savedMessage.body, // Use the saved body (empty for media messages)
                    timestamp: savedMessage.timestamp,
                    type: message.type || 'chat',
                    direction: 'INBOUND',
                    status: 'PENDING',
                    isGroup: false,
                    attachment: attachmentId ? {
                        id: attachmentId,
                        url: fileUrl,
                        type: messageData.mimeType || 'application/octet-stream',
                        size: messageData.mediaUrl ? Buffer.from(messageData.mediaUrl.split(',')[1], 'base64').length : 0,
                        name: messageData.mediaUrl ? FileUrlHelper.generateRandomFileName(message.id._serialized) : null,
                    } : null,
                };

                // Broadcast to conversation room
                const conversationRoom = `conversation_${clientId}_${conversationId}`;
                this.gateway.server.to(conversationRoom).emit('newMessage', {
                    message: broadcastMessage,
                    conversationId: conversationId,
                    clientId: clientId,
                    timestamp: new Date().toISOString(),
                });

                // Also emit to the specific client for immediate feedback
                this.gateway.sendMessageToClient(clientId, {
                    type: 'message_received',
                    data: broadcastMessage,
                    conversationId: conversationId,
                });


            } catch (broadcastError) {
                this.logger.error('Error broadcasting incoming message:', broadcastError);
            }

            return { success: true, savedMessageId: savedMessage.id };
        } catch (error) {
            this.logger.error(`Error handling incoming message for client ${clientId}:`, error);
            await this.logError(clientId, 'message_handling_error', error, { messageId: message.id._serialized });
            return { success: false, error: error.message };
        }
    }

    /**
     * Extract message data from WhatsApp message
     */
    private async extractMessageData(message: Message): Promise<any> {
        const messageData: any = {
            mimeType: null,
            mediaUrl: null,
        };

        try {
            if (message.hasMedia) {
                // Check if the body contains base64 image data (starts with /9j/ for JPEG)
                if (message.body && (message.body.startsWith('/9j/') || message.body.startsWith('iVBORw0KGgo') || message.body.startsWith('R0lGODlh'))) {
                    // Image data is already in the body as base64
                    const mimeType = message.type === 'image' ? 'image/jpeg' : 'image/jpeg';

                    messageData.mimeType = mimeType;
                    messageData.mediaUrl = `data:${mimeType};base64,${message.body}`;
                } else {
                    // Try to download media using WhatsApp Web.js
                    const media = await message.downloadMedia();
                    if (media) {
                        messageData.mimeType = media.mimetype;
                        messageData.mediaUrl = `data:${media.mimetype};base64,${media.data}`;
                    }
                }
            }
        } catch (error) {
            this.logger.error('Error extracting media data:', error);
        }

        return messageData;
    }

    /**
     * Log error to database
     */
    private async logError(clientId: string, type: string, error: any, context?: any): Promise<void> {
        try {
            await this.prisma.log.create({
                data: {
                    clientId,
                    type,
                    data: JSON.stringify({
                        error: error.message,
                        stack: error.stack,
                        context,
                        timestamp: new Date().toISOString(),
                    }),
                },
            });
        } catch (logError) {
            this.logger.error('Failed to log error:', logError);
        }
    }
} 