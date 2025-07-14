import { IsEmail, IsNotEmpty, IsOptional, IsString, IsNumber, IsUrl } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class CreateContactDto {

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'First name',
    example: 'John',
    required: false,
  })
  first_name?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Last name',
    example: 'Doe',
    required: false,
  })
  last_name?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Full name',
    example: 'John Doe',
    required: false,
  })
  name?: string;

  @IsOptional()
  @IsEmail()
  @ApiProperty({
    description: 'Email address',
    example: 'john.doe@example.com',
    required: false,
  })
  email?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Phone number',
    example: '+1234567890',
    required: false,
  })
  phone_number?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Role or designation',
    example: 'Customer',
    required: false,
  })
  role?: string;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'Message or notes',
    example: 'Hello, I have a question about your product.',
    required: false,
  })
  message?: string;

  @IsOptional()
  @IsUrl()
  @ApiProperty({
    description: 'Avatar URL',
    example: 'https://example.com/avatar.jpg',
    required: false,
  })
  avatar?: string;

  @IsOptional()
  @IsNumber()
  @ApiProperty({
    description: 'Status (1 for active, 0 for inactive)',
    example: 1,
    default: 1,
    required: false,
  })
  status?: number;

  @IsOptional()
  @IsString()
  @ApiProperty({
    description: 'WhatsApp number',
    example: '+1234567890',
    required: false,
  })
  whatsappNumber?: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Client ID',
    example: 'client123',
  })
  clientId: string;
}
