import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const { insertedRows, mockFrom } = vi.hoisted(() => {
  const insertedRows: any[] = [];

  const createQueryBuilder = (table: string) => {
    const q: any = {
      select: () => q,
      eq: (_col: string, _val: any) => q,
      in: () => q,
      gte: () => q,
      lte: () => q,
      order: () => q,
      maybeSingle: async () => {
        if (table === "servicos_app") {
          return {
            data: { duracao_minutos: 60, nome: "Perfuração Básica", preco: 170, descricao: "", categoria: "Perfuração" },
            error: null,
          };
        }
        if (table === "profiles") {
          return { data: { nome: "Carla Dias", whatsapp: "48999990000" }, error: null };
        }
        return { data: null, error: null };
      },
      insert: (row: any) => {
        insertedRows.push({ table, row });
        return {
          select: () => ({
            single: async () => ({ data: { id: "ag-novo-1" }, error: null }),
          }),
        };
      },
      update: () => q,
      then: (resolve: (val: any) => void) => {
        if (table === "horarios_funcionamento") {
          return resolve({
            data: [0, 1, 2, 3, 4, 5, 6].map((dia) => ({
              dia_semana: dia,
              aberto: true,
              hora_inicio: "09:00",
              hora_fim: "19:00",
            })),
            error: null,
          });
        }
        if (table === "gateway_configs") {
          return resolve({
            data: [
              {
                id: "gw-pix",
                gateway: "pix_direto",
                access_token: "financeiro@fernandahahn.com",
                public_key: "FERNANDA HAHN",
                whatsapp_comprovante: "5548996915303",
                ativo: true,
                pix_enabled: true,
                cartao_enabled: false,
                boleto_enabled: false,
              },
              {
                id: "gw-mp",
                gateway: "mercadopago",
                access_token: "",
                public_key: "",
                ativo: false,
                pix_enabled: true,
                cartao_enabled: false,
                boleto_enabled: false,
              },
            ],
            error: null,
          });
        }
        return resolve({ data: [], error: null });
      },
    };
    return q;
  };

  const mockFrom = vi.fn((table: string) => createQueryBuilder(table));
  return { insertedRows, mockFrom };
});

vi.mock("@/integrations/supabase/client", () => ({
  SUPABASE_URL: "https://test.supabase.co",
  SUPABASE_PUBLISHABLE_KEY: "test-key",
  isSupabaseConfigured: true,
  supabase: {
    auth: {
      getUser: vi.fn(async () => ({
        data: { user: { id: "user-1", email: "carla@test.com", user_metadata: { nome: "Carla Dias" } } },
      })),
    },
    from: mockFrom,
    channel: vi.fn(() => {
      const ch: any = { on: () => ch, subscribe: () => ch };
      return ch;
    }),
    removeChannel: vi.fn(),
  },
}));

vi.mock("@/lib/push-notify", () => ({
  sendPush: vi.fn(async () => {}),
  showLocalNotification: vi.fn(),
}));

import BookingFlow from "./BookingFlow";

describe("BookingFlow PIX Direto (sem gateway)", () => {
  beforeEach(() => {
    insertedRows.length = 0;
  });

  it("gera QR Code e Copia e Cola com a chave salva, cria agendamento confirmado com pagamento pendente e exibe botao do WhatsApp", async () => {
    const onConfirm = vi.fn();
    render(
      <BookingFlow
        service="Perfuração Básica"
        onBack={() => {}}
        onConfirm={onConfirm}
      />
    );

    // Seleciona primeiro dia disponível
    await waitFor(() => {
      expect(screen.getByText("Selecione o dia")).toBeInTheDocument();
    });
    const dayButtons = document.querySelectorAll("button");
    const firstDayBtn = Array.from(dayButtons).find((b) => /\d{1,2}/.test(b.textContent || "") && /(Dom|Seg|Ter|Qua|Qui|Sex|Sáb)/.test(b.textContent || ""));
    expect(firstDayBtn).toBeTruthy();
    fireEvent.click(firstDayBtn!);

    // Seleciona horário 09:00
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "09:00" })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: "09:00" }));
    fireEvent.click(screen.getByRole("button", { name: /Continuar/i }));

    // Tela de confirmação já mostra PIX Direto
    await waitFor(() => {
      expect(screen.getByText("Pagar agora por PIX")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Gerar PIX/i }));

    // Tela de pagamento: status confirmado + pagamento pendente + chave configurada + botão WhatsApp
    await waitFor(() => {
      expect(screen.getByText(/Agendamento Confirmado · Pagamento Pendente/i)).toBeInTheDocument();
    });

    const whatsLink = screen.getByRole("link", { name: /Enviar comprovante no WhatsApp/i });
    expect(whatsLink).toHaveAttribute("href", expect.stringContaining("https://wa.me/5548996915303?text="));

    // Código Copia e Cola contém exatamente a chave configurada na aba Gateway
    expect(screen.getByText(/financeiro@fernandahahn\.com/)).toBeInTheDocument();

    // Verifica que o agendamento foi salvo como confirmado e valor_pago = 0 (pagamento pendente)
    const agInsert = insertedRows.find((r) => r.table === "agendamentos");
    expect(agInsert).toBeTruthy();
    expect(agInsert.row.status).toBe("confirmado");
    expect(agInsert.row.valor_pago).toBe(0);
    expect(agInsert.row.forma_pagamento).toBe("pix");

    // Concluir leva ao onConfirm sem alterar valor_pago
    fireEvent.click(screen.getByRole("button", { name: /Concluir agendamento/i }));
    expect(onConfirm).toHaveBeenCalledWith(expect.objectContaining({ paidAmount: 0 }));
  });
});
