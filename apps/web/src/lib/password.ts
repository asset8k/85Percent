import type { TFunction } from 'i18next'

/**
 * Shared password-strength check. Mirrors the backend PasswordSchema and returns
 * the first unmet rule (translated), or null when the password passes. Used by
 * both the custom reset flow (ResetPasswordPage) and the Supabase invite
 * set-password flow (SetPasswordPage) so the rules stay in one place.
 */
export function passwordIssue(pw: string, t: TFunction): string | null {
  if (pw.length < 8) return t('auth.reset.issue.min8')
  if (!/[A-Z]/.test(pw)) return t('auth.reset.issue.upper')
  if (!/[a-z]/.test(pw)) return t('auth.reset.issue.lower')
  if (!/[0-9]/.test(pw)) return t('auth.reset.issue.number')
  if (!/[^A-Za-z0-9]/.test(pw)) return t('auth.reset.issue.special')
  return null
}
