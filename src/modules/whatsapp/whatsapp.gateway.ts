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

    // Map to store connected clients: clientId -> socketId
    private clients = new Map<string, string>();

    afterInit(server: Server) {
        console.log('🔌 WhatsApp WebSocket Gateway initialized');
        console.log(`🔌 Server instance:`, server ? 'Available' : 'Not available');
        this.server = server;
        console.log(`🔌 Server assigned to instance:`, this.server ? 'Success' : 'Failed');
    }

    handleConnection(client: Socket) {
        try {
            if (!client) {
                console.log(`⚠️ Client is undefined in handleConnection`);
                return;
            }

            // Get clientId from query parameters
            const clientId = client.handshake.query.clientId as string;

            if (clientId) {
                // Store the client mapping
                this.clients.set(clientId, client.id);

                // Join the client to their specific room
                console.log(`🔌 Client connected: ${client.id}`);
                client.join(clientId);

                console.log(`✅ Client ${clientId} joined room ${clientId}`);
            } else {
                console.log(`⚠️ No clientId provided in query parameters`);
            }
        } catch (error) {
            console.error(`❌ Error in handleConnection:`, error);
        }
    }

    handleDisconnect(client: Socket) {
        try {
            if (!client) {
                console.log(`⚠️ Client is undefined in handleDisconnect`);
                return;
            }

            console.log(`🔌 Client disconnected: ${client.id}`);

            // Remove client from tracking
            const clientId = [...this.clients.entries()].find(
                ([, socketId]) => socketId === client.id
            )?.[0];

            if (clientId) {
                this.clients.delete(clientId);
                console.log(`✅ Client ${clientId} removed from tracking`);
            }
        } catch (error) {
            console.error(`❌ Error in handleDisconnect:`, error);
        }
    }

    @SubscribeMessage('joinWhatsAppRoom')
    handleJoinRoom(client: Socket, @MessageBody() data: { clientId: string }) {
        try {
            if (!client) {
                console.log(`⚠️ Client is undefined in handleJoinRoom`);
                return;
            }

            const { clientId } = data;

            if (!clientId) {
                console.log(`⚠️ No clientId provided in handleJoinRoom`);
                return;
            }

            // Join the client to their specific room
            client.join(clientId);

            // Store the client mapping
            this.clients.set(clientId, client.id);

            console.log(`✅ Client ${clientId} joined WhatsApp room via event`);

            // Emit confirmation
            client.emit('joinedWhatsAppRoom', { clientId });
        } catch (error) {
            console.error(`❌ Error in handleJoinRoom:`, error);
        }
    }

    /**
     * Emit new message to a specific client
     */
    sendMessageToClient(clientId: string, message: any) {
        try {
            if (!this.server) {
                console.log(`⚠️ WebSocket server not available, skipping message to client ${clientId}`);
                return;
            }

            console.log(`📤 Sending message to client ${clientId}:`, message);

            // Emit to the specific client room
            this.server.to(clientId).emit('new_message', message);

            // Also emit to all connected clients for debugging
            this.server.emit('whatsapp_message', {
                clientId,
                message
            });
        } catch (error) {
            console.error(`❌ Error sending message to client ${clientId}:`, error);
        }
    }

    /**
     * Get connected clients (for debugging)
     */
    getConnectedClients() {
        return Array.from(this.clients.keys());
    }
}
