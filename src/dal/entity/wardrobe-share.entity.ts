import {
  Entity,
  ManyToOne,
  PrimaryKey,
  Property,
  type Ref,
  Unique,
} from '@mikro-orm/core';
import { User } from './user.entity';
import { Wardrobe } from './wardrobe.entity';

export enum SharePermission {
  VIEW = 'VIEW',
  MANAGE = 'MANAGE',
}

@Entity()
@Unique({ properties: ['wardrobe', 'grantee'] })
export class WardrobeShare {
  @PrimaryKey()
  public id!: number;

  /** The one wardrobe this share grants access to. */
  @ManyToOne({
    entity: () => Wardrobe,
    deleteRule: 'cascade',
    ref: true,
    nullable: true,
  })
  public wardrobe?: Ref<Wardrobe>;

  @ManyToOne({
    entity: () => User,
    deleteRule: 'cascade',
    ref: true,
  })
  public grantor!: Ref<User>;

  @ManyToOne({
    entity: () => User,
    deleteRule: 'cascade',
    ref: true,
    nullable: true,
  })
  public grantee?: Ref<User> | null;

  @Property({ default: SharePermission.VIEW })
  public permission: SharePermission = SharePermission.VIEW;

  @Property({ nullable: true, unique: true })
  public inviteToken?: string;

  @Property({ nullable: true })
  public acceptedAt?: Date;

  @Property()
  public createdAt: Date = new Date();
}
