import { Injectable, Logger } from '@nestjs/common';
import { Message } from 'whatsapp-web.js';
import { PrismaService } from 'src/prisma/prisma.service';
import { WhatsAppGateway } from '../whatsapp.gateway';
import { SojebStorage } from 'src/common/lib/Disk/SojebStorage';
import appConfig from 'src/config/app.config';
import { StringHelper } from 'src/common/helper/string.helper';
import { PBXService } from '../pbx/pbx.service';
import { Client } from 'whatsapp-web.js';


@Injectable()
export class MessageHandlerService {
    private readonly logger = new Logger(MessageHandlerService.name);

    // Add a static client map reference (to be set from WhatsAppService after clients are initialized)
    static clients: Map<string, Client>;

    constructor(
        private prisma: PrismaService,
        private gateway: WhatsAppGateway,
        private readonly pbxService: PBXService,
    ) { }

    /**
     * Handle incoming WhatsApp messages
     */
    async handleIncomingMessage(clientId: string, message: Message): Promise<any> { // changed from void to any
        try {
            this.logger.log(`📨 Processing incoming message for client ${clientId}: ${message.id._serialized}`);

            // Skip saving if message body is empty or type is 'e2e_notification'
            if (!message.body || message.type === 'e2e_notification') {
                this.logger.log(`⏭️ Skipping message ${message.id._serialized} (empty body or system notification)`);
                return { success: false, skipped: true, reason: 'Empty body or system notification' };
            }

            // Check if message already exists to avoid duplicates
            const existingMessage = await this.prisma.message.findFirst({
                where: {
                    clientId,
                    messageId: message.id._serialized,
                },
            });

            if (existingMessage) {
                this.logger.log(`⚠️ Message ${message.id._serialized} already exists, skipping...`);
                return { success: false, skipped: true, reason: 'Duplicate message', savedMessageId: existingMessage.id };
            }

            // Extract message data
            const messageData = await this.extractMessageData(message);

            // If media, store file and create attachment
            let attachmentId = null;
            let fileUrl = null;
            if (messageData.mediaUrl) {
                // Download and store the media file
                const buffer = Buffer.from(messageData.mediaUrl.split(',')[1], 'base64');
                const fileName = StringHelper.generateRandomFileName(message.id._serialized);
                const storagePath = appConfig().storageUrl.attachment + fileName;
                fileUrl = await SojebStorage.put(storagePath, buffer);
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
                    body: message.body,
                    type: message.type || 'chat',
                    timestamp: new Date(message.timestamp * 1000),
                    messageId: message.id._serialized,
                    direction: 'INBOUND',
                    attachment_id: attachmentId || undefined,
                },
            });

            this.logger.log(`✅ Message saved to database: ${savedMessage.id}`);

            // Process message based on type
            await this.processMessageByType(clientId, message, messageData);

            // 1. Auto-reply to all inbound messages (not sent by us)
            if (!message.fromMe) {
                const autoReply = "Thank you for your message. We will get back to you soon.";
                // Directly send the WhatsApp message using the static clients map
                const client = MessageHandlerService.clients?.get(clientId);
                if (client) {
                    try {
                        await client.sendMessage(message.from, autoReply);
                    } catch (sendErr) {
                        this.logger.error(`❌ Failed to send auto-reply via WhatsApp client:`, sendErr);
                    }
                } else {
                    this.logger.error(`❌ WhatsApp client not found for clientId: ${clientId}`);
                }
                // Optionally, still emit to WebSocket for UI
                await this.gateway.sendMessageToClient(clientId, {
                    type: 'auto_reply',
                    messageId: message.id._serialized,
                    from: message.to,
                    to: message.from,
                    body: autoReply,
                    timestamp: Date.now(),
                    messageType: 'chat',
                    direction: 'OUTBOUND',
                });
            }

            // 2. Only auto-respond to missed calls (PBX call)
            if (
                !message.fromMe &&
                message.type === 'call_log' &&
                message.body?.toLowerCase().includes('missed')
            ) {
                await this.pbxService.sendAutoResponseCall(
                    message.from,
                    "This is an automated call. Thank you for contacting us."
                );
            }

