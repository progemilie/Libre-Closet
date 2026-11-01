import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Logger,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Render,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { I18n, I18nContext } from 'nestjs-i18n';
import { ConditionalAuthGuard } from '../auth/conditional-auth.guard';
import { Payload } from '../auth/dto/payload.dto';
import { GarmentCategory } from './garment-category.enum';
import { GarmentColor } from './garment-color.enum';
import { GarmentService } from './garment.service';
import {
  canWrite,
  WardrobeAccess,
  WardrobeService,
} from '../wardrobe-share/wardrobe.service';
import type { SearchGarmentDto } from './dto/search-garment.dto';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Garments, always seen through a wardrobe. `?wardrobeId=` picks the wardrobe
 * to list; without it the user's default wardrobe opens. Garment pages work
 * out access from the garment's own wardrobe.
 */
@UseGuards(ConditionalAuthGuard)
@Controller('wardrobe')
export class WardrobeController {
  private readonly logger = new Logger(WardrobeController.name);

  constructor(
    private readonly garmentService: GarmentService,
    private readonly wardrobeService: WardrobeService,
  ) {}

  private userId(req: any): number | undefined {
    return (req['user'] as Payload | undefined)?.userId;
  }

  private parseId(value: string | undefined): number | undefined {
    const id = Number(value);
    return value && Number.isInteger(id) ? id : undefined;
  }

  /** The requested wardrobe if given (and visible), otherwise the default. */
  private async wardrobeFor(
    wardrobeId: number | undefined,
    userId?: number,
  ): Promise<WardrobeAccess> {
    if (wardrobeId != null) {
      return this.wardrobeService.access(wardrobeId, userId);
    }
    return {
      wardrobe: await this.wardrobeService.getDefault(userId),
      permission: 'OWNER',
    };
  }

  private async categoryOptions(
    i18n: I18nContext,
    userId: number | undefined,
    wardrobeId: number | undefined,
  ) {
    const filters = await this.garmentService.findAvailableFilters(
      userId,
      wardrobeId,
    );
    const enumValues = Object.values(GarmentCategory) as string[];
    const customCategories = filters.categories.filter(
      (c) => !enumValues.includes(c),
    );
    return [...enumValues, ...customCategories].map((value) => ({
      value,
      label: this.garmentService.resolveCategoryLabel(value, i18n),
    }));
  }

  @Get()
  @Render('wardrobe/index')
  async index(
    @Req() req: FastifyRequest,
    @Query() query: SearchGarmentDto,
    @Query('wardrobeId') wardrobeIdParam: string | undefined,
    @I18n() i18n: I18nContext,
  ) {
    const userId = this.userId(req);
    const { wardrobe, permission } = await this.wardrobeFor(
      this.parseId(wardrobeIdParam),
      userId,
    );

    const [garments, filters, switcher] = await Promise.all([
      this.garmentService.findAll(userId, query, wardrobe.id),
      this.garmentService.findAvailableFilters(userId, wardrobe.id),
      this.wardrobeService.switcher(userId, i18n),
    ]);
    const availableCategories = filters.categories.map((value) => ({
      value,
      label: this.garmentService.resolveCategoryLabel(value, i18n),
    }));
    const sharedEntry = switcher.shared.find((s) => s.id === wardrobe.id);

    return {
      garments,
      availableCategories,
      colors: Object.values(GarmentColor),
      availableSizes: filters.sizes,
      search: query,
      wardrobe: {
        id: wardrobe.id,
        label: WardrobeService.label(wardrobe, i18n),
        ownerName: permission === 'OWNER' ? null : sharedEntry?.ownerName,
      },
      ownWardrobes: switcher.own,
      sharedWardrobes: switcher.shared,
      showSwitcher: switcher.own.length + switcher.shared.length > 1,
      canEdit: canWrite(permission),
    };
  }

  @Get('new')
  @Render('wardrobe/form')
  async newForm(
    @Req() req: FastifyRequest,
    @I18n() i18n: I18nContext,
    @Query('wardrobeId') wardrobeIdParam: string | undefined,
  ) {
    const userId = this.userId(req);
    const { wardrobe, permission } = await this.wardrobeFor(
      this.parseId(wardrobeIdParam),
      userId,
    );
    if (!canWrite(permission)) throw new ForbiddenException();
    const [categories, wardrobeOptions] = await Promise.all([
      this.categoryOptions(i18n, userId, wardrobe.id),
      this.wardrobeService.writableOptions(userId, i18n),
    ]);
    return {
      categories,
      colors: Object.values(GarmentColor),
      garment: null,
      wardrobeOptions,
      selectedWardrobeId: wardrobe.id,
      backHref: `/wardrobe?wardrobeId=${wardrobe.id}`,
    };
  }

  @Post()
  async create(
    @Body()
    body: {
      name?: string;
      category: string;
      brand?: string;
      color?: string | string[];
      size?: string;
      notes?: string;
      washingDetails?: string;
      dateAquired?: string;
      wardrobeId?: string;
    },
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    // Fastify gives string if one checkbox, string[] if multiple — normalise both
    const rawColors = Array.isArray(body.color)
      ? body.color
      : (body.color
          ?.split(',')
          .map((c) => c.trim())
          .filter(Boolean) ?? []);

    const garment = await this.garmentService.create(
      {
        name: body.name,
        category: body.category,
        brand: body.brand,
        color: rawColors.join(','),
        size: body.size,
        notes: body.notes,
        washingDetails: body.washingDetails,
        dateAquired: body.dateAquired,
      },
      this.userId(req),
      this.parseId(body.wardrobeId),
    );

    return reply.redirect(`/wardrobe/${garment.id}?created=1`, 302);
  }

