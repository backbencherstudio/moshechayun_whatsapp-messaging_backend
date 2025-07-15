import { Controller, Get, Param, Query } from '@nestjs/common';
import { LogService } from './log.service';
import { GetLogDto } from './dto/get-log.dto';

@Controller('logs')
export class LogController {
  constructor(private readonly logService: LogService) { }

  @Get()
  findAll(@Query() query: GetLogDto) {
    return this.logService.findAll(query);
  }

  @Get()
  findOne(@Param() id: string) {
    return this.logService.findOne(id);
  }
}
