import { BetterSqliteDriver } from '@mikro-orm/better-sqlite';
import { MikroORM } from '@mikro-orm/core';
import { Migration, Migrator } from '@mikro-orm/migrations';
import { mkdtempSync, readdirSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

/**
 * Guards against migrations that silently destroy user data.
 *
 * SQLite cannot alter a column in place, so MikroORM emits a full table
 * rebuild (create temp -> copy -> drop original -> rename). `DROP TABLE` runs
 * an implicit `DELETE FROM` that fires `ON DELETE CASCADE`, and the
 * `pragma foreign_keys = off` that is supposed to prevent that is a no-op
 * inside a transaction -- which is how migrations run here. That combination
 * wiped every `outfit_garments` row on upgrade (#129).
 *
 * This test seeds a database at the last pre-regression migration and then runs
 * the rest of the chain, asserting that no table loses rows.
 */

/** Last migration shipped in v0.3.2 -- the baseline reported in #129. */
const SEED_AFTER_MIGRATION = 'Migration20260416215236';

const MIGRATIONS_DIR = join(__dirname, 'migrations', 'sqlite');

const migrationsList = readdirSync(MIGRATIONS_DIR)
  .filter((file) => /^Migration\d+\.(ts|js)$/.test(file))
  .sort()
  .map((file) => {
    const name = file.replace(/\.(ts|js)$/, '');
    // Loaded dynamically so a newly generated migration is covered without
    // anyone having to remember to add it here.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const loaded = require(join(MIGRATIONS_DIR, file)) as Record<
      string,
      typeof Migration
    >;
    return { name, class: loaded[name] };
  });

const SEED_STATEMENTS = [
  `insert into \`password_reset\` (\`id\`, \`pin\`) values (1, '123456');`,
  `insert into \`user\` (\`id\`, \`shareable_id\`, \`email\`, \`password\`) values (1, 'user-1', 'owner@example.com', 'hashed');`,
  `insert into \`file\` (\`id\`, \`shareable_id\`, \`file_name\`, \`created_on\`, \`created_by_id\`) values (1, 'file-1', 'shirt.jpg', '2026-04-01', 1), (2, 'file-2', 'jeans.jpg', '2026-04-01', 1);`,
  `insert into \`garment\` (\`id\`, \`shareable_id\`, \`name\`, \`category\`, \`color\`, \`photo_id\`, \`owner_id\`) values (1, 'garment-1', 'Shirt', 'TOP', 'blue', 1, 1), (2, 'garment-2', 'Jeans', 'BOTTOM', 'black', 2, 1), (3, 'garment-3', 'Boots', 'SHOES', 'brown', null, 1);`,
  `insert into \`outfit\` (\`id\`, \`shareable_id\`, \`name\`, \`owner_id\`) values (1, 'outfit-1', 'Workday', 1), (2, 'outfit-2', 'Weekend', 1);`,
  `insert into \`outfit_garments\` (\`outfit_id\`, \`garment_id\`) values (1, 1), (1, 2), (2, 2), (2, 3);`,
  `insert into \`outfit_calendar\` (\`id\`, \`date\`, \`outfit_id\`, \`owner_id\`) values (1, '2026-04-02', 1, 1), (2, '2026-04-03', 2, 1);`,
];

describe('sqlite migrations', () => {
  let dir: string;
  let orm: MikroORM;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'libre-closet-migrations-'));
    orm = await MikroORM.init({
      driver: BetterSqliteDriver,
      dbName: join(dir, 'sqlite3.db'),
      entities: [],
      discovery: { warnWhenNoEntities: false },
      extensions: [Migrator],
      logger: () => undefined,
      migrations: { migrationsList, transactional: true },
    });
  });

  afterAll(async () => {
    await orm?.close(true);
    rmSync(dir, { recursive: true, force: true });
  });

  const countRows = async (): Promise<Record<string, number>> => {
    const connection = orm.em.getConnection();
    const tables = await connection.execute<{ name: string }[]>(
      `select \`name\` from \`sqlite_master\` where \`type\` = 'table' and \`name\` not like 'sqlite_%' and \`name\` != 'mikro_orm_migrations';`,
    );

    const counts: Record<string, number> = {};
    for (const { name } of tables) {
      const [row] = await connection.execute<{ count: number }[]>(
        `select count(*) as \`count\` from \`${name}\`;`,
      );
      counts[name] = row.count;
    }
    return counts;
  };

  it('preserves every row when upgrading a v0.3.2 database (#129)', async () => {
    const migrator = orm.getMigrator();

    await migrator.up({ to: SEED_AFTER_MIGRATION });
    for (const statement of SEED_STATEMENTS) {
      await orm.em.getConnection().execute(statement);
    }

    const before = await countRows();
    // Sanity check: the fixture must actually exercise the join table.
    expect(before['outfit_garments']).toBe(4);

    await migrator.up();

    const after = await countRows();
    for (const [table, count] of Object.entries(before)) {
      expect({ table, count: after[table] }).toEqual({ table, count });
    }
  });
});

