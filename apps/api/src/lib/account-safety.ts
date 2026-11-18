// mail about account safety (forgot password) goes out during a platform wide email pause too.
// these are the payload types of that mail.
export const ACCOUNT_SAFETY_MAIL: ReadonlySet<string> = new Set(['password_reset', 'password_changed']);
