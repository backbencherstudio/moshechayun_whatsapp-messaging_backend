import { Test, TestingModule } from '@nestjs/testing';
import { BrandCustomizationController } from './brand-customization.controller';
import { BrandCustomizationService } from './brand-customization.service';

describe('BrandCustomizationController', () => {
  let controller: BrandCustomizationController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [BrandCustomizationController],
      providers: [BrandCustomizationService],
    }).compile();

    controller = module.get<BrandCustomizationController>(BrandCustomizationController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });
});
