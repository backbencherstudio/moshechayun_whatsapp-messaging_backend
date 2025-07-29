import { Controller, Get, Post, Put, Delete, Body, Param, Query, UseGuards, Request, UseInterceptors, UploadedFile } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth, ApiConsumes } from '@nestjs/swagger';
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
import { GetCreditHistoryDto } from './dto/get-credit-history.dto';
import { FileInterceptor } from '@nestjs/platform-express';

@ApiTags('WhatsApp')
@Controller('whatsapp')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class WhatsAppController {
  constructor(
    private readonly whatsappService: WhatsAppService,
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

  @Post('qr/regenerate')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Regenerate QR code for WhatsApp connection' })
  @ApiResponse({ status: 200, description: 'QR code regenerated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async regenerateQRCode(@Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.regenerateQRCode(clientId);
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

  @Post('send-file')
  @Roles(Role.CLIENT)
  @UseInterceptors(FileInterceptor('file'))
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Send a file via WhatsApp' })
  @ApiResponse({ status: 200, description: 'File sent successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async sendFileMessage(
    @Body() body: any,
    @Request() req,
    @UploadedFile() file: Express.Multer.File
  ) {
    const clientId = req.user.userId;
    return await this.whatsappService.sendFileMessage(clientId, body.phoneNumber, file, body.caption);
  }

  @Post('send-template')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Send a template message' })
  @ApiResponse({ status: 200, description: 'Template message sent successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async sendTemplateMessage(@Body() templateDto: SendTemplateMessageDto, @Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.sendTemplateMessage(
      clientId,
      templateDto.phoneNumbers,
      templateDto.templateId,
      templateDto.variables
    );
  }

  @Post('preview-template')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Preview a template message' })
  @ApiResponse({ status: 200, description: 'Template preview generated successfully' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async previewTemplate(@Body() previewDto: PreviewTemplateDto, @Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.previewTemplate(
      clientId,
      previewDto.templateId,
      previewDto.variables
    );
  }

  // Conversations and Messages
  @Get('conversations')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Get all conversations' })
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
    @Query('page') page: number = 1,
    @Query('limit') limit: number = 20,
  ) {
    const clientId = req.user.userId;
    return await this.whatsappService.getConversationMessages(clientId, phoneNumber, limit, 0, page);
  }

  @Post('messages/conversations/:phoneNumber/mark-read')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Mark messages as read for a conversation' })
  @ApiResponse({ status: 200, description: 'Messages marked as read successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async markMessagesAsRead(
    @Request() req,
    @Param('phoneNumber') phoneNumber: string,
  ) {
    const clientId = req.user.userId;
    return await this.whatsappService.markMessagesAsRead(clientId, phoneNumber);
  }

  // Sync and Maintenance
  @Post('sync')
  @Roles(Role.CLIENT)
  @ApiOperation({ summary: 'Sync messages from WhatsApp' })
  @ApiResponse({ status: 200, description: 'Messages synced successfully' })
  @ApiResponse({ status: 401, description: 'Unauthorized' })
  async syncMessages(@Request() req) {
    const clientId = req.user.userId;
    return await this.whatsappService.syncAllMessages(clientId);
  }
}
