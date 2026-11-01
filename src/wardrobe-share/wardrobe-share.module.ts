import { MikroOrmModule } from '@mikro-orm/nestjs';
import { Module } from '@nestjs/common';
import { WardrobeShare } from '../dal/entity/wardrobe-share.entity';
import { User } from '../dal/entity/user.entity';
import { Wardrobe } from '../dal/entity/wardrobe.entity';
import { Garment } from '../dal/entity/garment.entity';
import { AuthModule } from '../auth/auth.module';
import { WardrobeShareController } from './wardrobe-share.controller';
import { WardrobeShareService } from './wardrobe-share.service';
import { WardrobeService } from './wardrobe.service';
import { WardrobesController } from './wardrobes.controller';

@Module({
  imports: [
    MikroOrmModule.forFeature([WardrobeShare, User, Wardrobe, Garment]),
    AuthModule,
  ],
  controllers: [WardrobeShareController, WardrobesController],
  providers: [WardrobeShareService, WardrobeService],
  exports: [WardrobeShareService, WardrobeService],
})
export class WardrobeShareModule {}
