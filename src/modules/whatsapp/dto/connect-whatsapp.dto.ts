import { IsString, IsNotEmpty, IsOptional } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConnectWhatsAppDto {
    @IsOptional()
    @IsString()
    @ApiProperty({
        description: 'Client ID for WhatsApp connection',
        example: 'client123',
    })
    clientId: string;
}