import { EntityRepository, FilterQuery, ref } from '@mikro-orm/core';
import { InjectRepository } from '@mikro-orm/nestjs';
import { randomUUID } from 'node:crypto';
import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { I18nContext } from 'nestjs-i18n';
import { Garment } from '../dal/entity/garment.entity';
import { File } from '../dal/entity/file.entity';
import { Wardrobe } from '../dal/entity/wardrobe.entity';
import { FileService } from '../file/file-service.abstract';
import { MultipartFile } from '@fastify/multipart';
import { CreateGarmentDto } from './dto/create-garment.dto';
import { UpdateGarmentDto } from './dto/update-garment.dto';
import { SearchGarmentDto } from './dto/search-garment.dto';
import { GarmentCategory } from './garment-category.enum';
import {
  canWrite,
  WardrobePermission,
  WardrobeService,
} from '../wardrobe-share/wardrobe.service';

export interface GarmentAccess {
  garment: Garment;
  permission: WardrobePermission;
}

const CANONICAL_SIZES = [
  'XX-Small',
  'X-Small',
  'Small',
  'Medium',
  'Large',
  'X-Large',
  'XX-Large',
  '3X-Large',
  '4X-Large',
  '5X-Large',
];

@Injectable()
export class GarmentService {
  private readonly logger = new Logger(GarmentService.name);

  constructor(
    @InjectRepository(Garment)
    private readonly garmentRepository: EntityRepository<Garment>,
    private readonly fileService: FileService,
    private readonly wardrobeService: WardrobeService,
  ) {}

  private ownerWhere(userId?: number): FilterQuery<Garment> {
    return userId != null ? { owner: { id: userId } } : { owner: null };
  }

  private inWardrobe(wardrobe: Wardrobe): FilterQuery<Garment> {
    if (!wardrobe.isDefault) return { wardrobe: wardrobe.id };
    // A garment that has lost its wardrobe falls back to its owner's default
    return {
      $or: [
        { wardrobe: wardrobe.id },
        {
          wardrobe: null,
          owner: wardrobe.owner ? { id: wardrobe.owner.id } : null,
        },
      ],
    };
  }

  /** A wardrobe `userId` may add garments to; their default when none is given. */
  private async writableWardrobe(
    wardrobeId: number | undefined,
    userId?: number,
  ): Promise<Wardrobe> {
    if (wardrobeId == null) return this.wardrobeService.getDefault(userId);
    const { wardrobe, permission } = await this.wardrobeService.access(
      wardrobeId,
      userId,
    );
    if (!canWrite(permission)) throw new ForbiddenException();
    return wardrobe;
  }

  resolveCategoryLabel(value: string, i18n: I18nContext): string {
    const normalized = value.toLowerCase();
    if ((Object.values(GarmentCategory) as string[]).includes(normalized)) {
      return i18n.t(`lang.CATEGORY_${normalized.toUpperCase()}`);
    }
    return value;
  }

  /**
   * Garments in one wardrobe (checking `userId` may see it), or, without a
   * wardrobe, all of `userId`'s own garments across their wardrobes.
   */
  async findAll(
    userId?: number,
    dto: SearchGarmentDto = {},
    wardrobeId?: number,
  ): Promise<Garment[]> {
    const normalizedSize = this.normalizeSize(dto.size);
    const searchConditions: FilterQuery<Garment> = {
      ...(dto.category ? { category: dto.category } : {}),
      ...(dto.color ? { color: dto.color } : {}),
      ...(normalizedSize ? { size: normalizedSize } : {}),
      ...(dto.archived !== 'true' ? { archived: false } : {}),
      ...(dto.keyword
        ? {
            $or: [
              { name: { $like: `%${dto.keyword}%` } },
              { notes: { $like: `%${dto.keyword}%` } },
              { brand: { $like: `%${dto.keyword}%` } },
            ],
          }
        : {}),
    };

    const scope =
      wardrobeId != null
        ? this.inWardrobe(
            (await this.wardrobeService.access(wardrobeId, userId)).wardrobe,
          )
        : // AUTH_ENABLED=false: ownerless garments only
          this.ownerWhere(userId);
    return this.garmentRepository.find(
      { $and: [scope, searchConditions] },
      { populate: ['photo'], orderBy: { id: 'DESC' } },
    );
  }

  /** A garment and what `userId` may do with it; throws when they may not see it. */
  async access(id: number, userId?: number): Promise<GarmentAccess> {
    const garment = await this.garmentRepository.findOne(id, {
      populate: ['photo', 'outfits', 'wardrobe'],
    });
    if (!garment) throw new NotFoundException('Garment not found');
    const isOwner =
      userId != null ? garment.owner?.id === userId : garment.owner == null;
    if (isOwner) return { garment, permission: 'OWNER' };
    if (userId != null && garment.wardrobe) {
      const { permission } = await this.wardrobeService.access(
        garment.wardrobe.id,
        userId,
      );
      return { garment, permission };
    }
    throw new ForbiddenException();
  }

  async findOne(id: number, userId?: number): Promise<Garment> {
    return (await this.access(id, userId)).garment;
  }

