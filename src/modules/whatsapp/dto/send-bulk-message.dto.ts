import { IsArray, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendBulkMessageDto {
    @IsArray()
    @IsString({ each: true })
    @ApiProperty({
        description: 'Array of contact IDs to send message to',
        example: ['clntct123456', 'clntct654321'],
        type: [String],
    })
    contactIds: string[];

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'Message content to send',
        example: 'Hello from WhatsApp API!',
    })
    message: string;
} 