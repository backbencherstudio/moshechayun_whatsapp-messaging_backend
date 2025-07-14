import { IsOptional, IsNumber } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type, Transform } from 'class-transformer';

export class GetAllMessagesDto {
    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Transform(({ value }) => parseInt(value))
    @ApiPropertyOptional({
        description: 'Number of messages to return',
        example: 100,
    })
    limit?: number;

    @IsOptional()
    @IsNumber()
    @Type(() => Number)
    @Transform(({ value }) => parseInt(value))
    @ApiPropertyOptional({
        description: 'Number of messages to skip',
        example: 0,
    })
    offset?: number;
} 