import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateContactDto {

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Last name',
    example: 'Doe',
  })
  name: string;

  @IsNotEmpty()
  @IsEmail()
  @ApiProperty({
    description: 'Email',
    example: 'john.doe@example.com',
  })
  email: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Phone number',
    example: '+1234567890',
  })
  phone_number?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Message',
    example: 'Hello, I have a question about your product.',
  })
  message: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Client ID',
    example: 'client123',
  })
  clientId: string;
}
