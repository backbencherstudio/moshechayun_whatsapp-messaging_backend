import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, IsNumber } from 'class-validator';

export class CreateClientDto {
    @IsString()
    name: string;

    @IsEmail()
    email: string;

    @IsString()
    password: string;

    @IsOptional()
    @IsString()
    phone_number?: string;

    @IsOptional()
    @IsString()
    website?: string;

    @IsOptional()
    @IsString()
    user_type?: string;

    @IsOptional()
    @IsString()
    avatar?: string;

    @IsOptional()
    @IsNumber()
    @Transform(({ value }) => Number(value))
    credits?: number;
}
