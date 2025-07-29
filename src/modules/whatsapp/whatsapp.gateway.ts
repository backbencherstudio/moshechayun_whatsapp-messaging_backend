import {
    WebSocketGateway,
    WebSocketServer,
    OnGatewayConnection,
    OnGatewayDisconnect,
    SubscribeMessage,
    MessageBody,
    OnGatewayInit,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';

@WebSocketGateway({
    cors: {
        origin: ['http://localhost:3000', 'http://localhost:8080', 'http://127.0.0.1:5500', 'http://127.0.0.1:3000', '*'],
        credentials: true
    },
    namespace: '/whatsapp'
})
export class WhatsAppGateway implements OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit {
    @WebSocketServer()
    server: Server;

    private readonly logger = new Logger(WhatsAppGateway.name);
    private clients = new Map<string, string>();

    afterInit(server: Server) {
        this.logger.log('WhatsApp WebSocket Gateway initialized');
        this.server = server;
    }

    handleConnection(client: Socket) {
        try {
            if (!client) {
                this.logger.warn('Client is undefined in handleConnection');
                return;
            }

            const clientId = client.handshake.query.clientId as string;

            if (clientId) {
                this.clients.set(clientId, client.id);
                client.join(clientId);
                this.logger.log(`Client ${clientId} connected and joined room ${clientId}`);
            } else {
                this.logger.warn('No clientId provided in query parameters');
            }
        } catch (error) {
            this.logger.error('Error in handleConnection:', error);
        }
    }

    handleDisconnect(client: Socket) {
        try {
            if (!client) {
                this.logger.warn('Client is undefined in handleDisconnect');
                return;
            }

            this.logger.log(`Client disconnected: ${client.id}`);

            const clientId = [...this.clients.entries()].find(
                ([, socketId]) => socketId === client.id
            )?.[0];

            if (clientId) {
                this.clients.delete(clientId);
                this.logger.log(`Client ${clientId} removed from tracking`);
            }
        } catch (error) {
            this.logger.error('Error in handleDisconnect:', error);
        }
    }

    @SubscribeMessage('joinWhatsAppRoom')
    handleJoinRoom(client: Socket, @MessageBody() data: { clientId: string }) {
        try {
            if (!client) {
                this.logger.warn('Client is undefined in handleJoinRoom');
                return;
            }

            const { clientId } = data;

            if (!clientId) {
                this.logger.warn('No clientId provided in handleJoinRoom');
                return;
            }

            client.join(clientId);
            this.logger.log(`Client ${client.id} joined WhatsApp room ${clientId}`);

            client.emit('roomJoined', {
                room: clientId,
                timestamp: new Date().toISOString(),
            });
        } catch (error) {
            this.logger.error('Error in handleJoinRoom:', error);
        }
    }

    @SubscribeMessage('joinConversation')
    handleJoinConversation(client: Socket, @MessageBody() data: { clientId: string; conversationId: string }) {
        try {
            if (!client) {
                this.logger.warn('Client is undefined in handleJoinConversation');
                return;
            }

            const { clientId, conversationId } = data;

            if (!clientId || !conversationId) {
                this.logger.warn('Missing clientId or conversationId in handleJoinConversation');
                return;
            }

            const conversationRoom = `conversation_${clientId}_${conversationId}`;
            client.join(conversationRoom);
            this.logger.log(`Client ${client.id} joined conversation room ${conversationRoom}`);

            client.emit('conversationJoined', {
                conversationId: conversationId,
                room: conversationRoom,
                timestamp: new Date().toISOString(),
            });
        } catch (error) {
            this.logger.error('Error in handleJoinConversation:', error);
        }
    }

    @SubscribeMessage('leaveConversation')
    handleLeaveConversation(client: Socket, @MessageBody() data: { clientId: string; conversationId: string }) {
        try {
            if (!client) {
                this.logger.warn('Client is undefined in handleLeaveConversation');
                return;
            }

            const { clientId, conversationId } = data;

            if (!clientId || !conversationId) {
                this.logger.warn('Missing clientId or conversationId in handleLeaveConversation');
                return;
            }

            const conversationRoom = `conversation_${clientId}_${conversationId}`;
            client.leave(conversationRoom);
            this.logger.log(`Client ${client.id} left conversation room ${conversationRoom}`);

            client.emit('conversationLeft', {
                conversationId: conversationId,
                room: conversationRoom,
                timestamp: new Date().toISOString(),
            });
        } catch (error) {
            this.logger.error('Error in handleLeaveConversation:', error);
        }
    }

    sendMessageToClient(clientId: string, message: any) {
        try {
            if (!this.server) {
                this.logger.warn('WebSocket server not available');
                return;
            }

            const socketId = this.clients.get(clientId);
            if (socketId) {
                this.server.to(socketId).emit('whatsapp_message', message);
                this.logger.log(`Message sent to client ${clientId}`);
            } else {
                this.logger.warn(`Client ${clientId} not found in connected clients`);
            }
        } catch (error) {
            this.logger.error(`Error sending message to client ${clientId}:`, error);
        }
    }

    getConnectedClients() {
        return Array.from(this.clients.keys());
    }
}
