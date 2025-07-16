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
    }

    handleConnection(client: Socket) {


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
    }

    handleDisconnect(client: Socket) {
        console.log(`🔌 Client disconnected: ${client.id}`);

        // Remove client from tracking
        const clientId = [...this.clients.entries()].find(
            ([, socketId]) => socketId === client.id
        )?.[0];

        if (clientId) {
            this.clients.delete(clientId);
            console.log(`✅ Client ${clientId} removed from tracking`);
        }
    }

    @SubscribeMessage('joinWhatsAppRoom')
    handleJoinRoom(client: Socket, @MessageBody() data: { clientId: string }) {
        const { clientId } = data;

        // Join the client to their specific room
        client.join(clientId);

        // Store the client mapping
        this.clients.set(clientId, client.id);

        console.log(`✅ Client ${clientId} joined WhatsApp room via event`);

        // Emit confirmation
        client.emit('joinedWhatsAppRoom', { clientId });
    }

    /**
     * Emit new message to a specific client
     */
    sendMessageToClient(clientId: string, message: any) {
        console.log(`📤 Sending message to client ${clientId}:`, message);

        // Emit to the specific client room
        this.server.to(clientId).emit('new_message', message);

        // Also emit to all connected clients for debugging
        this.server.emit('whatsapp_message', {
            clientId,
            message
        });
    }

    /**
     * Get connected clients (for debugging)
     */
    getConnectedClients() {
        return Array.from(this.clients.keys());
    }
}
