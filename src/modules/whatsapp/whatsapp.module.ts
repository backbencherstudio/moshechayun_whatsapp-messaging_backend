import { Module } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { WhatsAppGateway } from './whatsapp.gateway';
import { MessageHandlerService } from './services/message-handler.service';

@Module({
  imports: [PrismaModule],
  controllers: [WhatsAppController],
  providers: [WhatsAppService, WhatsAppGateway, MessageHandlerService],
  exports: [WhatsAppService, WhatsAppGateway, MessageHandlerService],
})
export class WhatsAppModule { }
