# WhatsApp Message Handling System

This document describes the comprehensive message handling system for the WhatsApp messaging backend.

## Overview

The message handling system consists of several components that work together to process, store, and manage WhatsApp messages:

- **MessageHandlerService**: Core service for processing incoming and outgoing messages
- **MessageController**: REST API endpoints for message operations
- **DTOs**: Data transfer objects for message validation
- **WebSocket Gateway**: Real-time message delivery

## Architecture

```
┌─────────────────┐    ┌──────────────────┐    ┌─────────────────┐
│   WhatsApp      │    │   Message        │    │   WebSocket     │
│   Web.js        │───▶│   Handler        │───▶│   Gateway       │
│   Client        │    │   Service        │    │                 │
└─────────────────┘    └──────────────────┘    └─────────────────┘
                                │
                                ▼
                       ┌──────────────────┐
                       │   Database       │
                       │   (Prisma)       │
                       └──────────────────┘
```

## Components

### 1. MessageHandlerService

The core service responsible for processing all message operations.

#### Key Methods:

- `handleIncomingMessage(clientId, message)`: Processes incoming WhatsApp messages
- `handleOutgoingMessage(clientId, sendDto, sentMessage)`: Processes outgoing messages
- `extractMessageData(message)`: Extracts comprehensive data from WhatsApp messages
- `processMessageByType(clientId, message, messageData)`: Processes messages based on type
- `getMessageStats(clientId)`: Gets message statistics

#### Message Types Supported:

- **Text Messages**: Standard chat messages
- **Media Messages**: Images, videos, audio, documents, stickers
- **Location Messages**: GPS coordinates and descriptions
- **Contact Messages**: Contact sharing

### 2. MessageController

REST API endpoints for message operations.

#### Endpoints:

```
POST   /whatsapp/messages/send           # Send single message
POST   /whatsapp/messages/send-bulk      # Send bulk messages
GET    /whatsapp/messages/conversations  # Get all conversations
GET    /whatsapp/messages/conversations/:phoneNumber  # Get conversation messages
GET    /whatsapp/messages/all            # Get all messages
GET    /whatsapp/messages/inbox          # Get inbox summary
GET    /whatsapp/messages/stats          # Get message statistics
POST   /whatsapp/messages/sync           # Manual message sync
GET    /whatsapp/messages/credits        # Get credit info
GET    /whatsapp/messages/credits/history # Get credit history
```

### 3. DTOs (Data Transfer Objects)

#### SendMessageDto

```typescript
{
  phoneNumber: string;      // Recipient phone number
  message: string;          // Message content
  type?: MessageType;       // Message type (text, image, etc.)
  caption?: string;         // Caption for media messages
  mediaUrl?: string;        // URL for media files
}
```

#### ReceiveMessageDto

```typescript
{
  messageId: string;        // Unique message ID
  from: string;            // Sender phone number
  to?: string;             // Recipient phone number
  body: string;            // Message content
  type?: string;           // Message type
  timestamp: string;       // Message timestamp
  direction?: MessageDirection; // INBOUND or OUTBOUND
  status?: MessageStatus;  // Message status
  mediaUrl?: string;       // Media URL
  caption?: string;        // Media caption
  fileName?: string;       // File name
  fileSize?: string;       // File size
  mimeType?: string;       // MIME type
}
```

## Message Flow

### Incoming Message Flow

1. **WhatsApp Web.js** receives a message
2. **MessageHandlerService.handleIncomingMessage()** is called
3. **Duplicate Check**: Verifies message doesn't already exist
4. **Data Extraction**: Extracts comprehensive message data
5. **Database Storage**: Saves message to database
6. **Type Processing**: Processes message based on type (text, media, etc.)
7. **WebSocket Emission**: Sends real-time update to connected clients
8. **Logging**: Logs the message operation

### Outgoing Message Flow

1. **API Request** is received via MessageController
2. **Credit Check**: Verifies client has sufficient credits
3. **WhatsApp Send**: Sends message via WhatsApp Web.js
4. **MessageHandlerService.handleOutgoingMessage()** is called
5. **Database Storage**: Saves sent message to database
6. **Credit Deduction**: Deducts credits from client account
7. **WebSocket Emission**: Sends real-time update to connected clients
8. **Logging**: Logs the message operation

## Message Types and Processing

### Text Messages

- Stored with `type: 'chat'`
- Processed for keyword detection (extensible)
- Support for auto-replies (extensible)

### Media Messages

- **Images**: `type: 'image'`, MIME: `image/jpeg`
- **Videos**: `type: 'video'`, MIME: `video/mp4`
- **Audio**: `type: 'audio'`, MIME: `audio/ogg`
- **Documents**: `type: 'document'`, MIME: `application/octet-stream`
- **Stickers**: `type: 'sticker'`, MIME: `image/webp`

### Location Messages

- GPS coordinates extraction
- Description handling
- Location data logging

## Database Schema

### Message Model

