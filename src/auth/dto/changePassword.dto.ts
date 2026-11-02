import { i18nValidationMessage } from 'nestjs-i18n';
import { I18nTranslations } from '../../i18n/generated/i18n.generated';
import { IsNewPassword } from '../credentials.validators';
import { Match } from '../match.decorator';

export class ChangePasswordDto {
  currentPassword: string;

  @IsNewPassword()
  newPassword: string;

  @Match('newPassword', {
    message: i18nValidationMessage<I18nTranslations>(
      'lang.validation.PASSWORDS_MUST_MATCH',
    ),
  })
  confirmPassword: string;
}