/** Last migration before wardrobes were introduced. */
const BEFORE_WARDROBES = 'Migration20260617224532';

describe('sqlite migrations: wardrobes', () => {
  let dir: string;
  let orm: MikroORM;

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'libre-closet-wardrobes-'));
    orm = await MikroORM.init({
      driver: BetterSqliteDriver,
      dbName: join(dir, 'sqlite3.db'),
      entities: [],
      discovery: { warnWhenNoEntities: false },
      extensions: [Migrator],
      logger: () => undefined,
      migrations: { migrationsList, transactional: true },
    });
  });

  afterAll(async () => {
    await orm?.close(true);
    rmSync(dir, { recursive: true, force: true });
  });

  it('puts every existing garment and share into its owner’s default wardrobe', async () => {
    const migrator = orm.getMigrator();
    const connection = orm.em.getConnection();
    await migrator.up({ to: BEFORE_WARDROBES });

    for (const statement of [
      `insert into \`user\` (\`id\`, \`shareable_id\`, \`email\`, \`password\`) values (1, 'u1', 'a@example.com', 'x'), (2, 'u2', 'b@example.com', 'x'), (3, 'u3', 'c@example.com', 'x');`,
      // Garments for two users and one ownerless (accounts-off) garment
      `insert into \`garment\` (\`id\`, \`shareable_id\`, \`category\`, \`owner_id\`) values (1, 'g1', 'top', 1), (2, 'g2', 'top', 1), (3, 'g3', 'top', 2), (4, 'g4', 'top', null);`,
      `insert into \`outfit\` (\`id\`, \`shareable_id\`, \`owner_id\`) values (1, 'o1', 1);`,
      `insert into \`outfit_garments\` (\`outfit_id\`, \`garment_id\`) values (1, 1), (1, 2);`,
      // An accepted share and an open invite link, both from user 1
      `insert into \`wardrobe_share\` (\`id\`, \`grantor_id\`, \`grantee_id\`, \`permission\`, \`accepted_at\`, \`created_at\`) values (1, 1, 2, 'VIEW', 1767225600000, 1767225600000);`,
      `insert into \`wardrobe_share\` (\`id\`, \`grantor_id\`, \`grantee_id\`, \`permission\`, \`invite_token\`, \`created_at\`) values (2, 1, null, 'MANAGE', 'tok', 1767225600000);`,
    ]) {
      await connection.execute(statement);
    }

    await migrator.up();

    const wardrobes = await connection.execute<
      { id: number; owner_id: number | null; is_default: number }[]
    >(
      `select \`id\`, \`owner_id\`, \`is_default\` from \`wardrobe\` order by \`id\`;`,
    );
    const defaultOf = (ownerId: number | null) =>
      wardrobes.find((w) => w.owner_id === ownerId && w.is_default)?.id;

    // One default per user (including user 3, who has nothing yet) + one ownerless
    expect(wardrobes.map((w) => w.owner_id)).toEqual([1, 2, 3, null]);
    expect(wardrobes.every((w) => w.is_default)).toBe(true);

    const garmentRows = await connection.execute<
      { id: number; wardrobe_id: number | null }[]
    >(`select \`id\`, \`wardrobe_id\` from \`garment\` order by \`id\`;`);
    expect(garmentRows).toEqual([
      { id: 1, wardrobe_id: defaultOf(1) },
      { id: 2, wardrobe_id: defaultOf(1) },
      { id: 3, wardrobe_id: defaultOf(2) },
      { id: 4, wardrobe_id: defaultOf(null) },
    ]);

    const shareRows = await connection.execute<
      { id: number; wardrobe_id: number | null }[]
    >(
      `select \`id\`, \`wardrobe_id\` from \`wardrobe_share\` order by \`id\`;`,
    );
    expect(shareRows).toEqual([
      { id: 1, wardrobe_id: defaultOf(1) },
      { id: 2, wardrobe_id: defaultOf(1) },
    ]);

    const [joinRows] = await connection.execute<{ count: number }[]>(
      `select count(*) as \`count\` from \`outfit_garments\`;`,
    );
    expect(joinRows.count).toBe(2);
  });
});
