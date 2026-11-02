import { IsUsername } from '../credentials.validators';

export class UpdateUsernameDto {
  @IsUsername()
  username: string;
}
