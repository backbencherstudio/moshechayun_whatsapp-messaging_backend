import { IsString } from 'class-validator';

export class ConnectWhatsAppDto {
    @IsString()
    clientId: string;
}