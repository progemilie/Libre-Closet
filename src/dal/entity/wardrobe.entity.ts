import {
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
  type Ref,
} from '@mikro-orm/core';
import { User } from './user.entity';

/**
 * A named collection of garments. Sharing is granted per wardrobe, so a
 * wardrobe nobody has been invited to is private to its owner.
 */
@Entity()
export class Wardrobe {
  @PrimaryKey()
  public id!: number;

  /** Null for the default wardrobe until renamed; shown as "My Wardrobe". */
  @Property({ nullable: true })
  public name?: string;

  /** The wardrobe opened when the app starts. One per owner. */
  @Property({ default: false })
  public isDefault = false;

  @ManyToOne({
    entity: () => User,
    deleteRule: 'cascade',
    ref: true,
    nullable: true,
  })
  public owner?: Ref<User>;

  @Property()
  public createdAt: Date = new Date();
}
