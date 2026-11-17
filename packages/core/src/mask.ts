// contact masking for members without customers.contact.view

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return '***';
  const local = email.slice(0, at);
  return `${local.slice(0, Math.min(2, local.length))}***${email.slice(at)}`;
}

const COUNTRY_CODES = ['357', '30', '7', '44', '49', '1'];

// +306912345123 -> +30 69** *** 123
export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/[^\d]/g, '');
  const plus = phone.trim().startsWith('+');
  let cc = '';
  let national = digits;
  if (plus) {
    cc = COUNTRY_CODES.find((c) => digits.startsWith(c)) ?? digits.slice(0, 2);
    national = digits.slice(cc.length);
  }
  if (national.length < 6) return (plus ? `+${cc} ` : '') + '*'.repeat(national.length);
  const head = national.slice(0, 2);
  const tail = national.slice(-3);
  const hidden = national.length - 5;
  const firstStars = Math.min(2, hidden);
  const rest = hidden - firstStars;
  const masked = `${head}${'*'.repeat(firstStars)}${rest ? ' ' + '*'.repeat(rest) : ''} ${tail}`;
  return (plus ? `+${cc} ` : '') + masked;
}
