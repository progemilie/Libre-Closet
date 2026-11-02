import { IsNewPassword, IsUsername } from '../credentials.validators';
import { Match } from '../match.decorator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { I18nTranslations } from '../../i18n/generated/i18n.generated';

export class RegisterDto {
  @IsUsername()
  username: string;

  @IsNewPassword()
  password: string;

  @Match('password', {
    message: i18nValidationMessage<I18nTranslations>(
      'lang.validation.PASSWORDS_MUST_MATCH',
    ),
  })
  confirmPassword: string;
}
