import { IsString, IsArray, IsOptional } from 'class-validator';

export class SendMessageDto {
    @IsString()
    clientId: string;

    @IsArray()
    @IsString({ each: true })
    phoneNumbers: string[];

    @IsString()
    message: string;

    @IsOptional()
    @IsString()
    template?: string;
}