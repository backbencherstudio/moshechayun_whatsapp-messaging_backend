import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsOptional, IsHexColor, IsNumber } from 'class-validator';

export class CreateBrandCustomizationDto {
    @ApiProperty({
        description: 'Company name',
        example: 'SheildX!',
        required: false
    })
    @IsOptional()
    @IsString()
    company_name?: string;

    @ApiProperty({
        description: 'Logo file path or URL',
        example: 'uploads/logos/company-logo.png',
        required: false
    })
    @IsOptional()
    @IsString()
    logo?: string;

    @ApiProperty({
        description: 'Primary brand color in hex format',
        example: '#22C55E',
        required: false
    })
    @IsOptional()
    @IsHexColor()
    primary_color?: string;

    @ApiProperty({
        description: 'Secondary brand color in hex format',
        example: '#48B470',
        required: false
    })
    @IsOptional()
    @IsHexColor()
    secondary_color?: string;

    @ApiProperty({
        description: 'Status of the brand customization',
        example: 1,
        required: false
    })
    @IsOptional()
    @IsNumber()
    status?: number;
}