  private async writable(id: number, userId?: number): Promise<Garment> {
    const { garment, permission } = await this.access(id, userId);
    if (!canWrite(permission)) throw new ForbiddenException();
    return garment;
  }

  private async owned(id: number, userId?: number): Promise<Garment> {
    const { garment, permission } = await this.access(id, userId);
    if (permission !== 'OWNER') throw new ForbiddenException();
    return garment;
  }

  async findOneByShareableId(shareableId: string): Promise<Garment> {
    const garment = await this.garmentRepository.findOne(
      { shareableId },
      { populate: ['photo'] },
    );
    if (!garment) throw new NotFoundException('Garment not found');
    return garment;
  }

  /**
   * Adds a garment to a wardrobe `userId` may write to (their default if none
   * is given). The garment belongs to the wardrobe's owner.
   */
  async create(
    dto: CreateGarmentDto,
    userId?: number,
    wardrobeId?: number,
  ): Promise<Garment> {
    let photo: File | undefined = undefined;
    if (dto.files) {
      for await (const file of dto.files) {
        if (file.fieldname === 'photo') {
          photo = await this.fileService.storeImageFromFileUpload(file, userId);
        } else {
          file.file.resume();
        }
      }
    }

    const garment = this.garmentRepository.create({
      name: dto.name,
      category: dto.category,
      brand: dto.brand,
      color: dto.color,
      size: this.normalizeSize(dto.size),
      notes: dto.notes,
      washingDetails: dto.washingDetails,
      dateAquired: dto.dateAquired ? new Date(dto.dateAquired) : undefined,
      photo: photo ?? undefined,
    });

    const wardrobe = await this.writableWardrobe(wardrobeId, userId);
    garment.owner = wardrobe.owner;
    garment.wardrobe = ref(wardrobe);

    await this.garmentRepository.getEntityManager().persistAndFlush(garment);
    return garment;
  }

  /** Copies a garment `userId` can see into a wardrobe they may write to. */
  async clone(
    sourceId: number,
    dto: {
      name?: string;
      category: string;
      brand?: string;
      color?: string;
      size?: string;
      notes?: string;
    },
    userId?: number,
    wardrobeId?: number,
  ): Promise<Garment> {
    const source = await this.findOne(sourceId, userId);
    const wardrobe = await this.writableWardrobe(wardrobeId, userId);

    let photo: File | undefined;
    if (source.photo?.fileName) {
      photo = await this.fileService.copyImage(source.photo.fileName, userId);
      if (photo) {
        const nobgSourceName = this.fileService.nobgFileName(
          source.photo.fileName,
        );
        const nobgStream = await this.fileService
          .get(nobgSourceName)
          .catch(() => undefined);
        if (nobgStream) {
          await this.fileService
            .storeNobgVariantFromStream(nobgStream, photo.fileName)
            .catch((err) => this.logger.warn(err));
        }
      }
    }

    const garment = this.garmentRepository.create({
      name: dto.name,
      category: dto.category,
      brand: dto.brand,
      color: dto.color as any,
      size: this.normalizeSize(dto.size),
      notes: dto.notes,
      photo: photo ?? undefined,
    });
    garment.owner = wardrobe.owner;
    garment.wardrobe = ref(wardrobe);

    await this.garmentRepository.getEntityManager().persistAndFlush(garment);
    return garment;
  }

  /**
   * Filter values from one wardrobe (so a shared view never hints at private
   * items), or from all of `userId`'s own garments.
   */
  async findAvailableFilters(
    userId?: number,
    wardrobeId?: number,
  ): Promise<{
    brands: string[];
    sizes: string[];
    categories: string[];
  }> {
    const where =
      wardrobeId != null
        ? this.inWardrobe(
            (await this.wardrobeService.access(wardrobeId, userId)).wardrobe,
          )
        : this.ownerWhere(userId);
    const garments = await this.garmentRepository.find(where);

    const brands = [
      ...new Set(garments.map((g) => g.brand).filter(Boolean) as string[]),
    ].sort();
    const allSizes = [
      ...new Set(garments.map((g) => g.size).filter(Boolean) as string[]),
    ];
    const sizes = allSizes.sort((a, b) => {
      const ai = CANONICAL_SIZES.indexOf(a);
      const bi = CANONICAL_SIZES.indexOf(b);
      if (ai === -1 && bi === -1) return a.localeCompare(b);
      if (ai === -1) return 1;
      if (bi === -1) return -1;
      return ai - bi;
    });

    const categories = [
      ...new Set(garments.map((g) => g.category).filter(Boolean)),
    ].sort();

    return { brands, sizes, categories };
  }

