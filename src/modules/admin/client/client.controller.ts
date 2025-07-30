import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UploadedFile, UseGuards, UseInterceptors, UsePipes, ValidationPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClientService } from './client.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';
import { SearchClientDto } from './dto/search-client.dto';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';

@Controller('clients')
@UseGuards(JwtAuthGuard)
@Roles(Role.ADMIN)
export class ClientController {
  constructor(private readonly clientService: ClientService) { }

  @Post()
  @UseInterceptors(FileInterceptor('avatar')) // 'avatar' is the field name in the form-data
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async create(
    @Body() createClientDto: CreateClientDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.clientService.create(createClientDto, file);
  }

  @Get()
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  async findAll(@Query() searchParams: SearchClientDto) {
    return this.clientService.findAll(searchParams);
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.clientService.findOne(id);
  }

  @Patch(':id')
  @UseInterceptors(FileInterceptor('avatar'))
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async update(
    @Param('id') id: string,
    @Body() updateClientDto: UpdateClientDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.clientService.update(id, updateClientDto, file);
  }

  @Delete(':id')
  async remove(@Param('id') id: string) {
    return this.clientService.remove(id);
  }

  @Post(':id/credits/increment')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  incrementCredits(
    @Param('id') id: string,
    @Body('amount') amount: number,
    @Body('description') description?: string,
  ) {
    console.log("amount", amount)
    return this.clientService.incrementCredits(id, amount, description);
  }

  @Post(':id/credits/decrement')
  @UsePipes(new ValidationPipe({ whitelist: true }))
  decrementCredits(
    @Param('id') id: string,
    @Body('amount') amount: number,
    @Body('description') description?: string,
  ) {
    return this.clientService.decrementCredits(id, amount, description);
  }

  @Get('/credits/history')
  getClientCreditHistory(
    @Param('clientId') clientId: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
    @Query('type') type?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const start = startDate ? new Date(startDate) : undefined;
    const end = endDate ? new Date(endDate) : undefined;
    const parsedPage = page ? parseInt(page, 10) : 1;
    const parsedLimit = limit ? parseInt(limit, 10) : 20;
    return this.clientService.getClientCreditHistory(start, end, type, parsedPage, parsedLimit);
  }

  @Get(':id/credits')
  async getMessageCredits(@Param('id') id: string) {
    return this.clientService.getMessageCredits(id);
  }
}
