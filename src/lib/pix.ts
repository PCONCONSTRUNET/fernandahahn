export type PixKeyType = "telefone" | "cpf" | "cnpj" | "email" | "aleatoria";

export const DEFAULT_COMPROVANTE_WHATSAPP = "5548999779829";
export const DEFAULT_PIX_MERCHANT_NAME = "FERNANDA HAHN";

/** Remove acentos e caracteres inválidos no padrão BR Code EMV do Banco Central. */
export function sanitizeEmvText(raw: string, fallback: string, maxLen: number): string {
  const cleaned = (raw || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 .\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const base = cleaned || fallback;
  return base.slice(0, maxLen);
}

/** Detecta o tipo provável de uma chave PIX já salva. */
export function detectPixKeyType(raw: string): PixKeyType {
  const s = (raw || "").trim();
  if (!s) return "telefone";
  if (s.includes("@")) return "email";
  if (s.startsWith("+")) return "telefone";
  const digits = s.replace(/\D/g, "");
  if (digits.length === 14 && !/[a-zA-Z]/.test(s)) return "cnpj";
  if (digits.length === 11 && /[.\-]/.test(s) && !s.includes("(")) return "cpf";
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s)) return "aleatoria";
  if (digits.length === 11 && /^\(?\d{2}\)?\s*9/.test(s)) return "telefone";
  if (digits.length === 11) return "cpf";
  return "aleatoria";
}

/** Normaliza a chave PIX conforme o padrão aceito pelo BACEN no QR Code. */
export function normalizePixKey(raw: string, type?: PixKeyType): string {
  const s = (raw || "").trim();
  if (!s) return "";
  const resolvedType = type ?? detectPixKeyType(s);

  if (resolvedType === "email") {
    return s.toLowerCase();
  }
  if (resolvedType === "telefone") {
    let digits = s.replace(/\D/g, "");
    if (!digits) return "";
    if (!s.startsWith("+") && (digits.length === 10 || digits.length === 11)) {
      digits = `55${digits}`;
    }
    return `+${digits}`;
  }
  if (resolvedType === "cpf" || resolvedType === "cnpj") {
    return s.replace(/\D/g, "");
  }
  return s;
}

function crc16Ccitt(payload: string): string {
  let crc = 0xffff;
  for (let i = 0; i < payload.length; i++) {
    crc ^= payload.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j++) {
      if (crc & 0x8000) {
        crc = (crc << 1) ^ 0x1021;
      } else {
        crc <<= 1;
      }
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

function emvTag(id: string, value: string): string {
  const len = value.length.toString().padStart(2, "0");
  return `${id}${len}${value}`;
}

export interface GeneratePixPayloadParams {
  key: string;
  amount: number;
  merchantName?: string;
  merchantCity?: string;
  txid?: string;
}

/** Gera payload BR Code (EMV) válido para QR Code e PIX Copia e Cola. */
export function generatePixPayload({
  key,
  amount,
  merchantName = DEFAULT_PIX_MERCHANT_NAME,
  merchantCity = "BRASIL",
  txid = "***",
}: GeneratePixPayloadParams): string {
  const cleanKey = (key || "").trim();
  if (!cleanKey) return "";

  const gui = emvTag("00", "br.gov.bcb.pix");
  const keyTag = emvTag("01", cleanKey);
  const merchantAccount = emvTag("26", gui + keyTag);
  const mcc = emvTag("52", "0000");
  const currency = emvTag("53", "986");
  const amountTag = amount > 0 ? emvTag("54", amount.toFixed(2)) : "";
  const country = emvTag("58", "BR");
  const name = emvTag("59", sanitizeEmvText(merchantName, DEFAULT_PIX_MERCHANT_NAME, 25));
  const city = emvTag("60", sanitizeEmvText(merchantCity, "BRASIL", 15));
  const cleanTxid = (txid || "***").replace(/[^A-Za-z0-9*]/g, "").slice(0, 25) || "***";
  const additionalData = emvTag("62", emvTag("05", cleanTxid));

  const payloadWithoutCRC =
    emvTag("00", "01") +
    merchantAccount +
    mcc +
    currency +
    amountTag +
    country +
    name +
    city +
    additionalData +
    "6304";

  return payloadWithoutCRC + crc16Ccitt(payloadWithoutCRC);
}

export interface PixComprovanteUrlParams {
  whatsappDestino?: string | null;
  clienteNome?: string | null;
  servico: string;
  variacao?: string | null;
  data: string; // YYYY-MM-DD
  horario: string;
  valor: number;
}

/** Monta link wa.me com os dados do agendamento para envio do comprovante PIX. */
export function buildPixComprovanteWhatsappUrl({
  whatsappDestino,
  clienteNome,
  servico,
  variacao,
  data,
  horario,
  valor,
}: PixComprovanteUrlParams): string {
  let digits = (whatsappDestino || "").replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length === 10 || digits.length === 11) {
    digits = `55${digits}`;
  }
  if (digits.length < 12) {
    digits = DEFAULT_COMPROVANTE_WHATSAPP;
  }

  const dataFmt = data.includes("-") ? data.split("-").reverse().join("/") : data;
  const valorFmt = valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const servicoLabel = variacao ? `${servico} (${variacao})` : servico;

  const linhas = [
    `Olá! Acabei de fazer o agendamento e estou enviando o comprovante do PIX ✨`,
    clienteNome ? `👤 Cliente: ${clienteNome}` : "",
    `💅 Serviço: ${servicoLabel}`,
    `📅 Data: ${dataFmt} às ${horario}`,
    `💰 Valor do PIX: ${valorFmt}`,
  ].filter(Boolean);

  return `https://wa.me/${digits}?text=${encodeURIComponent(linhas.join("\n"))}`;
}
