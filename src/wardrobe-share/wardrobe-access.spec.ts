import { BetterSqliteDriver } from '@mikro-orm/better-sqlite';
import { MikroORM } from '@mikro-orm/core';
import { MikroOrmModule } from '@mikro-orm/nestjs';
import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { File } from '../dal/entity/file.entity';
import { Garment } from '../dal/entity/garment.entity';
import { OutfitCalendar } from '../dal/entity/outfit-calendar.entity';
import { Outfit } from '../dal/entity/outfit.entity';
import { PasswordReset } from '../dal/entity/passwordReset.entity';
import { User } from '../dal/entity/user.entity';
import { UserDevice } from '../dal/entity/userDevice.entity';
import {
  SharePermission,
  WardrobeShare,
} from '../dal/entity/wardrobe-share.entity';
import { Wardrobe } from '../dal/entity/wardrobe.entity';
import { FileService } from '../file/file-service.abstract';
import { GarmentService } from '../wardrobe/garment.service';
import { OutfitService } from '../wardrobe/outfit.service';
import { WardrobeShareService } from './wardrobe-share.service';
import { WardrobeService } from './wardrobe.service';

/**
 * Runs the wardrobe, sharing and garment services against a real in-memory
 * SQLite database: the privacy rules live in the queries, so mocking the
 * repositories would test nothing.
 */
