import { useState } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfirmProvider } from "@/contexts/ConfirmContext";
import PedidosTab from "@/components/PedidosTab";
import PagamentosTab from "@/components/PagamentosTab";
import CaixaTab from "@/components/CaixaTab";
import GastosTab from "@/components/GastosTab";
import { recordLocalCaixaMovimentacao, toLocalDateISO } from "@/lib/caixa";
import { ClienteProfile } from "@/components/ClienteFichaModal";

if (
  typeof globalThis.localStorage === "undefined" ||
  typeof globalThis.localStorage.clear !== "function"
) {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    writable: true,
    value: {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => store.set(k, String(v)),
      removeItem: (k: string) => store.delete(k),
      clear: () => store.clear(),
      key: (i: number) => Array.from(store.keys())[i] ?? null,
      get length() {
        return store.size;
      },
    },
  });
}

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

describe("PedidosTab com ficha completa, status clicáveis e filtros", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  const sampleAgs = [
    {
      id: "ag-1",
      servico: "Fine Line",
      variacao: null,
      data_agendamento: "2026-11-25",
      horario: "14:00",
      valor: 400,
      valor_pago: 100,
      status: "confirmado",
      user_id: "cli-1",
      created_at: "2026-11-20T10:00:00Z",
      cliente_nome: "Juliana Mendes",
      forma_pagamento: "pix",
    },
    {
      id: "ag-2",
      servico: "Retoque",
      variacao: null,
      data_agendamento: "2026-11-10",
      horario: "10:00",
      valor: 200,
      valor_pago: 150,
      status: "concluido",
      user_id: "cli-1",
      created_at: "2026-11-10T10:00:00Z",
      cliente_nome: "Juliana Mendes",
      forma_pagamento: "pix",
    },
  ];

  const seedClientes: ClienteProfile[] = [
    {
      id: "cli-1",
      nome: "Juliana Mendes",
      whatsapp: "51999887766",
      created_at: "2026-10-01T10:00:00Z",
      credito_saldo: 50,
    },
  ];

  function Harness() {
    const [clientes, setClientes] = useState<ClienteProfile[]>(seedClientes);
    return (
      <ConfirmProvider>
        <PedidosTab
          agendamentos={sampleAgs}
          getClientName={(uid, nome) => clientes.find((c) => c.id === uid)?.nome || nome || "Presencial"}
          clientes={clientes}
          setClientes={setClientes}
          onUpdate={vi.fn()}
          onBookClient={vi.fn()}
        />
      </ConfirmProvider>
    );
  }

  it("mostra saldo total em aberto, filtra pelos cards clicáveis e abre a ficha completa da cliente", async () => {
    render(<Harness />);

    expect(screen.getAllByText(/Deve R\$\s*350,00 no total/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/Crédito R\$\s*50,00/i).length).toBeGreaterThanOrEqual(1);

    // Clicar em Concluídos filtra para apenas Retoque
    fireEvent.click(screen.getByRole("button", { name: /Concluídos/i }));
    expect(screen.getByText("Retoque")).toBeInTheDocument();
    expect(screen.queryByText("Fine Line")).not.toBeInTheDocument();

    // Limpar filtros volta todos
    fireEvent.click(screen.getByRole("button", { name: /Limpar filtros/i }));
    expect(screen.getByText("Fine Line")).toBeInTheDocument();

    const fichaButtons = screen.getAllByRole("button", { name: /^Ficha$/i });
    fireEvent.click(fichaButtons[0]);

    await waitFor(() => {
      expect(screen.getByText(/Histórico de atendimentos/i)).toBeInTheDocument();
    });
    expect(screen.getByText("(51) 99988-7766")).toBeInTheDocument();
    expect(screen.getByText(/2 atendimentos em aberto/i)).toBeInTheDocument();
  });
});

