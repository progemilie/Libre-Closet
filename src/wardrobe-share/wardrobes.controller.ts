import {
  BadRequestException,
  Body,
  Controller,
  Get,
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
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ConditionalAuthGuard } from '../auth/conditional-auth.guard';
import { Payload } from '../auth/dto/payload.dto';
import { WardrobeShareService } from './wardrobe-share.service';
import { WardrobeService } from './wardrobe.service';

/** Create, rename, choose the default for, and delete your wardrobes. */
@UseGuards(ConditionalAuthGuard)
@Controller('wardrobes')
export class WardrobesController {
  constructor(
    private readonly wardrobeService: WardrobeService,
    private readonly shareService: WardrobeShareService,
  ) {}

  private userId(req: any): number | undefined {
    return (req['user'] as Payload | undefined)?.userId;
  }

  @Get()
  @Render('wardrobes/index')
  async index(
    @Req() req: FastifyRequest,
    @I18n() i18n: I18nContext,
    @Query('error') error: string | undefined,
  ) {
    const userId = this.userId(req);
    const wardrobes = await this.wardrobeService.listOwn(userId);
    const [counts, sharedIds] = await Promise.all([
      this.wardrobeService.countGarments(wardrobes.map((w) => w.id)),
      userId != null
        ? this.shareService.getSharedWardrobeIds(userId)
        : Promise.resolve<number[]>([]),
    ]);

    return {
      wardrobes: wardrobes.map((w) => {
        const garmentCount = counts.get(w.id) ?? 0;
        return {
          id: w.id,
          name: w.name ?? '',
          label: WardrobeService.label(w, i18n),
          isDefault: w.isDefault,
          isShared: sharedIds.includes(w.id),
          garmentCount,
          canDelete: !w.isDefault && garmentCount === 0,
        };
      }),
      error: error ?? null,
    };
  }

  /** Runs a change and returns to the list, showing a translated error if it is refused. */
  private async thenBack(
    reply: FastifyReply,
    req: FastifyRequest,
    i18n: I18nContext,
    change: () => Promise<unknown>,
  ) {
    let target = '/wardrobes';
    try {
      await change();
    } catch (e) {
      if (!(e instanceof BadRequestException)) throw e;
      target += `?error=${encodeURIComponent(i18n.t(e.message))}`;
    }
    if (req.headers['hx-request']) {
      reply.header('HX-Redirect', target);
      return reply.send();
    }
    return reply.redirect(target, 302);
  }

  @Post()
  async create(
    @Body() body: { name?: string },
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @I18n() i18n: I18nContext,
  ) {
    return this.thenBack(reply, req, i18n, () =>
      this.wardrobeService.create(body.name ?? '', this.userId(req)),
    );
  }

  @Post(':id/rename')
  async rename(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { name?: string },
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @I18n() i18n: I18nContext,
  ) {
    return this.thenBack(reply, req, i18n, () =>
      this.wardrobeService.rename(id, body.name ?? '', this.userId(req)),
    );
  }

  @Post(':id/default')
  async setDefault(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @I18n() i18n: I18nContext,
  ) {
    return this.thenBack(reply, req, i18n, () =>
      this.wardrobeService.setDefault(id, this.userId(req)),
    );
  }

  @Post(':id/delete')
  async remove(
    @Param('id', ParseIntPipe) id: number,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
    @I18n() i18n: I18nContext,
  ) {
    return this.thenBack(reply, req, i18n, () =>
      this.wardrobeService.remove(id, this.userId(req)),
    );
  }
}
