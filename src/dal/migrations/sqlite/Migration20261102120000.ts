import { Migration } from '@mikro-orm/migrations';

export class Migration20261102120000 extends Migration {

  override async up(): Promise<void> {
    // Usernames replace email addresses; an existing address becomes the username
    // (lowercase, as logins are). RENAME COLUMN keeps the table, so #129 can't recur.
    this.addSql(`drop index \`user_email_unique\`;`);
    this.addSql(`alter table \`user\` rename column \`email\` to \`username\`;`);
    this.addSql(`update \`user\` set \`username\` = lower(trim(\`username\`));`);
    this.addSql(`create unique index \`user_username_unique\` on \`user\` (\`username\`);`);
  }

}
