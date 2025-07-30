import { Controller, Get, Post, Body, Patch, Param, Delete, Query, UseGuards, Request, UsePipes, ValidationPipe } from '@nestjs/common';
import { TemplateService } from './template.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { UpdateTemplateDto } from './dto/update-template.dto';
import { SearchTemplateDto } from './dto/search-template.dto';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { Role } from 'src/common/guard/role/role.enum';
import { Roles } from 'src/common/guard/role/roles.decorator';

@UseGuards(JwtAuthGuard)
@Controller('templates')
@Roles(Role.ADMIN, Role.CLIENT)
export class TemplateController {
  constructor(private readonly templateService: TemplateService) { }

  @Post()
  create(@Body() dto: CreateTemplateDto, @Request() req) {
    const userId = req.user.userId;
    return this.templateService.create(dto, userId);
  }

  @Get()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  findAll(@Query('clientId') clientId: string, @Query() searchParams: SearchTemplateDto) {
    return this.templateService.findAll(clientId, searchParams);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.templateService.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateTemplateDto) {
    return this.templateService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.templateService.remove(id);
  }
}
