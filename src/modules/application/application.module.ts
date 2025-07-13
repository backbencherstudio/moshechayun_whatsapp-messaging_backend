import { Module } from '@nestjs/common';
import { NotificationModule } from './notification/notification.module';
import { FaqModule } from './faq/faq.module';

@Module({
  imports: [NotificationModule, FaqModule],
})
export class ApplicationModule { }
