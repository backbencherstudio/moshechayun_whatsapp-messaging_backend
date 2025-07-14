import { IsString, IsNotEmpty, IsOptional, IsEnum, IsDateString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum MessageDirection {
    INBOUND = 'INBOUND',
    OUTBOUND = 'OUTBOUND'
}

export enum MessageStatus {
    PENDING = 'PENDING',
    SENT = 'SENT',
    DELIVERED = 'DELIVERED',
    READ = 'READ',
    FAILED = 'FAILED'
}

export class ReceiveMessageDto {
    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'Unique message ID from WhatsApp',
        example: '3EB0C767D094B528A2',
    })
    messageId: string;

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'Phone number of the sender',
        example: '8801748399004@c.us',
    })
    from: string;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({
        description: 'Phone number of the recipient',
        example: '8801748399005@c.us',
    })
    to?: string;

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'Message content',
        example: 'Hello! How are you?',
    })
    body: string;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({
        description: 'Type of message',
        example: 'chat',
    })
    type?: string;

    @IsNotEmpty()
    @IsDateString()
    @ApiProperty({
        description: 'Timestamp when message was received',
        example: '2024-12-12T10:30:00.000Z',
    })
    timestamp: string;

    @IsOptional()
    @IsEnum(MessageDirection)
    @ApiPropertyOptional({
        description: 'Message direction',
        enum: MessageDirection,
        default: MessageDirection.INBOUND,
    })
    direction?: MessageDirection = MessageDirection.INBOUND;

    @IsOptional()
    @IsEnum(MessageStatus)
    @ApiPropertyOptional({
        description: 'Message status',
        enum: MessageStatus,
        default: MessageStatus.PENDING,
    })
    status?: MessageStatus = MessageStatus.PENDING;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({
        description: 'Media URL if message contains media',
        example: 'https://example.com/image.jpg',
    })
    mediaUrl?: string;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({
        description: 'Caption for media messages',
        example: 'Check out this image!',
    })
    caption?: string;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({
        description: 'File name for document messages',
        example: 'document.pdf',
    })
    fileName?: string;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({
        description: 'File size in bytes',
        example: '1024',
    })
    fileSize?: string;

    @IsOptional()
    @IsString()
    @ApiPropertyOptional({
        description: 'MIME type of the file',
        example: 'image/jpeg',
    })
    mimeType?: string;
} 