            // Emit to WebSocket
            this.emitMessageToClient(clientId, {
                type: 'message_received',
                messageId: message.id._serialized,
                from: message.from,
                to: message.to,
                body: message.body,
                timestamp: message.timestamp,
                messageType: message.type,
                direction: 'INBOUND',
                savedMessageId: savedMessage.id,
                ...messageData,
                fileUrl,
                attachmentId,
            });

            this.logger.log(`✅ Message processed and emitted for client ${clientId}`);
            return {
                success: true,
                messageId: message.id._serialized,
                savedMessageId: savedMessage.id,
                type: message.type,
                fileUrl,
                attachmentId,
            };
        } catch (error) {
            this.logger.error(`❌ Error handling incoming message:`, error);
            await this.logError(clientId, 'message_received_error', error, { message });
            return { success: false, message: error.message };
        }
    }

    /**
     * Handle outgoing messages
     */
    async handleOutgoingMessage(
        clientIdOrPayload: any,
        sendDto?: any,
        sentMessage?: any
    ): Promise<any> { // changed from void to any
        // If called with a single object (file/media message)
        if (arguments.length === 1 && typeof clientIdOrPayload === 'object' && clientIdOrPayload.media) {
            const payload = clientIdOrPayload;
            try {
                this.logger.log(`📤 Processing outgoing file/media message for client ${payload.clientId}`);
                // Get client number from session
                const session = await this.prisma.whatsAppSession.findFirst({
                    where: { clientId: payload.clientId, status: 'active' },
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
                // Fetch contact by id and clientId
                const contact = await this.prisma.contact.findFirst({
                    where: { id: payload.contactId, clientId: payload.clientId },
                });
                if (!contact || !contact.phone_number) {
                    this.logger.error(`Contact not found or missing phone number for contactId: ${payload.contactId}`);
                    return { success: false, message: 'Contact not found or missing phone number' };
                }
                const phoneNumber = contact.phone_number;
                // Store file using SojebStorage and create Attachment
                const file = payload.media;
                const fileName = StringHelper.generateRandomFileName(file.originalname);
                const storagePath = appConfig().storageUrl.attachment + fileName;
                const fileUrl = await SojebStorage.put(storagePath, file.buffer);
                const attachment = await this.prisma.attachment.create({
                    data: {
                        name: fileName,
                        type: file.mimetype,
                        size: file.size,
                        file: fileName,
                        file_alt: '',
                    },
                });
                // Save sent message to database
                const savedMessage = await this.prisma.message.create({
                    data: {
                        clientId: payload.clientId,
                        from: clientNumber,
                        to: this.formatPhoneNumber(phoneNumber),
                        body: payload.caption || '',
                        type: 'media',
                        timestamp: payload.sentMsg?.timestamp ? new Date(payload.sentMsg.timestamp * 1000) : new Date(),
                        messageId: payload.sentMsg?.id?._serialized,
                        direction: 'OUTBOUND',
                        attachment_id: attachment.id,
                    },
                });
                this.logger.log(`✅ Outgoing file/media message saved to database: ${savedMessage.id}`);
                // Emit to WebSocket
                this.emitMessageToClient(payload.clientId, {
                    type: 'message_sent',
                    messageId: payload.sentMsg?.id?._serialized,
                    from: clientNumber,
                    to: this.formatPhoneNumber(phoneNumber),
                    body: payload.caption || '',
                    timestamp: payload.sentMsg?.timestamp || Date.now(),
                    messageType: 'media',
                    direction: 'OUTBOUND',
                    savedMessageId: savedMessage.id,
                    media: {
                        filename: file.originalname,
                        mimetype: file.mimetype,
                        size: file.size,
                        url: SojebStorage.url(appConfig().storageUrl.attachment + fileName),
                        attachmentId: attachment.id,
                    },
                    caption: payload.caption,
                });
                this.logger.log(`✅ Outgoing file/media message processed and emitted for client ${payload.clientId}`);
                return {
                    success: true,
                    messageId: payload.sentMsg?.id?._serialized,
                    savedMessageId: savedMessage.id,
                    attachmentId: attachment.id,
                    fileUrl,
                };
            } catch (error) {
                this.logger.error(`❌ Error handling outgoing file/media message:`, error);
                await this.logError(payload.clientId, 'message_sent_error', error, { payload });
                return { success: false, message: error.message };
            }
        }
        // Else, treat as text message (legacy signature)
        const clientId = clientIdOrPayload;
        try {
            this.logger.log(`📤 Processing outgoing message for client ${clientId}`);
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
            // Fetch contact by id and clientId
            const contact = await this.prisma.contact.findFirst({
                where: { id: sendDto.contactId, clientId },
            });
            if (!contact || !contact.phone_number) {
                this.logger.error(`Contact not found or missing phone number for contactId: ${sendDto.contactId}`);
                return { success: false, message: 'Contact not found or missing phone number' };
            }
            const phoneNumber = contact.phone_number;
            // Save sent message to database
            const savedMessage = await this.prisma.message.create({
                data: {
                    clientId,
                    from: clientNumber,
                    to: this.formatPhoneNumber(phoneNumber),
                    body: sendDto.message,
                    type: sendDto.type || 'chat',
                    timestamp: sentMessage?.timestamp ? new Date(sentMessage.timestamp * 1000) : new Date(),
                    messageId: sentMessage?.id?._serialized,
                    direction: 'OUTBOUND',
                },
            });
            this.logger.log(`✅ Outgoing message saved to database: ${savedMessage.id}`);
            // Emit to WebSocket
            this.emitMessageToClient(clientId, {
                type: 'message_sent',
                messageId: sentMessage?.id?._serialized,
                from: clientNumber,
                to: this.formatPhoneNumber(phoneNumber),
                body: sendDto.message,
                timestamp: sentMessage?.timestamp || Date.now(),
                messageType: sendDto.type || 'chat',
                direction: 'OUTBOUND',
                savedMessageId: savedMessage.id,
            });
            this.logger.log(`✅ Outgoing message processed and emitted for client ${clientId}`);
            return {
                success: true,
                messageId: sentMessage?.id?._serialized,
                savedMessageId: savedMessage.id,
            };
        } catch (error) {
            this.logger.error(`❌ Error handling outgoing message:`, error);
            await this.logError(clientId, 'message_sent_error', error, { sendDto, sentMessage });
            return { success: false, message: error.message };
        }
    }

    /**
     * Extract comprehensive message data from WhatsApp message
     */
    private async extractMessageData(message: Message): Promise<any> {
        const messageData: any = {
            type: message.type || 'chat',
            timestamp: message.timestamp,
            fromMe: message.fromMe,
        };

        // Handle different message types
        switch (message.type) {
            case 'image':
                messageData.mediaUrl = await message.downloadMedia();
                messageData.mimeType = 'image/jpeg';
                break;

            case 'video':
                messageData.mediaUrl = await message.downloadMedia();
                messageData.mimeType = 'video/mp4';
                break;

            case 'audio':
                messageData.mediaUrl = await message.downloadMedia();
                messageData.mimeType = 'audio/ogg';
                break;

            case 'document':
                messageData.mediaUrl = await message.downloadMedia();
                messageData.mimeType = 'application/octet-stream';
                break;

            case 'location':
                // Handle location if available
                if (message.body && message.body.includes('location')) {
                    messageData.hasLocation = true;
                }
                break;

            case 'sticker':
                messageData.mediaUrl = await message.downloadMedia();
                messageData.mimeType = 'image/webp';
                break;
        }

        return messageData;
    }

    /**
     * Process message based on its type
     */
    private async processMessageByType(clientId: string, message: Message, messageData: any): Promise<void> {
        try {
            switch (message.type) {
                case 'image':
                case 'video':
                case 'audio':
                case 'document':
                case 'sticker':
                    await this.handleMediaMessage(clientId, message, messageData);
                    break;

                case 'location':
                    await this.handleLocationMessage(clientId, message, messageData);
                    break;

                case 'chat':
                default:
                    await this.handleTextMessage(clientId, message, messageData);
                    break;
            }
        } catch (error) {
            this.logger.error(`❌ Error processing message by type:`, error);
        }
    }

    /**
 * Handle media messages
 */
    private async handleMediaMessage(clientId: string, message: Message, messageData: any): Promise<void> {
        this.logger.log(`📷 Processing media message for client ${clientId}`);

        // Save media information to database
        await this.prisma.log.create({
            data: {
                clientId,
                type: 'media_message_received',
                data: JSON.stringify({
                    messageId: message.id._serialized,
                    mediaType: message.type,
                    timestamp: new Date().toISOString(),
                }),
            },
        });
    }

    /**
     * Handle location messages
     */
    private async handleLocationMessage(clientId: string, message: Message, messageData: any): Promise<void> {
        this.logger.log(`📍 Processing location message for client ${clientId}`);

        await this.prisma.log.create({
            data: {
                clientId,
                type: 'location_message_received',
                data: JSON.stringify({
                    messageId: message.id._serialized,
                    latitude: messageData.latitude,
                    longitude: messageData.longitude,
                    description: messageData.description,
                    timestamp: new Date().toISOString(),
                }),
            },
        });
    }

    /**
     * Handle contact messages
     */
    private async handleContactMessage(clientId: string, message: Message, messageData: any): Promise<void> {
        this.logger.log(`👤 Processing contact message for client ${clientId}`);

        await this.prisma.log.create({
            data: {
                clientId,
                type: 'contact_message_received',
                data: JSON.stringify({
                    messageId: message.id._serialized,
                    contactName: messageData.contactName,
                    contactNumber: messageData.contactNumber,
                    timestamp: new Date().toISOString(),
                }),
            },
        });
    }

    /**
     * Handle text messages
     */
    private async handleTextMessage(clientId: string, message: Message, messageData: any): Promise<void> {
        this.logger.log(`💬 Processing text message for client ${clientId}`);

        // You can add text message processing logic here
        // For example, keyword detection, auto-replies, etc.

        await this.prisma.log.create({
            data: {
                clientId,
                type: 'text_message_received',
                data: JSON.stringify({
                    messageId: message.id._serialized,
                    body: message.body,
                    timestamp: new Date().toISOString(),
                }),
            },
        });
    }

    /**
     * Emit message to WebSocket client
     */
    private emitMessageToClient(clientId: string, messageData: any): void {
        try {
            this.gateway.sendMessageToClient(clientId, messageData);
        } catch (error) {
            this.logger.error(`❌ Error emitting message to client ${clientId}:`, error);
        }
    }

    /**
     * Format phone number for WhatsApp
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
     * Log errors
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
            this.logger.error(`❌ Error logging error:`, logError);
        }
    }

    /**
     * Get message statistics for a client
     */
    async getMessageStats(clientId: string): Promise<any> {
        try {
            const [totalMessages, inboundMessages, outboundMessages, mediaMessages] = await Promise.all([
                this.prisma.message.count({ where: { clientId } }),
                this.prisma.message.count({ where: { clientId, direction: 'INBOUND' } }),
                this.prisma.message.count({ where: { clientId, direction: 'OUTBOUND' } }),
                this.prisma.message.count({
                    where: {
                        clientId,
                        type: { in: ['image', 'video', 'audio', 'document', 'sticker'] }
                    }
                }),
            ]);

            return {
                success: true,
                data: {
                    totalMessages,
                    inboundMessages,
                    outboundMessages,
                    mediaMessages,
                    textMessages: totalMessages - mediaMessages,
                },
            };
        } catch (error) {
            this.logger.error(`❌ Error getting message stats:`, error);
            return {
                success: false,
                message: error.message,
            };
        }
    }
} 