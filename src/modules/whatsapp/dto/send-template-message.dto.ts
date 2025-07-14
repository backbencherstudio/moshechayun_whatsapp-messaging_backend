import { IsArray, IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendTemplateMessageDto {
    @IsArray()
    @IsString({ each: true })
    @ApiProperty({
        description: 'Array of contact IDs to send template message to',
        example: ['clntct123456', 'clntct654321'],
        type: [String],
    })
    contactIds: string[];

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