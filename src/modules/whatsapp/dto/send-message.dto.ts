import { IsString, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendMessageDto {
    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'Phone number to send message to',
        example: '01712345678',
    })
    phoneNumber: string;

    @IsNotEmpty()
    @IsString()
    @ApiProperty({
        description: 'Message content to send',
        example: 'Hello from WhatsApp API!',
    })
    message: string;
}