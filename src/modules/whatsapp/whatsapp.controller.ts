import { Body, Controller, Delete, Get, Param, Post, UsePipes, ValidationPipe, Query } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { ConnectWhatsAppDto } from './dto/connect-whatsapp.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SendTemplateMessageDto } from './dto/send-template-message.dto';
import { PrismaService } from 'src/prisma/prisma.service';
import { WhatsAppGateway } from './whatsapp.gateway';
import { ApiTags, ApiOperation, ApiResponse, ApiQuery } from '@nestjs/swagger';

@ApiTags('WhatsApp')
@Controller('whatsapp')
export class WhatsAppController {
  constructor(
    private readonly whatsAppService: WhatsAppService,
    private readonly prisma: PrismaService,
    private readonly whatsAppGateway: WhatsAppGateway,
  ) { }

  @Post('connect')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async connect(@Body() dto: ConnectWhatsAppDto) {
    return this.whatsAppService.connectWhatsApp(dto.clientId);
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

  @Post('send-template')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  @ApiOperation({ summary: 'Send message using a template' })
  @ApiResponse({ status: 200, description: 'Template message sent successfully' })
  async sendTemplateMessage(@Body() dto: SendTemplateMessageDto) {
    return this.whatsAppService.sendTemplateMessage(
      dto.clientId,
      dto.phoneNumbers,
      dto.templateId,
      dto.variables || {}
    );
  }

  @Get(':clientId/templates')
  @ApiOperation({ summary: 'Get all templates for a client' })
  @ApiResponse({ status: 200, description: 'Templates retrieved successfully' })
  async getTemplates(@Param('clientId') clientId: string) {
    return this.whatsAppService.getTemplates(clientId);
  }

  @Get(':clientId/templates/:templateId')
  @ApiOperation({ summary: 'Get a specific template' })
  @ApiResponse({ status: 200, description: 'Template retrieved successfully' })
  async getTemplate(
    @Param('clientId') clientId: string,
    @Param('templateId') templateId: string
  ) {
    return this.whatsAppService.getTemplate(templateId, clientId);
  }

  @Post(':clientId/templates/:templateId/preview')
  @ApiOperation({ summary: 'Preview template with variables' })
  @ApiResponse({ status: 200, description: 'Template preview generated' })
  async previewTemplate(
    @Param('clientId') clientId: string,
    @Param('templateId') templateId: string,
    @Body() body: { variables?: Record<string, string> }
  ) {
    return this.whatsAppService.previewTemplate(
      clientId,
      templateId,
      body.variables || {}
    );
  }

  @Get(':clientId/qr')
  async getQRCode(@Param('clientId') clientId: string) {
    return this.whatsAppService.getQRCode(clientId);
  }

  @Get(':clientId/status')
  async getStatus(@Param('clientId') clientId: string) {
    return this.whatsAppService.getConnectionStatus(clientId);
  }

  @ApiOperation({ summary: 'Disconnect WhatsApp for a client' })
  @ApiResponse({ status: 200, description: 'WhatsApp disconnected' })
  @Delete(':clientId/disconnect')
  async disconnect(@Param('clientId') clientId: string) {
    return this.whatsAppService.disconnectWhatsApp(clientId);
  }

  @Get(':clientId/messages')
  async getMessages(@Param('clientId') clientId: string) {
    const messages = await this.prisma.message.findMany({
      where: { clientId },
      orderBy: { timestamp: 'desc' },
    });
    return { success: true, data: messages };
  }

  @Get(':clientId/conversations')
  async getConversations(@Param('clientId') clientId: string) {
    return this.whatsAppService.getConversations(clientId);
  }

  @Get(':clientId/conversations/:phoneNumber/messages')
  @ApiQuery({ name: 'limit', required: false, description: 'Number of messages to return' })
  @ApiQuery({ name: 'offset', required: false, description: 'Number of messages to skip' })
  async getConversationMessages(
    @Param('clientId') clientId: string,
    @Param('phoneNumber') phoneNumber: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.whatsAppService.getConversationMessages(
      clientId,
      phoneNumber,
      limit ? parseInt(limit) : 50,
      offset ? parseInt(offset) : 0
    );
  }

  @Get(':clientId/inbox')
  async getInbox(@Param('clientId') clientId: string) {
    return this.whatsAppService.getInbox(clientId);
  }

  @Get('websocket-status')
  async getWebSocketStatus() {
    return {
      success: true,
      message: 'WebSocket gateway status',
      data: {
        connectedClients: this.whatsAppGateway.getConnectedClients(),
        gatewayActive: true,
      },
    };
  }

  @Get('active-sessions')
  async getActiveSessions() {
    return this.whatsAppService.getActiveSessionsStatus();
  }
}
