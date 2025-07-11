import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

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

    @IsString()
    @IsOptional()
    variables?: string;
}
