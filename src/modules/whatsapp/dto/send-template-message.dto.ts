import { IsString, IsArray, IsOptional, IsNotEmpty, IsObject } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendTemplateMessageDto {
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
        description: 'Template ID to use for the message',
        example: 'template_123',
    })
    templateId: string;

    @IsOptional()
    @IsObject()
    @ApiProperty({
        description: 'Variables to replace in the template',
        example: { name: 'John', company: 'ABC Corp' },
        required: false,
    })
    variables?: Record<string, string>;
} 