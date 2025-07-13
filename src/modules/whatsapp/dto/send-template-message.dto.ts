import { IsArray, IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendTemplateMessageDto {
    @IsArray()
    @IsString({ each: true })
    @ApiProperty({
        description: 'Array of phone numbers to send template message to',
        example: ['01712345678', '01812345678'],
        type: [String],
    })
    phoneNumbers: string[];

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'Template ID to use',
        example: 'template_abc123',
    })
    templateId: string;

    @IsOptional()
    @ApiProperty({
        description: 'Variables to replace in the template',
        example: { name: 'John', code: '1234' },
        required: false,
        type: Object,
        additionalProperties: { type: 'string' },
    })
    variables?: Record<string, string>;
} 