describe("CaixaTab configuração de comissão e dia de fechamento", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("abre modal Configurar Caixa, salva % de comissão e dia de fechamento", async () => {
    render(
      <CaixaTab
        agendamentos={[]}
        getClientName={(_, nome) => nome || "Cliente"}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Configurar Caixa/i }));

    await waitFor(() => {
      expect(screen.getByText(/Configurações do Caixa/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: "50%" }));
    fireEvent.click(screen.getByRole("button", { name: "Dia 10" }));
    fireEvent.click(screen.getByRole("button", { name: /Salvar Configurações/i }));

    await waitFor(() => {
      expect(screen.getByText(/Comissão \(50%\)/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Fechamento: dia 10/i)).toBeInTheDocument();
    expect(globalThis.localStorage.getItem("studio_comissao_pct")).toBe("50");
    expect(globalThis.localStorage.getItem("studio_caixa_dia_fechamento")).toBe("10");
  });

  it("permite retirar comissão no Caixa e exibe no extrato como saída de comissão", async () => {
    render(
      <CaixaTab
        agendamentos={[]}
        getClientName={(_, nome) => nome || "Cliente"}
      />
    );

    fireEvent.click(screen.getByRole("button", { name: /Retirar Comissão/i }));

    await waitFor(() => {
      expect(screen.getByText(/Confirmar Retirada/i)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText("0,00");
    fireEvent.change(input, { target: { value: "10000" } });
    expect((input as HTMLInputElement).value).toBe("100,00");

    fireEvent.click(screen.getByRole("button", { name: /Confirmar Retirada/i }));

    await waitFor(() => {
      expect(screen.getByText(/Saída \(Comissão\)/i)).toBeInTheDocument();
    });

    // Ao clicar no lançamento do extrato, abre o modal completo com data e detalhes
    fireEvent.click(screen.getByText(/Saída \(Comissão\)/i));
    await waitFor(() => {
      expect(screen.getByText(/Data do lançamento/i)).toBeInTheDocument();
    });

    // Também permite excluir o lançamento pelo modal de detalhes
    fireEvent.click(screen.getByRole("button", { name: /^Excluir$/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Sim, excluir/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Sim, excluir/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Retirada de Comissão/i)).not.toBeInTheDocument();
    });
  });

  it("permite excluir entrada registrada no extrato do Caixa pelo botão da linha", async () => {
    const hoje = toLocalDateISO(new Date());
    recordLocalCaixaMovimentacao({
      referencia_tipo: "agendamento",
      referencia_id: "ag-manual-del",
      tipo: "entrada",
      valor: 120,
      forma_pagamento: "pix",
      data_pagamento: hoje,
      origem: "manual",
      descricao: "Entrada Manual",
      cliente_nome: "Lançamento Avulso Teste",
      contabiliza_comissao: true,
      inferido: false,
    });

    render(
      <ConfirmProvider>
        <CaixaTab
          agendamentos={[]}
          getClientName={(_, nome) => nome || "Cliente"}
        />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Lançamento Avulso Teste/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /Excluir lançamento/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /^Excluir$/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /^Excluir$/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Lançamento Avulso Teste/i)).not.toBeInTheDocument();
    });
  });

  it("exibe retiradas de comissão também na aba Pagamentos, abre detalhes e permite excluir", async () => {
    const hoje = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();

    globalThis.localStorage.setItem(
      "studio_caixa_retiradas_preview",
      JSON.stringify([
        {
          id: "ret-test-1",
          descricao: "Retirada de Comissão",
          observacao: "Retirada de comissão pelo Caixa",
          valor: 100,
          categoria: "Comissão",
          tipo: "comissao",
          data_vencimento: hoje,
          data_pagamento: hoje,
          pago: true,
        },
      ])
    );

    render(
      <ConfirmProvider>
        <PagamentosTab
          agendamentos={[]}
          getClientName={(_, nome) => nome || "Cliente"}
        />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(screen.getByText(/Retiradas de Comissão \(1\)/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText(/Retirada de Comissão/i));
    await waitFor(() => {
      expect(screen.getByText(/Data da retirada/i)).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole("button", { name: /^Excluir$/i }));
    await waitFor(() => {
      expect(screen.getByRole("button", { name: /Sim, excluir/i })).toBeInTheDocument();
    });
    fireEvent.click(screen.getByRole("button", { name: /Sim, excluir/i }));

    await waitFor(() => {
      expect(screen.queryByText(/Retiradas de Comissão \(1\)/i)).not.toBeInTheDocument();
    });
  });
});

describe("GastosTab modal compacto mobile", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("abre modal compacto de Novo Gasto, expande observação sob demanda e registra gasto", async () => {
    render(
      <ConfirmProvider>
        <GastosTab />
      </ConfirmProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /\+ Novo Gasto/i }));

    await waitFor(() => {
      expect(screen.getByText(/Esse gasto é:/i)).toBeInTheDocument();
    });

    expect(screen.queryByPlaceholderText(/Ex: Pago no PIX/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /\+ Adicionar observação/i }));
    expect(screen.getByPlaceholderText(/Ex: Pago no PIX/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /\+ Agulhas \/ Tintas/i }));
    const valorInput = screen.getByPlaceholderText("0,00");
    fireEvent.change(valorInput, { target: { value: "7500" } });

    const obsInput = screen.getByPlaceholderText(/Ex: Pago no PIX/i);
    fireEvent.change(obsInput, { target: { value: "Fornecedor centro" } });

    fireEvent.click(screen.getByRole("button", { name: /Registrar Gasto/i }));

    await waitFor(() => {
      expect(screen.getByText(/Agulhas \/ Tintas/i)).toBeInTheDocument();
    });
    expect(screen.getByText(/Fornecedor centro/i)).toBeInTheDocument();
  });
});

