import { Controller, Get, Query } from '@nestjs/common';
import { LogService } from './log.service';
import { GetLogDto } from './dto/get-log.dto';

@Controller('logs')
export class LogController {
  constructor(private readonly logService: LogService) { }

  @Get()
  findAll(@Query() query: GetLogDto) {
    return this.logService.findAll(query);
  }
}
