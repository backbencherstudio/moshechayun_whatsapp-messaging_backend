import { Module, forwardRef } from '@nestjs/common';
import { WhatsAppService } from './whatsapp.service';
import { WhatsAppController } from './whatsapp.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { WhatsAppGateway } from './whatsapp.gateway';
import { MessageHandlerService } from './services/message-handler.service';
import { PBXService } from './pbx/pbx.service';

@Module({
  imports: [PrismaModule],
  controllers: [WhatsAppController],
  providers: [
    WhatsAppService,
    WhatsAppGateway,
    MessageHandlerService,
    PBXService,
  ],
  exports: [WhatsAppService, WhatsAppGateway, MessageHandlerService, PBXService],
})
export class WhatsAppModule { }
