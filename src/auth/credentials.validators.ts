import { Transform } from 'class-transformer';
import { IsString, Matches, MinLength } from 'class-validator';
import { i18nValidationMessage } from 'nestjs-i18n';
import { I18nTranslations } from '../generated/i18n.generated';

/** Usernames are matched without regard to case or surrounding spaces. */
export const normalizeUsername = (username: unknown): string =>
  typeof username === 'string' ? username.trim().toLowerCase() : '';

/** 3–32 letters, digits, dots, dashes or underscores (stored lowercase). */
export function IsUsername(): PropertyDecorator {
  return (target, propertyKey) => {
    Transform(({ value }) => normalizeUsername(value))(target, propertyKey);
    Matches(/^[\p{L}\p{N}._-]{3,32}$/u, {
      message: i18nValidationMessage<I18nTranslations>(
        'lang.validation.USERNAME_FORMAT',
      ),
    })(target, propertyKey);
  };
}

export function IsNewPassword(): PropertyDecorator {
  return (target, propertyKey) => {
    IsString()(target, propertyKey);
    MinLength(8, {
      message: i18nValidationMessage<I18nTranslations>(
        'lang.validation.MIN_PASSWORD_LENGTH',
      ),
    })(target, propertyKey);
    Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/, {
      message: i18nValidationMessage<I18nTranslations>(
        'lang.validation.PASSWORD_MUST_CONTAIN',
      ),
    })(target, propertyKey);
  };
}