```sql
CREATE TABLE messages (
  id STRING PRIMARY KEY,
  clientId STRING NOT NULL,
  from STRING,
  to STRING,
  body STRING,
  type STRING,
  timestamp DATETIME,
  messageId STRING UNIQUE,
  direction STRING, -- 'INBOUND' or 'OUTBOUND'
  created_at DATETIME DEFAULT NOW(),
  updated_at DATETIME DEFAULT NOW(),
  deleted_at DATETIME
);
```

### Credit System

- **Credit Check**: Before sending any message
- **Credit Deduction**: After successful message sending
- **Credit History**: Tracks all credit transactions
- **Insufficient Credits**: Prevents message sending

## Real-time Features

### WebSocket Events

#### Message Received

```javascript
{
  type: 'message_received',
  messageId: '3EB0C767D094B528A2',
  from: '8801748399004@c.us',
  to: '8801748399005@c.us',
  body: 'Hello!',
  timestamp: 1702454400,
  messageType: 'chat',
  direction: 'INBOUND',
  savedMessageId: 'msg_123'
}
```

#### Message Sent

```javascript
{
  type: 'message_sent',
  messageId: '3EB0C767D094B528A3',
  from: '8801748399005@c.us',
  to: '8801748399004@c.us',
  body: 'Hi there!',
  timestamp: 1702454400,
  messageType: 'chat',
  direction: 'OUTBOUND',
  savedMessageId: 'msg_124'
}
```

## Error Handling

### Common Error Scenarios

1. **Duplicate Messages**: Automatically detected and skipped
2. **Network Issues**: Retry logic with exponential backoff
3. **Credit Insufficiency**: Clear error message with current balance
4. **WhatsApp Disconnection**: Automatic reconnection attempts
5. **Invalid Phone Numbers**: Format validation and error messages

### Error Logging

All errors are logged to the database with:

- Error message and stack trace
- Context information
- Timestamp
- Client ID

## Security Features

### Authentication

- JWT-based authentication required for all endpoints
- Role-based access control (CLIENT role required)

### Validation

- Input validation using class-validator
- Phone number format validation
- Message content validation
- Credit validation before sending

### Rate Limiting

- Built-in rate limiting for API endpoints
- WhatsApp Web.js rate limiting compliance

## Performance Optimizations

### Message Cleanup

- Automatic cleanup of old messages (keeps 20 most recent)
- Periodic cleanup for all clients
- Database optimization

### Caching

- Client session caching
- Message statistics caching
- Conversation list caching

### Database Optimization

- Indexed queries for message retrieval
- Efficient pagination
- Optimized message grouping

## Monitoring and Analytics

### Message Statistics

- Total messages per client
- Inbound vs outbound messages
- Media vs text messages
- Success/failure rates

### Credit Analytics

- Credit usage patterns
- Credit history tracking
- Low credit alerts

### System Health

- Active session monitoring
- Connection status tracking
- Error rate monitoring

## API Examples

### Send Message

```bash
curl -X POST http://localhost:3000/whatsapp/messages/send \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "phoneNumber": "01712345678",
    "message": "Hello from WhatsApp API!",
    "type": "text"
  }'
```

### Get Conversations

```bash
curl -X GET http://localhost:3000/whatsapp/messages/conversations \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### Get Message Statistics

```bash
curl -X GET http://localhost:3000/whatsapp/messages/stats \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

## Configuration

### Environment Variables

```env
# Database
DATABASE_URL=postgresql://user:password@localhost:5432/whatsapp_db

# JWT
JWT_SECRET=your_jwt_secret

# WhatsApp Web.js
PUPPETEER_EXECUTABLE_PATH=/usr/bin/google-chrome
```

### Service Configuration

```typescript
// WhatsApp client configuration
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
    ],
  },
});
```

## Troubleshooting

### Common Issues

1. **QR Code Not Generating**

   - Check WhatsApp Web.js client initialization
   - Verify puppeteer configuration
   - Check for existing sessions

2. **Messages Not Sending**

   - Verify client credits
   - Check WhatsApp connection status
   - Review error logs

3. **WebSocket Disconnections**

   - Check CORS configuration
   - Verify client authentication
   - Review network connectivity

4. **Database Errors**
   - Check database connection
   - Verify schema migrations
   - Review Prisma configuration

### Debug Mode

Enable debug logging:

```typescript
// In WhatsAppService
private readonly logger = new Logger(WhatsAppService.name);
this.logger.debug('Debug message');
```

## Future Enhancements

### Planned Features

- Message templates with variables
- Auto-reply system
- Message scheduling
- Advanced analytics dashboard
- Multi-language support
- Message encryption
- File upload support
- Group message handling

### Scalability Improvements

- Redis caching layer
- Message queue system
- Horizontal scaling support
- Load balancing
- Database sharding

## Support

For technical support or questions about the message handling system, please refer to:

- API Documentation: `/api/docs`
- Logs: Database `logs` table
- Error Tracking: Application logs
- GitHub Issues: Project repository
