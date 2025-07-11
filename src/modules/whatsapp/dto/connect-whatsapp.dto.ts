import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ConnectWhatsAppDto {
    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'Client ID for WhatsApp connection',
        example: 'client123',
    })
    clientId: string;
}