describe("PagamentosTab layout mobile", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("exibe cartões alinhados, filtros sem corte e lista clientes pendentes", () => {
    render(
      <ConfirmProvider>
        <PagamentosTab
          agendamentos={[
            {
              id: "pg-1",
              servico: "Micro Shadow",
              variacao: null,
              data_agendamento: "2026-11-25",
              horario: "15:00",
              valor: 300,
              valor_pago: 100,
              status: "confirmado",
              created_at: "2026-11-25T12:00:00Z",
              user_id: "u1",
              duracao_minutos: 90,
              forma_pagamento: "pix",
              cliente_nome: "Carla Dias",
            },
          ]}
          getClientName={(_, nome) => nome || "Cliente"}
        />
      </ConfirmProvider>
    );

    expect(screen.getByText("Devedoras")).toBeInTheDocument();
    expect(screen.getByText("Carla Dias")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Receber$/i })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Cobrar$/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cancelados/i })).toBeInTheDocument();
  });

  it("registra pagamento parcial de pendência e lança parcela identificada no Caixa", async () => {
    const hojeISO = (() => {
      const d = new Date();
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    })();

    const pendingAgs = [
      {
        id: "pg-parcela-1",
        servico: "Extensão de Cílios",
        variacao: null,
        data_agendamento: hojeISO,
        horario: "14:00",
        valor: 300,
        valor_pago: 0,
        status: "confirmado",
        created_at: `${hojeISO}T10:00:00Z`,
        user_id: "u-parc",
        duracao_minutos: 90,
        forma_pagamento: "pix",
        cliente_nome: "Fernanda Silva",
      },
    ];

    render(
      <ConfirmProvider>
        <PagamentosTab
          agendamentos={pendingAgs}
          getClientName={(_, nome) => nome || "Cliente"}
        />
        <CaixaTab
          agendamentos={pendingAgs}
          getClientName={(_, nome) => nome || "Cliente"}
        />
      </ConfirmProvider>
    );

    fireEvent.click(screen.getByRole("button", { name: /^Receber$/i }));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Ex: Sinal da tatuagem/i)).toBeInTheDocument();
    });

    const valorInput = screen.getByPlaceholderText("0,00");
    fireEvent.change(valorInput, { target: { value: "100,00" } });
    fireEvent.change(screen.getByPlaceholderText(/Ex: Sinal da tatuagem/i), {
      target: { value: "1ª parcela combinada" },
    });

    fireEvent.click(screen.getByRole("button", { name: /Confirmar/i }));

    await waitFor(() => {
      expect(screen.getAllByText(/Parcela 1/i).length).toBeGreaterThan(0);
    });
    expect(screen.getAllByText(/1ª parcela combinada/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\+ R\$ 100,00/i).length).toBeGreaterThan(0);
  });

  it("limita a listagem inicial a 15 registros e carrega mais ao clicar em Ver mais", async () => {
    const manyAgs = Array.from({ length: 18 }, (_, i) => ({
      id: `pg-many-${i + 1}`,
      servico: "Design",
      variacao: null,
      data_agendamento: "2026-11-25",
      horario: "10:00",
      valor: 100,
      valor_pago: 0,
      status: "confirmado",
      created_at: "2026-11-25T10:00:00Z",
      user_id: `u-many-${i + 1}`,
      duracao_minutos: 30,
      forma_pagamento: "pix",
      cliente_nome: `Cliente ${String(i + 1).padStart(2, "0")}`,
    }));

    render(
      <ConfirmProvider>
        <PagamentosTab
          agendamentos={manyAgs}
          getClientName={(_, nome) => nome || "Cliente"}
        />
      </ConfirmProvider>
    );

    expect(screen.getByText("Cliente 01")).toBeInTheDocument();
    expect(screen.queryByText("Cliente 16")).not.toBeInTheDocument();

    const loadMoreBtn = screen.getByRole("button", { name: /Ver mais 3 clientes/i });
    fireEvent.click(loadMoreBtn);

    await waitFor(() => {
      expect(screen.getByText("Cliente 16")).toBeInTheDocument();
    });
    expect(screen.getByText("Cliente 18")).toBeInTheDocument();
  });
});
