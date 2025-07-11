import { Body, Controller, Delete, Get, Param, Post, UsePipes, ValidationPipe } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { ConnectWhatsAppDto } from './dto/connect-whatsapp.dto';
import { SendMessageDto } from './dto/send-message.dto';

@Controller('whatsapp')
export class WhatsAppController {
  constructor(private readonly whatsAppService: WhatsAppService) { }

  @Post('connect')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async connect(@Body() dto: ConnectWhatsAppDto) {
    return this.whatsAppService.connectWhatsApp(dto.clientId);
  }

  @Get(':clientId/qr')
  async getQRCode(@Param('clientId') clientId: string) {
    return this.whatsAppService.getQRCode(clientId);
  }

  @Get(':clientId/status')
  async getStatus(@Param('clientId') clientId: string) {
    return this.whatsAppService.getConnectionStatus(clientId);
  }

  @Post('send')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async sendMessage(@Body() dto: SendMessageDto) {
    if (dto.phoneNumbers.length === 1) {
      return this.whatsAppService.sendMessage(
        dto.clientId,
        dto.phoneNumbers[0],
        dto.message
      );
    } else {
      return this.whatsAppService.sendBulkMessage(
        dto.clientId,
        dto.phoneNumbers,
        dto.message
      );
    }
  }

  @Delete(':clientId/disconnect')
  async disconnect(@Param('clientId') clientId: string) {
    return this.whatsAppService.disconnectWhatsApp(clientId);
  }
}
