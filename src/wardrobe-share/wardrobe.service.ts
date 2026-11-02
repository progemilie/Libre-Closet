import { EntityRepository, FilterQuery } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { I18nContext } from 'nestjs-i18n';
import { Garment } from '../dal/entity/garment.entity';
import { User } from '../dal/entity/user.entity';
import { SharePermission } from '../dal/entity/wardrobe-share.entity';
import { Wardrobe } from '../dal/entity/wardrobe.entity';
import { WardrobeShareService } from './wardrobe-share.service';

/** OWNER, or the permission of an accepted share. */
export type WardrobePermission = 'OWNER' | SharePermission;

export interface WardrobeAccess {
  wardrobe: Wardrobe;
  permission: WardrobePermission;
}

export const canWrite = (permission: WardrobePermission): boolean =>
  permission === 'OWNER' || permission === SharePermission.MANAGE;

export interface WardrobeOption {
  id: number;
  label: string;
  ownerId: number | null;
}

const MAX_NAME_LENGTH = 60;

@Injectable()
export class WardrobeService {
  constructor(
    @InjectRepository(Wardrobe)
    private readonly wardrobeRepository: EntityRepository<Wardrobe>,
    @InjectRepository(Garment)
    private readonly garmentRepository: EntityRepository<Garment>,
    private readonly shareService: WardrobeShareService,
  ) {}

  /** Display name: the default wardrobe has no name until it is renamed. */
  static label(wardrobe: Wardrobe, i18n: I18nContext): string {
    return wardrobe.name || i18n.t('lang.MY_WARDROBE');
  }

  private ownerWhere(userId?: number): FilterQuery<Wardrobe> {
    return userId != null ? { owner: { id: userId } } : { owner: null };
  }

  private isOwner(wardrobe: Wardrobe, userId?: number): boolean {
    return userId != null
      ? wardrobe.owner?.id === userId
      : wardrobe.owner == null;
  }

  private cleanName(name: string | undefined): string {
    const trimmed = (name ?? '').trim();
    if (!trimmed || trimmed.length > MAX_NAME_LENGTH) {
      throw new BadRequestException('lang.WARDROBE_NAME_INVALID');
    }
    return trimmed;
  }

  /** The wardrobe opened when the app starts, created on first use. */
  async getDefault(userId?: number): Promise<Wardrobe> {
    const existing = await this.wardrobeRepository.findOne({
      $and: [this.ownerWhere(userId), { isDefault: true }],
    });
    if (existing) return existing;

    const wardrobe = this.newWardrobe(userId);
    wardrobe.isDefault = true;
    await this.wardrobeRepository.getEntityManager().persistAndFlush(wardrobe);
    return wardrobe;
  }

  private newWardrobe(userId?: number): Wardrobe {
    const wardrobe = this.wardrobeRepository.create({} as Wardrobe);
    if (userId != null) {
      wardrobe.owner = this.wardrobeRepository
        .getEntityManager()
        .getReference(User, userId, { wrapped: true });
    }
    return wardrobe;
  }

  /** Your own wardrobes, default first. */
  async listOwn(userId?: number): Promise<Wardrobe[]> {
    await this.getDefault(userId);
    return this.wardrobeRepository.find(this.ownerWhere(userId), {
      orderBy: { isDefault: 'desc', id: 'asc' },
    });
  }

  async create(name: string, userId?: number): Promise<Wardrobe> {
    const cleaned = this.cleanName(name);
    await this.getDefault(userId);
    const wardrobe = this.newWardrobe(userId);
    wardrobe.name = cleaned;
    await this.wardrobeRepository.getEntityManager().persistAndFlush(wardrobe);
    return wardrobe;
  }

  private async owned(id: number, userId?: number): Promise<Wardrobe> {
    const wardrobe = await this.wardrobeRepository.findOne(id);
    if (!wardrobe) throw new NotFoundException('Wardrobe not found');
    if (!this.isOwner(wardrobe, userId)) throw new ForbiddenException();
    return wardrobe;
  }

  async rename(id: number, name: string, userId?: number): Promise<Wardrobe> {
    const wardrobe = await this.owned(id, userId);
    wardrobe.name = this.cleanName(name);
    await this.wardrobeRepository.getEntityManager().flush();
    return wardrobe;
  }

