import {
  Controller,
  Get,
  Post,
  Body,
  Patch,
  Param,
  Delete,
  UseGuards,
  Request,
  HttpStatus,
  HttpCode,
  UseInterceptors,
  UsePipes,
  ValidationPipe,
  UploadedFile
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiParam,
  ApiBody
} from '@nestjs/swagger';
import { BrandCustomizationService } from './brand-customization.service';
import { CreateBrandCustomizationDto } from './dto/create-brand-customization.dto';
import { UpdateBrandCustomizationDto } from './dto/update-brand-customization.dto';
import { JwtAuthGuard } from 'src/modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from 'src/common/guard/role/roles.guard';
import { Roles } from 'src/common/guard/role/roles.decorator';
import { Role } from 'src/common/guard/role/role.enum';
import { FileInterceptor } from '@nestjs/platform-express';

@ApiTags('Brand Customization')
@Controller('brand-customization')
@UseGuards(JwtAuthGuard, RolesGuard)
@ApiBearerAuth()
export class BrandCustomizationController {
  constructor(private readonly brandCustomizationService: BrandCustomizationService) { }

  @Post()
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('logo')) // 'avatar' is the field name in the form-data
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async create(
    @Body() createBrandCustomizationDto: CreateBrandCustomizationDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.brandCustomizationService.create(createBrandCustomizationDto, file);
  }

  @Get()
  async findAll() {
    return this.brandCustomizationService.findAll();
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.brandCustomizationService.findOne(id);
  }

  @Patch(':id')
  @Roles(Role.ADMIN)
  @UseInterceptors(FileInterceptor('logo')) // 'avatar' is the field name in the form-data
  @UsePipes(new ValidationPipe({ whitelist: true }))
  async update(
    @Param('id') id: string,
    @Body() updateBrandCustomizationDto: UpdateBrandCustomizationDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    return this.brandCustomizationService.update(id, updateBrandCustomizationDto, file);
  }

  @Delete(':id')
  @Roles(Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  async remove(@Param('id') id: string): Promise<{ message: string }> {
    return this.brandCustomizationService.remove(id);
  }
}