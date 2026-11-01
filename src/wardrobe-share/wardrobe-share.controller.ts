import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Logger,
  NotFoundException,
  Param,
  ParseIntPipe,
  Post,
  Query,
  Render,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard';
import { ConditionalAuthGuard } from '../auth/conditional-auth.guard';
import { Payload } from '../auth/dto/payload.dto';
import { User } from '../auth/user.decorator';
import { WardrobeShareService } from './wardrobe-share.service';
import { WardrobeService } from './wardrobe.service';
import { SharePermission } from '../dal/entity/wardrobe-share.entity';
import { I18n, I18nContext } from 'nestjs-i18n';
import type { FastifyReply, FastifyRequest } from 'fastify';

@UseGuards(ConditionalAuthGuard)
@Controller('wardrobe-share')
export class WardrobeShareController {
  private readonly logger = new Logger(WardrobeShareController.name);

  constructor(
    private readonly shareService: WardrobeShareService,
    private readonly wardrobeService: WardrobeService,
  ) {}

  @UseGuards(AuthGuard)
  @Get('manage')
  @Render('wardrobe-share/manage')
  async manage(
    @User() payload: Payload,
    @Req() req: FastifyRequest,
    @Query('error') error: string | undefined,
    @I18n() i18n: I18nContext,
  ) {
    const [outbound, inbound, pending, wardrobes] = await Promise.all([
      this.shareService.getOutboundShares(payload.userId),
      this.shareService.getInboundShares(payload.userId),
      this.shareService.getPendingShares(payload.userId),
      this.wardrobeService.listOwn(payload.userId),
    ]);

    const mapShare = (s: any) => {
      const wardrobe = s.wardrobe?.unwrap?.() ?? s.wardrobe;
      return {
        id: s.id,
        grantor: s.grantor?.unwrap?.() ?? s.grantor,
        grantee: s.grantee?.unwrap?.() ?? s.grantee,
        wardrobeId: wardrobe?.id,
        wardrobeLabel: wardrobe ? WardrobeService.label(wardrobe, i18n) : '',
        permission: s.permission,
        inviteToken: s.inviteToken,
        acceptedAt: s.acceptedAt,
      };
    };

    return {
      wardrobes: wardrobes.map((w) => ({
        id: w.id,
        label: WardrobeService.label(w, i18n),
        isDefault: w.isDefault,
      })),
      outbound: outbound.map(mapShare),
      inbound: inbound.map(mapShare),
      pending: pending.map(mapShare),
      baseUrl: `${req.protocol}://${req.headers.host}`,
      error: error ?? null,
    };
  }

  @UseGuards(AuthGuard)
  @Post('create-invite-link')
  async createInviteLink(
    @User() payload: Payload,
    @Body() body: { permission: SharePermission; wardrobeId?: string },
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const wardrobeId = body.wardrobeId
      ? parseInt(body.wardrobeId, 10)
      : (await this.wardrobeService.getDefault(payload.userId)).id;
    const share = await this.shareService.createInviteLink(
      payload.userId,
      wardrobeId,
      body.permission || SharePermission.VIEW,
    );
    const inviteUrl = `${req.protocol}://${req.headers.host}/wardrobe-share/invite/${share.inviteToken}`;

    if (req.headers['hx-request']) {
      return reply.viewPartial('wardrobe-share/partials/invite-link-result', {
        inviteUrl,
      });
    }

    return reply.redirect('/wardrobe-share/manage', 302);
  }

  @UseGuards(AuthGuard)
  @Post(':id/remove')
  async removeShare(
    @User() payload: Payload,
    @Param('id', ParseIntPipe) shareId: number,
    @Res() reply: FastifyReply,
  ) {
    await this.shareService.removeShare(shareId, payload.userId);
    return reply.redirect('/wardrobe-share/manage', 302);
  }

  @UseGuards(ConditionalAuthGuard)
  @Get('invite/:token')
  @Render('wardrobe-share/invite')
  async viewInvite(
    @Param('token') token: string,
    @User() payload: Payload | undefined,
    @I18n() i18n: I18nContext,
  ) {
    const share = await this.shareService.findInviteByToken(token);
    if (!share) {
      return { error: true, message: 'Invite not found or has expired.' };
    }

    const permissionLabel =
      share.permission === SharePermission.VIEW ? 'View only' : 'Can edit';

    return {
      share,
      permissionLabel,
      grantorName:
        share.grantor.unwrap().firstName ||
        share.grantor.unwrap().email ||
        'A user',
      wardrobeLabel: share.wardrobe
        ? WardrobeService.label(share.wardrobe.unwrap(), i18n)
        : '',
      token,
      isLoggedIn: !!payload,
    };
  }

  @UseGuards(AuthGuard)
  @Post('invite/:token/accept')
  async acceptInvite(
    @User() payload: Payload,
    @Param('token') token: string,
    @Res() reply: FastifyReply,
  ) {
    try {
      await this.shareService.acceptInvite(token, payload.userId);
    } catch (e) {
      if (
        e instanceof BadRequestException ||
        e instanceof ForbiddenException ||
        e instanceof NotFoundException
      ) {
        return reply.redirect(
          `/wardrobe-share/manage?error=${encodeURIComponent(e.message)}`,
          302,
        );
      }
      this.logger.warn(e);
    }
    return reply.redirect('/wardrobe-share/manage', 302);
  }

  @UseGuards(AuthGuard)
  @Post('invite/:token/decline')
  async declineInvite(
    @User() payload: Payload,
    @Param('token') token: string,
    @Res() reply: FastifyReply,
  ) {
    try {
      await this.shareService.declineInvite(token, payload.userId);
    } catch (e) {
      this.logger.warn(e);
    }
    return reply.redirect('/wardrobe-share/manage', 302);
  }
}
