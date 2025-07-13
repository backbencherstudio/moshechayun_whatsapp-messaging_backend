import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../common/guard/role/roles.guard';
import { Roles } from '../../common/guard/role/roles.decorator';
import { Role } from '../../common/guard/role/role.enum';
import { ConnectWhatsAppDto } from './dto/connect-whatsapp.dto';
import { SendMessageDto } from './dto/send-message.dto';
import { SendBulkMessageDto } from './dto/send-bulk-message.dto';
import { SendTemplateMessageDto } from './dto/send-template-message.dto';
import { PreviewTemplateDto } from './dto/preview-template.dto';
import { GetConversationMessagesDto } from './dto/get-conversation-messages.dto';
import { GetCreditHistoryDto } from './dto/get-credit-history.dto';
import { GetAllMessagesDto } from './dto/get-all-messages.dto';

@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
export class WhatsAppController {
  constructor(private readonly whatsappService: WhatsAppService) { }

  // Connection Management
  @Post('connect')
  @Roles(Role.CLIENT)
  async connectWhatsApp(@Body() connectDto: ConnectWhatsAppDto, @Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    return await this.whatsappService.connectWhatsApp(clientId);
  }

  @Get('qr')
  @Roles(Role.CLIENT)
  async getQRCode(@Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    return await this.whatsappService.getQRCode(clientId);
  }

  @Get('status')
  @Roles(Role.CLIENT)
  async getConnectionStatus(@Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    return await this.whatsappService.getConnectionStatus(clientId);
  }

  @Delete('disconnect')
  @Roles(Role.CLIENT)
  async disconnectWhatsApp(@Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    return await this.whatsappService.disconnectWhatsApp(clientId);
  }

  // Messaging
  @Post('send')
  @Roles(Role.CLIENT)
  async sendMessage(@Body() sendDto: SendMessageDto, @Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    return await this.whatsappService.sendMessage(clientId, sendDto.phoneNumber, sendDto.message);
  }

  @Post('send-bulk')
  @Roles(Role.CLIENT)
  async sendBulkMessage(@Body() bulkDto: SendBulkMessageDto, @Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    return await this.whatsappService.sendBulkMessage(clientId, bulkDto.phoneNumbers, bulkDto.message);
  }

  // Template Messaging
  @Post('send-template')
  @Roles(Role.CLIENT)
  async sendTemplateMessage(@Body() templateDto: SendTemplateMessageDto, @Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    return await this.whatsappService.sendTemplateMessage(
      clientId,
      templateDto.phoneNumbers,
      templateDto.templateId,
      templateDto.variables || {}
    );
  }

  @Post('preview-template')
  @Roles(Role.CLIENT)
  async previewTemplate(@Body() previewDto: PreviewTemplateDto, @Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    return await this.whatsappService.previewTemplate(
      clientId,
      previewDto.templateId,
      previewDto.variables || {}
    );
  }

  @Get('templates')
  @Roles(Role.CLIENT)
  async getTemplates(@Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    return await this.whatsappService.getTemplates(clientId);
  }

  @Get('templates/:templateId')
  @Roles(Role.CLIENT)
  async getTemplate(@Param('templateId') templateId: string, @Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    return await this.whatsappService.getTemplate(templateId, clientId);
  }

  // Credit Management
  @Get('credits')
  @Roles(Role.CLIENT)
  async getClientCredits(@Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    return await this.whatsappService.getClientCredits(clientId);
  }

  @Get('credits/history')
  @Roles(Role.CLIENT)
  async getCreditHistory(@Query() query: GetCreditHistoryDto, @Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    const limit = query.limit || 50;
    const offset = query.offset || 0;
    return await this.whatsappService.getCreditHistory(clientId, limit, offset);
  }

  // Conversations and Messages
  @Get('conversations')
  @Roles(Role.CLIENT)
  async getConversations(@Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    return await this.whatsappService.getConversations(clientId);
  }

  @Get('conversations/:phoneNumber/messages')
  @Roles(Role.CLIENT)
  async getConversationMessages(
    @Param('phoneNumber') phoneNumber: string,
    @Query() query: GetConversationMessagesDto,
    @Request() req
  ) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    const limit = query.limit || 50;
    const offset = query.offset || 0;
    return await this.whatsappService.getConversationMessages(clientId, phoneNumber, limit, offset);
  }

  @Get('inbox')
  @Roles(Role.CLIENT)
  async getInbox(@Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    return await this.whatsappService.getInbox(clientId);
  }

  @Get('messages')
  @Roles(Role.CLIENT)
  async getAllMessages(@Query() query: GetAllMessagesDto, @Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    const limit = query.limit || 100;
    const offset = query.offset || 0;
    return await this.whatsappService.getAllMessages(clientId, limit, offset);
  }

  // Message Synchronization
  @Post('sync-messages')
  @Roles(Role.CLIENT)
  async syncAllMessages(@Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    return await this.whatsappService.syncAllMessages(clientId);
  }

  // Message Management
  @Get('messages/stats')
  @Roles(Role.CLIENT)
  async getMessageStats(@Request() req) {
    const clientId = "cmcx59ehz0000wsi4wgfl55ak";
    return await this.whatsappService.getMessageStats(clientId);
  }

  // Admin endpoints (for system management)
  @Get('admin/sessions')
  @Roles(Role.ADMIN)
  async getActiveSessionsStatus() {
    return await this.whatsappService.getActiveSessionsStatus();
  }

  @Post('admin/cleanup')
  @Roles(Role.ADMIN)
  async cleanupAllClients() {
    return await this.whatsappService.cleanupAllClients();
  }

  // Health check endpoint
  @Get('health')
  async healthCheck() {
    return {
      success: true,
      data: {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        service: 'WhatsApp Service',
      },
    };
  }
}
