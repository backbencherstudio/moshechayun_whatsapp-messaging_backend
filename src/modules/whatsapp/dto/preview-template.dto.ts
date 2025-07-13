import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class PreviewTemplateDto {
    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'Template ID to preview',
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