import { IsOptional, IsString, IsInt, Min } from 'class-validator';

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
}
