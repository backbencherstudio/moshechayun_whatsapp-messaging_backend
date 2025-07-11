import { IsString, IsArray, IsOptional, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendMessageDto {
    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'Client ID for WhatsApp connection',
        example: 'client123',
    })
    clientId: string;

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

    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Message template (optional)',
        example: 'template_name',
        required: false,
    })
    template?: string;
}