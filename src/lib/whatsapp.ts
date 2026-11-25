/**
 * Normaliza números brasileiros removendo pontuação/zeros à esquerda e
 * garantindo o DDI 55 quando o telefone tiver 10 ou 11 dígitos.
 * Usado para montar links wa.me (abrir conversa manualmente).
 */
export const normalizeWhatsappNumber = (raw: string): string => {
  let digits = (raw || "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  }
  return digits;
};
