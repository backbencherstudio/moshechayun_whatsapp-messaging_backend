import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Query,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ContactService } from './contact.service';
import { CreateContactDto } from './dto/create-contact.dto';
import { UpdateContactDto } from './dto/update-contact.dto';
import { ApiBearerAuth, ApiOperation, ApiTags, ApiQuery, ApiParam, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { Roles } from '../../../common/guard/role/roles.decorator';
import { Role } from '../../../common/guard/role/role.enum';
import { RolesGuard } from '../../../common/guard/role/roles.guard';

@ApiBearerAuth()
@ApiTags('contact')
@Controller('contact')
export class ContactController {
  constructor(private readonly contactService: ContactService) { }

  @ApiOperation({ summary: 'Create contact' })
  @ApiConsumes('multipart/form-data')
  @Post()
  @UseInterceptors(FileInterceptor('avatar'))
  async create(
    @Body() createContactDto: CreateContactDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    try {
      const contact = await this.contactService.create(createContactDto, file);
      return contact;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @ApiOperation({ summary: 'Read all contacts' })
  @ApiQuery({ name: 'q', required: false, description: 'Search query' })
  @ApiQuery({ name: 'status', required: false, description: 'Filter by status' })
  @ApiQuery({ name: 'clientId', required: false, description: 'Filter by client ID' })
  @Get()
  async findAll(@Query() query: { q?: string; status?: number; clientId?: string }) {
    try {
      const searchQuery = query.q;
      const status = query.status;
      const clientId = query.clientId;

      const contacts = await this.contactService.findAll({
        q: searchQuery,
        status: status,
        clientId: clientId,
      });
      return contacts;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @ApiOperation({ summary: 'Read one contact' })
  @ApiParam({ name: 'id', description: 'Contact ID' })
  @Get(':id')
  async findOne(@Param('id') id: string) {
    try {
      const contact = await this.contactService.findOne(id);
      return contact;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @ApiOperation({ summary: 'Update contact' })
  @ApiParam({ name: 'id', description: 'Contact ID' })
  @ApiConsumes('multipart/form-data')
  @Patch(':id')
  @UseInterceptors(FileInterceptor('avatar'))
  async update(
    @Param('id') id: string,
    @Body() updateContactDto: UpdateContactDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    try {
      const contact = await this.contactService.update(id, updateContactDto, file);
      return contact;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }

  @ApiOperation({ summary: 'Delete contact' })
  @ApiParam({ name: 'id', description: 'Contact ID' })
  @Delete(':id')
  async remove(@Param('id') id: string) {
    try {
      const contact = await this.contactService.remove(id);
      return contact;
    } catch (error) {
      return {
        success: false,
        message: error.message,
      };
    }
  }
}
