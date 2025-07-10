import { IsEmail, IsOptional, IsString } from 'class-validator';

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
    avatar?: string;
}
