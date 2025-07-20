import { IsArray, IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendBulkMessageDto {
    @IsArray()
    @IsString({ each: true })
    @ApiProperty({
        description: 'Array of phone number to send message to',
        example: ['8801781860882', '8801781860882'],
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