export const REGISTRATION_PASSWORD_MIN_LENGTH = 8;
export const REGISTRATION_PASSWORD_MESSAGE = `비밀번호는 ${REGISTRATION_PASSWORD_MIN_LENGTH}자 이상이며 숫자와 특수문자를 반드시 포함해야 합니다.`;
export const REGISTRATION_PASSWORD_CONFIRMATION_MESSAGE = '비밀번호와 비밀번호 확인이 일치하지 않습니다.';

export function validRegistrationPassword(password: string): boolean {
  return password.length >= REGISTRATION_PASSWORD_MIN_LENGTH && /[0-9]/.test(password) && /[\p{P}\p{S}]/u.test(password);
}
