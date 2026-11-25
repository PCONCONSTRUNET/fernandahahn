// Shared WhatsApp formatting and lookup helpers for Edge Functions

// Normalize a Brazilian WhatsApp number to canonical format: 55 + DDD (2) + 9 + 8 digits = 13 digits.
export function normalizeWhatsapp(input: string): string {
  let digits = (input || "").replace(/\D/g, "");

  // Strip leading 0s
  digits = digits.replace(/^0+/, "");

  if (digits.length === 13 && digits.startsWith("55")) {
    return digits;
  }

  if (digits.length === 12 && digits.startsWith("55")) {
    const ddd = digits.slice(2, 4);
    const rest = digits.slice(4);
    return `55${ddd}9${rest}`;
  }

  if (digits.length === 11) {
    return `55${digits}`;
  }

  if (digits.length === 10) {
    const ddd = digits.slice(0, 2);
    const rest = digits.slice(2);
    return `55${ddd}9${rest}`;
  }

  return digits;
}

export const normalizeWhatsApp = normalizeWhatsapp;

// Generate a synthetic email from a WhatsApp number: "<digits>@gmail.com"
export function whatsappToEmail(whatsapp: string): string {
  const digits = normalizeWhatsapp(whatsapp);
  return `${digits}@gmail.com`;
}

// Build legacy variations of a canonical BR WhatsApp to match older profiles
export function whatsappVariations(canonical: string): string[] {
  const set = new Set<string>([canonical]);
  if (canonical.length === 13 && canonical.startsWith("55")) {
    const ddd = canonical.slice(2, 4);
    const after9 = canonical.slice(5);
    set.add(canonical.slice(2));
    set.add(`${ddd}${after9}`);
    set.add(`55${ddd}${after9}`);
  }
  return Array.from(set);
}