  /**
   * Edits a garment `userId` may write to. `dto.wardrobeId` moves it to another
   * wardrobe of the same owner, which changes who can see it.
   */
  async update(
    id: number,
    dto: UpdateGarmentDto,
    userId?: number,
  ): Promise<Garment> {
    let photo: File | undefined;
    if (dto.files) {
      // Process file uploads BEFORE any async DB operations.
      // @fastify/multipart yields live streams; if a stream isn't consumed,
      // the parser backpressures and the async iterator hangs. Each file's
      // pipeline must be started (not awaited) inside the loop so busboy can
      // advance to the next part.
      //
      // IMPORTANT: photo and nobgPhoto pipelines must be started concurrently,
      // not sequentially. Both come from the same multipart request body —
      // awaiting one before starting the other would hang the iterator.
      let photoPromise: Promise<File> | undefined;
      let nobgPromise: Promise<void> | undefined;
      const photoFileName = `${randomUUID()}.webp`;

      for await (const file of dto.files) {
        if (file.fieldname === 'photo') {
          photoPromise = this.fileService.storeImageFromFileUpload(
            file,
            userId,
            photoFileName,
          );
        } else if (file.fieldname === 'nobgPhoto') {
          nobgPromise = this.fileService.storeNobgVariantFromStream(
            file.file,
            photoFileName,
          );
        } else {
          file.file.resume();
        }
      }

      if (photoPromise) {
        [photo] = await Promise.all([
          photoPromise,
          nobgPromise ?? Promise.resolve(),
        ]);
      }
    }

    const garment = await this.writable(id, userId);

    if (dto.wardrobeId != null && dto.wardrobeId !== garment.wardrobe?.id) {
      const target = await this.writableWardrobe(dto.wardrobeId, userId);
      // Garments never change owner by moving between wardrobes
      if ((target.owner?.id ?? null) !== (garment.owner?.id ?? null)) {
        throw new ForbiddenException();
      }
      garment.wardrobe = ref(target);
    }

    if (photo) {
      await this.deleteOldPhoto(garment);
      garment.photo = photo as any;
    }

    garment.name = dto.name ?? garment.name;
    garment.category = dto.category ?? garment.category;
    if ('brand' in dto) garment.brand = dto.brand;
    if ('color' in dto) garment.color = dto.color;
    if ('size' in dto) garment.size = this.normalizeSize(dto.size);
    if ('notes' in dto) garment.notes = dto.notes;
    if ('washingDetails' in dto) garment.washingDetails = dto.washingDetails;
    if ('dateAquired' in dto)
      garment.dateAquired = dto.dateAquired
        ? new Date(dto.dateAquired)
        : undefined;

    await this.garmentRepository.getEntityManager().flush();
    return garment;
  }

  private async deleteOldPhoto(garment: Garment) {
    const oldFileName = garment.photo?.fileName;
    if (oldFileName) {
      await this.fileService
        .delete(oldFileName)
        .catch((err) => this.logger.warn(err));
      const nobgFileName = this.fileService.nobgFileName(oldFileName);
      await this.fileService
        .delete(nobgFileName)
        .catch((err) => this.logger.warn(err));
    }
  }

  async updateNobg(
    id: number,
    nobgPhoto: MultipartFile | undefined,
    userId?: number,
  ): Promise<void> {
    const garment = await this.writable(id, userId);
    if (!garment.photo?.fileName) return;
    await this.streamNobgIfPresent(nobgPhoto, garment.photo.fileName);
  }

  private streamNobgIfPresent(
    nobgPhoto: MultipartFile | undefined,
    photoFileName: string,
  ): Promise<void> {
    if (!nobgPhoto) return Promise.resolve();
    const fileStream = nobgPhoto.file;
    return this.fileService.storeNobgVariantFromStream(
      fileStream,
      photoFileName,
    );
  }

  /** Deletes a garment; owner only. Returns the wardrobe it was in. */
  async remove(id: number, userId?: number): Promise<number | undefined> {
    const garment = await this.owned(id, userId);
    const wardrobeId = garment.wardrobe?.id;
    await this.garmentRepository.getEntityManager().removeAndFlush(garment);
    return wardrobeId;
  }

  async archive(id: number, userId?: number): Promise<Garment> {
    const garment = await this.owned(id, userId);
    garment.archived = !garment.archived;
    await this.garmentRepository.getEntityManager().flush();
    return garment;
  }

  private normalizeSize(input?: string): string | undefined {
    if (!input) return undefined;
    const s = input
      .trim()
      .toLowerCase()
      .replace(/[\s-]+/g, '');
    if (['xxxxxl', '5xl', '5xlarge', 'xxxxxlarge'].includes(s))
      return '5X-Large';
    if (['xxxxl', '4xl', '4xlarge', 'xxxxlarge'].includes(s)) return '4X-Large';
    if (['xxxl', '3xl', '3xlarge', 'xxxlarge'].includes(s)) return '3X-Large';
    if (['xxl', '2xl', '2xlarge', 'xxlarge'].includes(s)) return 'XX-Large';
    if (['xl', 'xlarge'].includes(s)) return 'X-Large';
    if (['l', 'large'].includes(s)) return 'Large';
    if (['m', 'medium'].includes(s)) return 'Medium';
    if (['s', 'small'].includes(s)) return 'Small';
    if (['xs', 'xsmall'].includes(s)) return 'X-Small';
    if (['xxs', '2xs', '2xsmall', 'xxsmall'].includes(s)) return 'XX-Small';
    return input.trim();
  }
}
