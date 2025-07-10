import { Body, Controller, Delete, Get, Param, Patch, Post, UploadedFile, UseInterceptors, UsePipes, ValidationPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ClientService } from './client.service';
import { CreateClientDto } from './dto/create-client.dto';
import { UpdateClientDto } from './dto/update-client.dto';

@Controller('clients')
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
  async findAll() {
    return this.clientService.findAll();
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

  @Get(':id/credits/history')
  getCreditHistory(@Param('id') id: string) {
    return this.clientService.getCreditHistory(id);
  }
}
