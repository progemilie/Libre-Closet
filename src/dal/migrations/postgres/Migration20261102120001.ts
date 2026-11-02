import { Migration } from '@mikro-orm/migrations';

export class Migration20261102120001 extends Migration {

  override async up(): Promise<void> {
    // Usernames replace email addresses; an existing address becomes the username
    // (lowercase, as logins are).
    this.addSql(`alter table "user" rename column "email" to "username";`);
    this.addSql(`alter table "user" rename constraint "user_email_unique" to "user_username_unique";`);
    this.addSql(`update "user" set "username" = lower(trim("username"));`);
  }

  override async down(): Promise<void> {
    this.addSql(`alter table "user" rename constraint "user_username_unique" to "user_email_unique";`);
    this.addSql(`alter table "user" rename column "username" to "email";`);
  }

}
