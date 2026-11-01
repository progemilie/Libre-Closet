import { Migration } from '@mikro-orm/migrations';

export class Migration20261101191832 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table \`wardrobe\` (\`id\` integer not null primary key autoincrement, \`name\` text null, \`is_default\` integer not null default false, \`owner_id\` integer null, \`created_at\` datetime not null, constraint \`wardrobe_owner_id_foreign\` foreign key(\`owner_id\`) references \`user\`(\`id\`) on delete cascade on update cascade);`);
    this.addSql(`create index \`wardrobe_owner_id_index\` on \`wardrobe\` (\`owner_id\`);`);

    this.addSql(`alter table \`garment\` add column \`wardrobe_id\` integer null constraint \`garment_wardrobe_id_foreign\` references \`wardrobe\` (\`id\`) on update cascade on delete set null;`);
    this.addSql(`create index \`garment_wardrobe_id_index\` on \`garment\` (\`wardrobe_id\`);`);

    this.addSql(`drop index \`wardrobe_share_grantor_id_grantee_id_unique\`;`);

    this.addSql(`alter table \`wardrobe_share\` add column \`wardrobe_id\` integer null constraint \`wardrobe_share_wardrobe_id_foreign\` references \`wardrobe\` (\`id\`) on update cascade on delete cascade;`);
    this.addSql(`create index \`wardrobe_share_wardrobe_id_index\` on \`wardrobe_share\` (\`wardrobe_id\`);`);
    this.addSql(`create unique index \`wardrobe_share_wardrobe_id_grantee_id_unique\` on \`wardrobe_share\` (\`wardrobe_id\`, \`grantee_id\`);`);

    // Every user gets a default wardrobe (unnamed: shown as "My Wardrobe") that
    // holds all their existing garments. Existing shares covered everything the
    // grantor owned, so they now point at that wardrobe and nothing changes.
    // Columns were added with ALTER TABLE, not a rebuild, so #129 can't recur.
    this.addSql(`insert into \`wardrobe\` (\`name\`, \`is_default\`, \`owner_id\`, \`created_at\`) select null, true, \`id\`, cast(strftime('%s', 'now') as integer) * 1000 from \`user\` order by \`id\`;`);
    // Accounts-off mode keeps ownerless garments; give them an ownerless default
    this.addSql(`insert into \`wardrobe\` (\`name\`, \`is_default\`, \`owner_id\`, \`created_at\`) select null, true, null, cast(strftime('%s', 'now') as integer) * 1000 where exists (select 1 from \`garment\` where \`owner_id\` is null);`);
    this.addSql(`update \`garment\` set \`wardrobe_id\` = (select \`w\`.\`id\` from \`wardrobe\` as \`w\` where \`w\`.\`is_default\` = true and \`w\`.\`owner_id\` is \`garment\`.\`owner_id\`);`);
    this.addSql(`update \`wardrobe_share\` set \`wardrobe_id\` = (select \`w\`.\`id\` from \`wardrobe\` as \`w\` where \`w\`.\`is_default\` = true and \`w\`.\`owner_id\` = \`wardrobe_share\`.\`grantor_id\`);`);
  }

}
