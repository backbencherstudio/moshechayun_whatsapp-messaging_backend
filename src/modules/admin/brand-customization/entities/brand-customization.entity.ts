import { ApiProperty } from '@nestjs/swagger';

export class BrandCustomization {
    @ApiProperty({ description: 'Unique identifier for the brand customization' })
    id: string;

    @ApiProperty({ description: 'Company name' })
    company_name?: string;

    @ApiProperty({ description: 'Company slogan' })
    slogan?: string;

    @ApiProperty({ description: 'Logo file path or URL' })
    logo?: string;

    @ApiProperty({ description: 'Primary brand color in hex format' })
    primary_color?: string;

    @ApiProperty({ description: 'Secondary brand color in hex format' })
    secondary_color?: string;

    @ApiProperty({ description: 'Status of the brand customization' })
    status?: number;

    @ApiProperty({ description: 'Creation timestamp' })
    created_at: Date;

    @ApiProperty({ description: 'Last update timestamp' })
    updated_at: Date;

    @ApiProperty({ description: 'Deletion timestamp (soft delete)' })
    deleted_at?: Date;
}
