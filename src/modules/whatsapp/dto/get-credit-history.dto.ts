import { IsOptional, IsNumber } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

export class GetCreditHistoryDto {
    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Transform(({ value }) => parseInt(value))
    @ApiPropertyOptional({
        description: 'Number of credit log entries to return',
        example: 50,
    })
    limit?: number;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Transform(({ value }) => parseInt(value))
    @ApiPropertyOptional({
        description: 'Number of credit log entries to skip',
        example: 0,
    })
    offset?: number;
} 