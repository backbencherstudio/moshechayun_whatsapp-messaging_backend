import { Test, TestingModule } from '@nestjs/testing';
import { BrandCustomizationService } from './brand-customization.service';

describe('BrandCustomizationService', () => {
  let service: BrandCustomizationService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [BrandCustomizationService],
    }).compile();

    service = module.get<BrandCustomizationService>(BrandCustomizationService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });
});
