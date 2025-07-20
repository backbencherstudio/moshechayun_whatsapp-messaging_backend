import { IsString, IsNotEmpty, IsOptional, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum MessageType {
    TEXT = 'text',
    IMAGE = 'image',
    AUDIO = 'audio',
    VIDEO = 'video',
    DOCUMENT = 'document',
    LOCATION = 'location',
    CONTACT = 'contact',
    STICKER = 'sticker'
}

export class SendMessageDto {
    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'phone number',
        example: '8801792239958',
    })
    phoneNumber: string;

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'Message content to send',
        example: 'Hello from WhatsApp API!',
    })
    message: string;

    @IsOptional()
    @IsEnum(MessageType)
    @ApiPropertyOptional({
        description: 'Type of message to send',
        enum: MessageType,
        default: MessageType.TEXT,
    })
    type?: MessageType = MessageType.TEXT;

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
        description: 'Media URL for media messages',
        example: 'https://example.com/image.jpg',
    })
    mediaUrl?: string;
}