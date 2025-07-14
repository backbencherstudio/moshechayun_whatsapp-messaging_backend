import { IsString, IsNotEmpty, IsOptional, IsArray, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateTemplateDto {
    @IsString()
    @IsNotEmpty()
    name: string;

    @IsString()
    @IsNotEmpty()
    content: string;

    @IsString()
    @IsNotEmpty()
    clientId: string;

    @IsString()
    @IsNotEmpty()
    businessType: string;

    @IsString()
    @IsOptional()
    category?: string;

    @IsOptional()
    @Transform(({ value }) => Array.isArray(value) ? JSON.stringify(value) : value)
    @IsString()
    variables?: string;
}