describe('Wardrobe access', () => {
  let orm: MikroORM;
  let wardrobes: WardrobeService;
  let shares: WardrobeShareService;
  let garments: GarmentService;
  let outfits: OutfitService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      imports: [
        MikroOrmModule.forRoot({
          driver: BetterSqliteDriver,
          dbName: ':memory:',
          entities: [
            User,
            File,
            Garment,
            Outfit,
            OutfitCalendar,
            PasswordReset,
            UserDevice,
            WardrobeShare,
            Wardrobe,
          ],
          allowGlobalContext: true,
          logger: () => undefined,
        }),
        MikroOrmModule.forFeature([
          User,
          Garment,
          Outfit,
          WardrobeShare,
          Wardrobe,
        ]),
      ],
      providers: [
        WardrobeService,
        WardrobeShareService,
        GarmentService,
        OutfitService,
        { provide: FileService, useValue: {} },
      ],
    }).compile();

    orm = module.get(MikroORM);
    wardrobes = module.get(WardrobeService);
    shares = module.get(WardrobeShareService);
    garments = module.get(GarmentService);
    outfits = module.get(OutfitService);
  });

  beforeEach(async () => {
    await orm.schema.refreshDatabase();
    orm.em.clear();
  });

  afterAll(async () => {
    await orm.close(true);
  });

  const createUser = async (email: string): Promise<User> => {
    const user = orm.em.create(User, { email, password: 'hashed' } as User);
    await orm.em.persistAndFlush(user);
    return user;
  };

  const share = async (
    grantor: User,
    grantee: User,
    wardrobeId: number,
    permission = SharePermission.VIEW,
  ) => {
    const invite = await shares.createInviteLink(
      grantor.id,
      wardrobeId,
      permission,
    );
    return shares.acceptInvite(invite.inviteToken!, grantee.id);
  };

  const addGarment = (name: string, userId?: number, wardrobeId?: number) =>
    garments.create({ name, category: 'top' }, userId, wardrobeId);

  describe('WardrobeService', () => {
    it('creates one default wardrobe per user on first use', async () => {
      const alice = await createUser('alice@example.com');

      const first = await wardrobes.getDefault(alice.id);
      const second = await wardrobes.getDefault(alice.id);

      expect(second.id).toBe(first.id);
      expect(first.isDefault).toBe(true);
      expect(await wardrobes.listOwn(alice.id)).toHaveLength(1);
    });

    it('lists the default wardrobe first', async () => {
      const alice = await createUser('alice@example.com');
      await wardrobes.create('Archive', alice.id);
      const def = await wardrobes.getDefault(alice.id);

      const list = await wardrobes.listOwn(alice.id);

      expect(list.map((w) => w.id)[0]).toBe(def.id);
      expect(list).toHaveLength(2);
    });

    it('keeps exactly one default when the default changes', async () => {
      const alice = await createUser('alice@example.com');
      const original = await wardrobes.getDefault(alice.id);
      const shared = await wardrobes.create('Shared', alice.id);

      await wardrobes.setDefault(shared.id, alice.id);

      const list = await wardrobes.listOwn(alice.id);
      expect(list.filter((w) => w.isDefault).map((w) => w.id)).toEqual([
        shared.id,
      ]);
      expect((await wardrobes.getDefault(alice.id)).id).toBe(shared.id);
      expect(list.find((w) => w.id === original.id)?.isDefault).toBe(false);
    });

    it('renames only your own wardrobes', async () => {
      const alice = await createUser('alice@example.com');
      const bob = await createUser('bob@example.com');
      const w = await wardrobes.create('Old', alice.id);

      await wardrobes.rename(w.id, '  New  ', alice.id);
      await expect(wardrobes.rename(w.id, 'Hacked', bob.id)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(wardrobes.rename(w.id, '   ', alice.id)).rejects.toThrow(
        BadRequestException,
      );

      orm.em.clear();
      expect((await wardrobes.access(w.id, alice.id)).wardrobe.name).toBe(
        'New',
      );
    });

    it('refuses to delete the default wardrobe or one with garments', async () => {
      const alice = await createUser('alice@example.com');
      const def = await wardrobes.getDefault(alice.id);
      const full = await wardrobes.create('Full', alice.id);
      await addGarment('Coat', alice.id, full.id);

      await expect(wardrobes.remove(def.id, alice.id)).rejects.toThrow(
        BadRequestException,
      );
      await expect(wardrobes.remove(full.id, alice.id)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('deletes an empty wardrobe together with its shares', async () => {
      const alice = await createUser('alice@example.com');
      const bob = await createUser('bob@example.com');
      const empty = await wardrobes.create('Empty', alice.id);
      await share(alice, bob, empty.id);

      await wardrobes.remove(empty.id, alice.id);

      orm.em.clear();
      await expect(wardrobes.access(empty.id, alice.id)).rejects.toThrow(
        NotFoundException,
      );
      expect(await shares.getInboundShares(bob.id)).toHaveLength(0);
    });

    it('works without accounts (ownerless wardrobes)', async () => {
      const def = await wardrobes.getDefault(undefined);
      const alice = await createUser('alice@example.com');
      const alices = await wardrobes.getDefault(alice.id);

      expect((await wardrobes.access(def.id, undefined)).permission).toBe(
        'OWNER',
      );
      await expect(wardrobes.access(alices.id, undefined)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(wardrobes.access(def.id, alice.id)).rejects.toThrow(
        ForbiddenException,
      );
    });
  });

  describe('sharing is per wardrobe', () => {
    it('gives access to the shared wardrobe and nothing else', async () => {
      const alice = await createUser('alice@example.com');
      const bob = await createUser('bob@example.com');
      const sharedW = await wardrobes.getDefault(alice.id);
      const privateW = await wardrobes.create('Private', alice.id);
      await share(alice, bob, sharedW.id);

      expect((await wardrobes.access(sharedW.id, bob.id)).permission).toBe(
        SharePermission.VIEW,
      );
      await expect(wardrobes.access(privateW.id, bob.id)).rejects.toThrow(
        ForbiddenException,
      );
      expect((await wardrobes.access(privateW.id, alice.id)).permission).toBe(
        'OWNER',
      );
    });

    it('only lets the owner create an invite for a wardrobe', async () => {
      const alice = await createUser('alice@example.com');
      const bob = await createUser('bob@example.com');
      const w = await wardrobes.getDefault(alice.id);

      await expect(
        shares.createInviteLink(bob.id, w.id, SharePermission.VIEW),
      ).rejects.toThrow(ForbiddenException);
    });

    it('allows sharing two wardrobes of one owner with the same person', async () => {
      const alice = await createUser('alice@example.com');
      const bob = await createUser('bob@example.com');
      const one = await wardrobes.getDefault(alice.id);
      const two = await wardrobes.create('Second', alice.id);

      await share(alice, bob, one.id);
      await share(alice, bob, two.id, SharePermission.MANAGE);

      const inbound = await shares.getInboundShares(bob.id);
      expect(inbound.map((s) => s.wardrobe!.id).sort()).toEqual(
        [one.id, two.id].sort(),
      );
      expect((await wardrobes.access(two.id, bob.id)).permission).toBe(
        SharePermission.MANAGE,
      );
    });

    it('lists writable wardrobes: your own plus ones shared with edit rights', async () => {
      const alice = await createUser('alice@example.com');
      const bob = await createUser('bob@example.com');
      const viewOnly = await wardrobes.getDefault(alice.id);
      const editable = await wardrobes.create('Editable', alice.id);
      await share(alice, bob, viewOnly.id);
      await share(alice, bob, editable.id, SharePermission.MANAGE);
      const bobs = await wardrobes.getDefault(bob.id);

      const ids = (await wardrobes.writable(bob.id)).map((w) => w.id).sort();

      expect(ids).toEqual([bobs.id, editable.id].sort());
    });
  });

  describe('GarmentService', () => {
    it('lists only the garments of the requested wardrobe', async () => {
      const alice = await createUser('alice@example.com');
      const sharedW = await wardrobes.getDefault(alice.id);
      const privateW = await wardrobes.create('Private', alice.id);
      await addGarment('Jacket', alice.id, sharedW.id);
      await addGarment('Diary', alice.id, privateW.id);

      const inShared = await garments.findAll(alice.id, {}, sharedW.id);
      const inPrivate = await garments.findAll(alice.id, {}, privateW.id);
      const all = await garments.findAll(alice.id);

      expect(inShared.map((g) => g.name)).toEqual(['Jacket']);
      expect(inPrivate.map((g) => g.name)).toEqual(['Diary']);
      expect(all.map((g) => g.name).sort()).toEqual(['Diary', 'Jacket']);
    });

    it('puts a garment without a wardrobe into the default one', async () => {
      const alice = await createUser('alice@example.com');
      const def = await wardrobes.getDefault(alice.id);

      const g = await addGarment('Shirt', alice.id);

      expect(g.wardrobe?.id).toBe(def.id);
    });

    it('hides a shared owner’s private garments from the grantee', async () => {
      const alice = await createUser('alice@example.com');
      const bob = await createUser('bob@example.com');
      const sharedW = await wardrobes.getDefault(alice.id);
      const privateW = await wardrobes.create('Private', alice.id);
      const jacket = await addGarment('Jacket', alice.id, sharedW.id);
      const diary = await addGarment('Diary', alice.id, privateW.id);
      await share(alice, bob, sharedW.id);

      expect(
        (await garments.findAll(bob.id, {}, sharedW.id)).map((g) => g.name),
      ).toEqual(['Jacket']);
      await expect(garments.findAll(bob.id, {}, privateW.id)).rejects.toThrow(
        ForbiddenException,
      );
      expect((await garments.access(jacket.id, bob.id)).permission).toBe(
        SharePermission.VIEW,
      );
      await expect(garments.findOne(diary.id, bob.id)).rejects.toThrow(
        ForbiddenException,
      );
      // The grantee's "all garments" (used by outfits) never includes Alice's
      expect(await garments.findAll(bob.id)).toHaveLength(0);
    });

    it('scopes filter values to the wardrobe so private items do not leak', async () => {
      const alice = await createUser('alice@example.com');
      const bob = await createUser('bob@example.com');
      const sharedW = await wardrobes.getDefault(alice.id);
      const privateW = await wardrobes.create('Private', alice.id);
      await garments.create(
        { name: 'Jacket', category: 'outerwear' },
        alice.id,
        sharedW.id,
      );
      await garments.create(
        { name: 'Secret', category: 'secret-category' },
        alice.id,
        privateW.id,
      );
      await share(alice, bob, sharedW.id);

      const filters = await garments.findAvailableFilters(bob.id, sharedW.id);

      expect(filters.categories).toEqual(['outerwear']);
    });

    it('lets a grantee with edit rights add to the shared wardrobe, owned by its owner', async () => {
      const alice = await createUser('alice@example.com');
      const bob = await createUser('bob@example.com');
      const sharedW = await wardrobes.getDefault(alice.id);
      const privateW = await wardrobes.create('Private', alice.id);
      await share(alice, bob, sharedW.id, SharePermission.MANAGE);

      const added = await addGarment('Gift', bob.id, sharedW.id);

      expect(added.owner?.id).toBe(alice.id);
      expect(added.wardrobe?.id).toBe(sharedW.id);
      await expect(addGarment('Sneaky', bob.id, privateW.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('refuses adding to a wardrobe shared view-only', async () => {
      const alice = await createUser('alice@example.com');
      const bob = await createUser('bob@example.com');
      const sharedW = await wardrobes.getDefault(alice.id);
      await share(alice, bob, sharedW.id);

      await expect(addGarment('Nope', bob.id, sharedW.id)).rejects.toThrow(
        ForbiddenException,
      );
    });

    it('moves a garment between its owner’s wardrobes', async () => {
      const alice = await createUser('alice@example.com');
      const bob = await createUser('bob@example.com');
      const sharedW = await wardrobes.getDefault(alice.id);
      const privateW = await wardrobes.create('Private', alice.id);
      await share(alice, bob, sharedW.id);
      const g = await addGarment('Scarf', alice.id, privateW.id);

      await garments.update(g.id, { wardrobeId: sharedW.id }, alice.id);

      orm.em.clear();
      expect((await garments.findOne(g.id, bob.id)).name).toBe('Scarf');
    });

    it('refuses to move a garment into someone else’s wardrobe', async () => {
      const alice = await createUser('alice@example.com');
      const bob = await createUser('bob@example.com');
      const alicesW = await wardrobes.getDefault(alice.id);
      const bobsW = await wardrobes.getDefault(bob.id);
      await share(alice, bob, alicesW.id, SharePermission.MANAGE);
      const g = await addGarment('Scarf', alice.id, alicesW.id);

      // Bob may edit Alice's garment, but not pull it into his own wardrobe
      await expect(
        garments.update(g.id, { wardrobeId: bobsW.id }, bob.id),
      ).rejects.toThrow(ForbiddenException);
      // Alice may not push her garment into Bob's wardrobe either
      await expect(
        garments.update(g.id, { wardrobeId: bobsW.id }, alice.id),
      ).rejects.toThrow(ForbiddenException);
    });

    it('lets only the owner archive or delete', async () => {
      const alice = await createUser('alice@example.com');
      const bob = await createUser('bob@example.com');
      const sharedW = await wardrobes.getDefault(alice.id);
      await share(alice, bob, sharedW.id, SharePermission.MANAGE);
      const g = await addGarment('Hat', alice.id, sharedW.id);

      await expect(garments.archive(g.id, bob.id)).rejects.toThrow(
        ForbiddenException,
      );
      await expect(garments.remove(g.id, bob.id)).rejects.toThrow(
        ForbiddenException,
      );
      await garments.archive(g.id, alice.id);
    });
  });

  describe('OutfitService', () => {
    it('never attaches another user’s garment to an outfit', async () => {
      const alice = await createUser('alice@example.com');
      const bob = await createUser('bob@example.com');
      const alicesGarment = await addGarment('Diary', alice.id);
      const bobsGarment = await addGarment('Boots', bob.id);

      const outfit = await outfits.create(
        {
          name: 'Mixed',
          slots: [
            { category: 'top', garmentId: alicesGarment.id },
            { category: 'shoes', garmentId: bobsGarment.id },
          ],
        },
        bob.id,
      );

      orm.em.clear();
      const loaded = await outfits.findOne(outfit.id, bob.id);
      expect(loaded.garments.getItems().map((g) => g.name)).toEqual(['Boots']);
    });
  });
});
