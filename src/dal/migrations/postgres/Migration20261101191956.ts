import { Migration } from '@mikro-orm/migrations';

export class Migration20261101191956 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`create table "wardrobe" ("id" serial primary key, "name" varchar(255) null, "is_default" boolean not null default false, "owner_id" int null, "created_at" timestamptz not null);`);

    this.addSql(`alter table "wardrobe" add constraint "wardrobe_owner_id_foreign" foreign key ("owner_id") references "user" ("id") on update cascade on delete cascade;`);

    this.addSql(`alter table "garment" add column "wardrobe_id" int null;`);
    this.addSql(`alter table "garment" add constraint "garment_wardrobe_id_foreign" foreign key ("wardrobe_id") references "wardrobe" ("id") on update cascade on delete set null;`);

    this.addSql(`alter table "wardrobe_share" drop constraint "wardrobe_share_grantor_id_grantee_id_unique";`);

    this.addSql(`alter table "wardrobe_share" add column "wardrobe_id" int null;`);
    this.addSql(`alter table "wardrobe_share" add constraint "wardrobe_share_wardrobe_id_foreign" foreign key ("wardrobe_id") references "wardrobe" ("id") on update cascade on delete cascade;`);
    this.addSql(`alter table "wardrobe_share" add constraint "wardrobe_share_wardrobe_id_grantee_id_unique" unique ("wardrobe_id", "grantee_id");`);

    // Every user gets a default wardrobe (unnamed: shown as "My Wardrobe") that
    // holds all their existing garments. Existing shares covered everything the
    // grantor owned, so they now point at that wardrobe and nothing changes.
    this.addSql(`insert into "wardrobe" ("name", "is_default", "owner_id", "created_at") select null, true, "id", now() from "user" order by "id";`);
    // Accounts-off mode keeps ownerless garments; give them an ownerless default
    this.addSql(`insert into "wardrobe" ("name", "is_default", "owner_id", "created_at") select null, true, null, now() where exists (select 1 from "garment" where "owner_id" is null);`);
    this.addSql(`update "garment" set "wardrobe_id" = (select "w"."id" from "wardrobe" as "w" where "w"."is_default" = true and "w"."owner_id" is not distinct from "garment"."owner_id");`);
    this.addSql(`update "wardrobe_share" set "wardrobe_id" = (select "w"."id" from "wardrobe" as "w" where "w"."is_default" = true and "w"."owner_id" = "wardrobe_share"."grantor_id");`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "garment" drop constraint "garment_wardrobe_id_foreign";`);

    this.addSql(`alter table "wardrobe_share" drop constraint "wardrobe_share_wardrobe_id_foreign";`);

    this.addSql(`drop table if exists "wardrobe" cascade;`);

    this.addSql(`alter table "garment" drop column "wardrobe_id";`);

    this.addSql(`alter table "wardrobe_share" drop constraint "wardrobe_share_wardrobe_id_grantee_id_unique";`);
    this.addSql(`alter table "wardrobe_share" drop column "wardrobe_id";`);

    this.addSql(`alter table "wardrobe_share" add constraint "wardrobe_share_grantor_id_grantee_id_unique" unique ("grantor_id", "grantee_id");`);
  }

}
