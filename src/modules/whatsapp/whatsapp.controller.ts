import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { WhatsAppService } from './whatsapp.service';
import { MessageHandlerService } from './services/message-handler.service';
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

@ApiTags('WhatsApp')
@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class WhatsAppController {
  constructor(
    private readonly whatsappService: WhatsAppService,
    private readonly messageHandler: MessageHandlerService,
  ) { }

  // Connection Management
  @Post('connect')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Connect WhatsApp for a client' })
  @ApiResponse({ status: 200, description: 'WhatsApp connection initiated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async connectWhatsApp(@Body() connectDto: ConnectWhatsAppDto, @Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.connectWhatsApp(clientId);
  }

  @Get('qr')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Get QR code for WhatsApp connection' })
  @ApiResponse({ status: 200, description: 'QR code retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getQRCode(@Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.getQRCode(clientId);
  }

  @Get('status')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Get WhatsApp connection status' })
  @ApiResponse({ status: 200, description: 'Connection status retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getConnectionStatus(@Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.getConnectionStatus(clientId);
  }

  @Delete('disconnect')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Disconnect WhatsApp for a client' })
  @ApiResponse({ status: 200, description: 'WhatsApp disconnected successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async disconnectWhatsApp(@Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.disconnectWhatsApp(clientId);
  }

  // Messaging
  @Post('send')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Send a WhatsApp message' })
  @ApiResponse({ status: 200, description: 'Message sent successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async sendMessage(@Body() sendDto: SendMessageDto, @Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.sendMessage(clientId, sendDto.phoneNumber, sendDto.message);
  }

  @Post('send-bulk')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Send bulk WhatsApp messages' })
  @ApiResponse({ status: 200, description: 'Bulk messages sent successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async sendBulkMessage(@Body() bulkDto: SendBulkMessageDto, @Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.sendBulkMessage(clientId, bulkDto.phoneNumbers, bulkDto.message);
  }

  // Template Messaging
  @Post('send-template')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Send message using template' })
  @ApiResponse({ status: 200, description: 'Template message sent successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async sendTemplateMessage(@Body() templateDto: SendTemplateMessageDto, @Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.sendTemplateMessage(
      clientId,
      templateDto.phoneNumbers,
      templateDto.templateId,
      templateDto.variables || {}
    );
  }

  @Post('preview-template')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Preview template with variables' })
  @ApiResponse({ status: 200, description: 'Template preview generated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async previewTemplate(@Body() previewDto: PreviewTemplateDto, @Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.previewTemplate(
      clientId,
      previewDto.templateId,
      previewDto.variables || {}
    );
  }

  @Get('templates')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Get all templates for a client' })
  @ApiResponse({ status: 200, description: 'Templates retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getTemplates(@Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.getTemplates(clientId);
  }

  @Get('templates/:templateId')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Get a specific template by ID' })
  @ApiResponse({ status: 200, description: 'Template retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getTemplate(@Param('templateId') templateId: string, @Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.getTemplate(templateId, clientId);
  }

  // Credit Management
  @Get('credits')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Get client credit information' })
  @ApiResponse({ status: 200, description: 'Credit info retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getClientCredits(@Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.getClientCredits(clientId);
  }

  @Get('credits/history')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Get client credit history' })
  @ApiResponse({ status: 200, description: 'Credit history retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getCreditHistory(@Query() query: GetCreditHistoryDto, @Request() req) {
    const clientId = req.user.userId;
    const limit = query.limit || 50;
    const offset = query.offset || 0;
    return await this.whatsappService.getCreditHistory(clientId, limit, offset);
  }



  // Message Management
  @Get('messages/stats')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Get message statistics for a client' })
  @ApiResponse({ status: 200, description: 'Statistics retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getMessageStats(@Request() req) {
    const clientId = req.user.userId;
    return await this.messageHandler.getMessageStats(clientId);
  }

  // Message Handler Endpoints
  @Get('messages/conversations')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Get all conversations for a client' })
  @ApiResponse({ status: 200, description: 'Conversations retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getConversations(@Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.getConversations(clientId);
  }

  @Get('messages/conversations/:phoneNumber')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Get messages for a specific conversation' })
  @ApiResponse({ status: 200, description: 'Messages retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getConversationMessages(
    @Request() req,
    @Param('phoneNumber') phoneNumber: string,
    @Query('limit') limit: number = 50,
    @Query('offset') offset: number = 0,
  ) {
    const clientId = req.user.userId;
    return await this.whatsappService.getConversationMessages(
      clientId,
      phoneNumber,
      limit,
      offset,
    );
  }

  @Get('messages/all')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Get all messages for a client' })
  @ApiResponse({ status: 200, description: 'Messages retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getAllMessages(
    @Request() req,
    @Query('limit') limit: number = 100,
    @Query('offset') offset: number = 0,
  ) {
    const clientId = req.user.userId;
    return await this.whatsappService.getAllMessages(clientId, limit, offset);
  }

  @Get('messages/inbox')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Get inbox summary for a client' })
  @ApiResponse({ status: 200, description: 'Inbox retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async getInbox(@Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.getInbox(clientId);
  }

  @Post('messages/sync')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Manually sync all messages from WhatsApp' })
  @ApiResponse({ status: 200, description: 'Messages synced successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async syncMessages(@Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.syncAllMessages(clientId);
  }

  // Admin endpoints (for system management)
  @Get('admin/sessions')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Get active WhatsApp sessions status (Admin only)' })
  @ApiResponse({ status: 200, description: 'Sessions status retrieved successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin access required' })
  async getActiveSessionsStatus() {
    return await this.whatsappService.getActiveSessionsStatus();
  }

  @Post('admin/cleanup')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Clean up old messages for all clients (Admin only)' })
  @ApiResponse({ status: 200, description: 'Cleanup completed successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  @ApiResponse({ status: 403, description: 'Forbidden - Admin access required' })
  async cleanupAllClients() {
    return await this.whatsappService.cleanupAllClients();
  }

  // Health check endpoint
  @Get('health')
  @ApiOperation({ summary: 'Health check for WhatsApp service' })
  @ApiResponse({ status: 200, description: 'Service is healthy' })
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
