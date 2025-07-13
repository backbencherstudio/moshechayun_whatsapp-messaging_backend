import { IsArray, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendBulkMessageDto {
    @IsArray()
    @IsString({ each: true })
    @ApiProperty({
        description: 'Array of phone numbers to send message to',
        example: ['01712345678', '01812345678'],
        type: [String],
    })
    phoneNumbers: string[];

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'Message content to send',
        example: 'Hello from WhatsApp API!',
    })
    message: string;
} 