import { describe, it, expect } from "vitest";
import {
  generatePixPayload,
  normalizePixKey,
  detectPixKeyType,
  buildPixComprovanteWhatsappUrl,
} from "./pix";

describe("pix utilities", () => {
  it("normalizes phone, email, cpf and random PIX keys", () => {
    expect(normalizePixKey("(48) 99977-9829", "telefone")).toBe("+5548999779829");
    expect(normalizePixKey("+5548999779829", "telefone")).toBe("+5548999779829");
    expect(normalizePixKey("  Fernanda@Studio.COM ", "email")).toBe("fernanda@studio.com");
    expect(normalizePixKey("123.456.789-01", "cpf")).toBe("12345678901");
    expect(detectPixKeyType("contato@fernanda.com")).toBe("email");
    expect(detectPixKeyType("+5548999779829")).toBe("telefone");
  });

  it("generates valid EMV BR Code payload using configured key and amount", () => {
    const payload = generatePixPayload({
      key: "contato@fernandahahn.com",
      amount: 170,
      merchantName: "Fernanda Hahn",
    });
    expect(payload).toContain("br.gov.bcb.pix");
    expect(payload).toContain("contato@fernandahahn.com");
    expect(payload).toContain("5406170.00");
    expect(payload).toContain("FERNANDA HAHN");
    expect(payload).toMatch(/6304[0-9A-F]{4}$/);

    // Garante que mudar a chave muda o payload e o CRC
    const otherPayload = generatePixPayload({
      key: "+5548999779829",
      amount: 170,
    });
    expect(otherPayload).toContain("+5548999779829");
    expect(otherPayload).not.toBe(payload);
  });

  it("builds WhatsApp comprovante URL with formatted booking summary", () => {
    const url = buildPixComprovanteWhatsappUrl({
      whatsappDestino: "(48) 99691-5303",
      clienteNome: "Carla Dias",
      servico: "Micropigmentação Fio a Fio",
      data: "2026-12-01",
      horario: "14:00",
      valor: 550,
    });
    expect(url.startsWith("https://wa.me/5548996915303?text=")).toBe(true);
    const decoded = decodeURIComponent(url.split("text=")[1]);
    expect(decoded).toContain("Carla Dias");
    expect(decoded).toContain("Micropigmentação Fio a Fio");
    expect(decoded).toContain("01/12/2026");
    expect(decoded).toContain("14:00");
    expect(decoded).toContain("550,00");
  });
});