  @Get(':id')
  @Render('wardrobe/show')
  async show(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: FastifyRequest,
    @I18n() i18n: I18nContext,
    @Query('created') created: string | undefined,
    @Query('photoSaved') photoSaved: string | undefined,
  ) {
    const { garment, permission } = await this.garmentService.access(
      id,
      this.userId(req),
    );
    const wardrobe = garment.wardrobe?.unwrap();

    return {
      garment,
      categoryLabel: this.garmentService.resolveCategoryLabel(
        garment.category,
        i18n,
      ),
      wardrobeLabel: wardrobe ? WardrobeService.label(wardrobe, i18n) : null,
      backHref: wardrobe ? `/wardrobe?wardrobeId=${wardrobe.id}` : '/wardrobe',
      canEdit: canWrite(permission),
      canClone: canWrite(permission),
      canDelete: permission === 'OWNER',
      justCreated: created === '1',
      justSavedPhoto: photoSaved === '1',
    };
  }

  @Get(':id/edit')
  @Render('wardrobe/form')
  async editForm(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: FastifyRequest,
    @I18n() i18n: I18nContext,
  ) {
    const userId = this.userId(req);
    const { garment, permission } = await this.garmentService.access(
      id,
      userId,
    );
    if (!canWrite(permission)) throw new ForbiddenException();

    const ownerId = garment.owner?.id ?? null;
    const [categories, options] = await Promise.all([
      this.categoryOptions(i18n, userId, garment.wardrobe?.id),
      this.wardrobeService.writableOptions(userId, i18n),
    ]);
    const colorEnumValues = Object.values(GarmentColor) as string[];
    const savedColors =
      garment.color
        ?.split(',')
        .map((c) => c.trim())
        .filter(Boolean) ?? [];
    const customColors = savedColors.filter(
      (c) => !colorEnumValues.includes(c),
    );

    return {
      garment,
      categories,
      colors: colorEnumValues,
      customColors,
      // A garment can only move between wardrobes of its own owner
      wardrobeOptions: options.filter((o) => o.ownerId === ownerId),
      selectedWardrobeId: garment.wardrobe?.id,
      backHref: `/wardrobe/${garment.id}`,
    };
  }

  @Get(':id/clone')
  @Render('wardrobe/form')
  async cloneForm(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: FastifyRequest,
    @I18n() i18n: I18nContext,
  ) {
    const userId = this.userId(req);
    const garment = await this.garmentService.findOne(id, userId);
    const [categories, wardrobeOptions] = await Promise.all([
      this.categoryOptions(i18n, userId, garment.wardrobe?.id),
      this.wardrobeService.writableOptions(userId, i18n),
    ]);
    const sourceWardrobeId = garment.wardrobe?.id;
    return {
      garment,
      isClone: true,
      cloneName: garment.name ? `${garment.name} (cloned)` : undefined,
      categories,
      colors: Object.values(GarmentColor),
      wardrobeOptions,
      selectedWardrobeId: wardrobeOptions.some((o) => o.id === sourceWardrobeId)
        ? sourceWardrobeId
        : wardrobeOptions[0]?.id,
      backHref: `/wardrobe/${garment.id}`,
    };
  }

  @Post(':id/clone')
  async cloneCreate(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      name?: string;
      category: string;
      brand?: string;
      color?: GarmentColor;
      size?: string;
      notes?: string;
      wardrobeId?: string;
    },
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const cloned = await this.garmentService.clone(
      id,
      {
        name: body.name,
        category: body.category,
        brand: body.brand,
        color: Array.isArray(body.color) ? body.color.join(',') : body.color,
        size: body.size,
        notes: body.notes,
      },
      this.userId(req),
      this.parseId(body.wardrobeId),
    );
    return reply.redirect(`/wardrobe/${cloned.id}`, 302);
  }

  @Post(':id')
  async update(
    @Param('id', ParseIntPipe) id: number,
    @Body()
    body: {
      name?: string;
      category?: string;
      brand?: string;
      color?: GarmentColor;
      size?: string;
      notes?: string;
      washingDetails?: string;
      dateAquired?: string;
      wardrobeId?: string;
    },
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.garmentService.update(
      id,
      {
        name: body.name,
        category: body.category,
        brand: body.brand,
        color: Array.isArray(body.color) ? body.color.join(',') : body.color,
        size: body.size,
        notes: body.notes,
        washingDetails: body.washingDetails,
        dateAquired: body.dateAquired,
        wardrobeId: this.parseId(body.wardrobeId),
      },
      this.userId(req),
    );
    return reply.redirect(`/wardrobe/${id}`, 302);
  }

  @Post(':id/photo')
  async uploadPhoto(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    await this.garmentService.update(
      id,
      { files: req.files({ limits: { files: 2 } }) },
      this.userId(req),
    );
    reply.header('HX-Redirect', `/wardrobe/${id}?photoSaved=1`);
    return reply.send();
  }

  @Post(':id/archive')
  async archive(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const garment = await this.garmentService.archive(id, this.userId(req));
    const wardrobeId = garment.wardrobe?.id;
    reply.header(
      'HX-Redirect',
      wardrobeId ? `/wardrobe?wardrobeId=${wardrobeId}` : '/wardrobe',
    );
    return reply.send();
  }

  @Post(':id/nobg')
  async updateNobg(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const nobgPhoto = await req.file();
    await this.garmentService.updateNobg(id, nobgPhoto, this.userId(req));
    reply.header('HX-Redirect', `/wardrobe/${id}`);
    return reply.send();
  }

  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const wardrobeId = await this.garmentService.remove(id, this.userId(req));
    reply.header(
      'HX-Redirect',
      wardrobeId ? `/wardrobe?wardrobeId=${wardrobeId}` : '/wardrobe',
    );
    return reply.send();
  }
}