  async setDefault(id: number, userId?: number): Promise<void> {
    const wardrobe = await this.owned(id, userId);
    const current = await this.wardrobeRepository.find({
      $and: [this.ownerWhere(userId), { isDefault: true }],
    });
    for (const w of current) w.isDefault = false;
    wardrobe.isDefault = true;
    await this.wardrobeRepository.getEntityManager().flush();
  }

  /** Deletes an empty, non-default wardrobe and the shares that point at it. */
  async remove(id: number, userId?: number): Promise<void> {
    const wardrobe = await this.owned(id, userId);
    if (wardrobe.isDefault) {
      throw new BadRequestException('lang.WARDROBE_DELETE_DEFAULT');
    }
    if (await this.garmentRepository.count({ wardrobe: id })) {
      throw new BadRequestException('lang.WARDROBE_DELETE_NOT_EMPTY');
    }
    await this.shareService.removeForWardrobe(id);
    await this.wardrobeRepository.getEntityManager().removeAndFlush(wardrobe);
  }

  /** What `userId` may do with a wardrobe; throws when they may not see it. */
  async access(id: number, userId?: number): Promise<WardrobeAccess> {
    const wardrobe = await this.wardrobeRepository.findOne(id);
    if (!wardrobe) throw new NotFoundException('Wardrobe not found');
    if (this.isOwner(wardrobe, userId)) {
      return { wardrobe, permission: 'OWNER' };
    }
    if (userId != null) {
      const permission = await this.shareService.getSharePermission(userId, id);
      if (permission) return { wardrobe, permission };
    }
    throw new ForbiddenException();
  }

  /** Wardrobes `userId` may add garments to: their own, then shared with edit rights. */
  async writable(userId?: number): Promise<Wardrobe[]> {
    const own = await this.listOwn(userId);
    if (userId == null) return own;
    const shared = (await this.shareService.getInboundShares(userId))
      .filter((s) => s.permission === SharePermission.MANAGE && s.wardrobe)
      .map((s) => s.wardrobe!.unwrap());
    return [...own, ...shared];
  }

  /** `writable` as form options; shared wardrobes are labelled with their owner. */
  async writableOptions(
    userId: number | undefined,
    i18n: I18nContext,
  ): Promise<WardrobeOption[]> {
    const wardrobes = await this.writable(userId);
    await this.wardrobeRepository.populate(wardrobes, ['owner']);
    return wardrobes.map((w) => ({
      id: w.id,
      label: this.isOwner(w, userId)
        ? WardrobeService.label(w, i18n)
        : `${WardrobeService.label(w, i18n)} (${w.owner?.unwrap().username})`,
      ownerId: w.owner?.id ?? null,
    }));
  }

  /** Everything the wardrobe switcher shows: your wardrobes, then ones shared with you. */
  async switcher(userId: number | undefined, i18n: I18nContext) {
    const own = await this.listOwn(userId);
    const sharedIds =
      userId != null
        ? await this.shareService.getSharedWardrobeIds(userId)
        : [];
    const inbound =
      userId != null ? await this.shareService.getInboundShares(userId) : [];
    await this.wardrobeRepository.populate(
      inbound.map((s) => s.wardrobe!.unwrap()),
      ['owner'],
    );

    return {
      own: own.map((w) => ({
        id: w.id,
        label: WardrobeService.label(w, i18n),
        isDefault: w.isDefault,
        isShared: sharedIds.includes(w.id),
      })),
      shared: inbound
        .filter((s) => s.wardrobe)
        .map((s) => {
          const w = s.wardrobe!.unwrap();
          return {
            id: w.id,
            label: WardrobeService.label(w, i18n),
            ownerName: w.owner?.unwrap().username,
            permission: s.permission,
          };
        }),
    };
  }

  /** Garment count per wardrobe id. */
  async countGarments(wardrobeIds: number[]): Promise<Map<number, number>> {
    const counts = new Map<number, number>();
    for (const id of wardrobeIds) {
      counts.set(id, await this.garmentRepository.count({ wardrobe: id }));
    }
    return counts;
  }
}
