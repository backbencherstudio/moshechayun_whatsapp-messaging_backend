import { Injectable, Logger } from '@nestjs/common';
import { Message } from 'whatsapp-web.js';
import { PrismaService } from 'src/prisma/prisma.service';
import { WhatsAppGateway } from '../whatsapp.gateway';
import { ReceiveMessageDto, MessageDirection, MessageStatus } from '../dto/receive-message.dto';
import { SendMessageDto, MessageType } from '../dto/send-message.dto';

@Injectable()
export class MessageHandlerService {
    private readonly logger = new Logger(MessageHandlerService.name);

    constructor(
        private prisma: PrismaService,
        private gateway: WhatsAppGateway,
    ) { }

    /**
     * Handle incoming WhatsApp messages
     */
    async handleIncomingMessage(clientId: string, message: Message): Promise<void> {
        try {
            this.logger.log(`📨 Processing incoming message for client ${clientId}: ${message.id._serialized}`);

            // Skip saving if message body is empty or type is 'e2e_notification'
            if (!message.body || message.type === 'e2e_notification') {
                this.logger.log(`⏭️ Skipping message ${message.id._serialized} (empty body or system notification)`);
                return;
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
                return;
            }

            // Extract message data
            const messageData = await this.extractMessageData(message);

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
                },
            });

            this.logger.log(`✅ Message saved to database: ${savedMessage.id}`);

            // Process message based on type
            await this.processMessageByType(clientId, message, messageData);

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
            });

            this.logger.log(`✅ Message processed and emitted for client ${clientId}`);
        } catch (error) {
            this.logger.error(`❌ Error handling incoming message:`, error);
            await this.logError(clientId, 'message_received_error', error, { message });
        }
    }

    /**
     * Handle outgoing messages
     */
    async handleOutgoingMessage(
        clientId: string,
        sendDto: SendMessageDto,
        sentMessage: any
    ): Promise<void> {
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
                return;
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
                    timestamp: sentMessage.timestamp
                        ? new Date(sentMessage.timestamp * 1000)
                        : new Date(),
                    messageId: sentMessage.id?._serialized,
                    direction: 'OUTBOUND',
                },
            });

            this.logger.log(`✅ Outgoing message saved to database: ${savedMessage.id}`);

            // Emit to WebSocket
            this.emitMessageToClient(clientId, {
                type: 'message_sent',
                messageId: sentMessage.id?._serialized,
                from: clientNumber,
                to: this.formatPhoneNumber(phoneNumber),
                body: sendDto.message,
                timestamp: sentMessage.timestamp || Date.now(),
                messageType: sendDto.type || 'chat',
                direction: 'OUTBOUND',
                savedMessageId: savedMessage.id,
            });

            this.logger.log(`✅ Outgoing message processed and emitted for client ${clientId}`);
        } catch (error) {
            this.logger.error(`❌ Error handling outgoing message:`, error);
            await this.logError(clientId, 'message_sent_error', error, { sendDto, sentMessage });
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