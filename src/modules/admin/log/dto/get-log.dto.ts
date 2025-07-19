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
    @Min(1)
    page?: number = 1;

    @IsOptional()
    @IsInt()
    @Min(1)
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
