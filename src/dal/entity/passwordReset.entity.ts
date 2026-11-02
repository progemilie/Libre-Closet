import {
  Entity,
  OneToOne,
  PrimaryKey,
  Property,
  type Ref,
} from '@mikro-orm/core';
import { User } from './user.entity';

/**
 * Unused since password resets moved to the `reset-password` command. Kept so
 * the schema stays put: dropping `user.password_reset_id` would rebuild the
 * SQLite `user` table (#129).
 */
@Entity()
export class PasswordReset {
  @PrimaryKey()
  public id!: number;

  @Property()
  public pin!: string;

  @OneToOne({
    entity: () => User,
    nullable: false,
    ref: true,
    mappedBy: 'passwordReset',
  })
  public user!: Ref<User>;
}
