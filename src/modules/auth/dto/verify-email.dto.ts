import { IsEmail, IsNotEmpty, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class VerifyEmailDto {
  @IsNotEmpty()
  @IsEmail()
  @ApiProperty({
    description: 'Email address',
    example: 'user@example.com',
  })
  email: string;

  @IsNotEmpty()
  @IsString()
  @ApiProperty({
    description: 'Verification token',
    example: 'verification-token-here',
  })
  token: string;
}
