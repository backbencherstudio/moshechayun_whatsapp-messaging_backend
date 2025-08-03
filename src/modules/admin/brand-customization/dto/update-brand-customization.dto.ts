import { PartialType } from '@nestjs/swagger';
import { CreateBrandCustomizationDto } from './create-brand-customization.dto';

export class UpdateBrandCustomizationDto extends PartialType(CreateBrandCustomizationDto) {}
