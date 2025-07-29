import { Transfer } from 'aws-sdk';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsInt, Min, IsDateString } from 'class-validator';

export class GetLogDto {
    @IsOptional()
    @IsString()
    clientId?: string;

    @IsOptional()
    @IsString()
    type?: string;

    @IsOptional()
    @IsInt()
    @Transform(({ value }) => parseInt(value))
    page?: number = 1;

    @IsOptional()
    @IsInt()
    @Transform(({ value }) => parseInt(value))
    pageSize?: number = 20;

    @IsOptional()
    @IsDateString()
    startDate?: string;

    @IsOptional()
    @IsDateString()
    endDate?: string;

    @IsOptional()
    @IsString()
    receiver?: string;

    @IsOptional()
    @IsString()
    status?: string;
}
