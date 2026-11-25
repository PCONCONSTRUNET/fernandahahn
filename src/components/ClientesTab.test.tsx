import { useState } from "react";
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ClientesTab, { ClienteProfile, ClienteAgendamento } from "@/components/ClientesTab";

const mockAgendamentos: ClienteAgendamento[] = [
  {
    id: "ag-1",
    servico: "Fine Line",
    variacao: null,
    data_agendamento: "2026-11-20",
    horario: "14:00",
    valor: 300,
    valor_pago: 300,
    status: "concluido",
    user_id: "c-vip",
    cliente_nome: "Ana VIP",
  },
  {
    id: "ag-2",
    servico: "Micro",
    variacao: null,
    data_agendamento: "2026-11-24",
    horario: "16:00",
    valor: 450,
    valor_pago: 450,
    status: "confirmado",
    user_id: "c-vip",
    cliente_nome: "Ana VIP",
  },
  {
    id: "ag-3",
    servico: "Tattoo Floral",
    variacao: null,
    data_agendamento: "2026-11-25",
    horario: "10:00",
    valor: 500,
    valor_pago: 150,
    status: "confirmado",
    user_id: "c-dev",
    cliente_nome: "Bruna Devedora",
  },
];

const initialClientes: ClienteProfile[] = [
  {
    id: "c-vip",
    nome: "Ana VIP",
    whatsapp: "51999991111",
    created_at: "2026-10-01T10:00:00Z",
    credito_saldo: 100,
  },
  {
    id: "c-dev",
    nome: "Bruna Devedora",
    whatsapp: "51988882222",
    created_at: "2026-11-10T10:00:00Z",
    credito_saldo: 0,
  },
];

function Harness({
  seedClientes = initialClientes,
  seedAgendamentos = mockAgendamentos,
  onBookClient = vi.fn(),
}: {
  seedClientes?: ClienteProfile[];
  seedAgendamentos?: ClienteAgendamento[];
  onBookClient?: (c: ClienteProfile) => void;
}) {
  const [clientes, setClientes] = useState<ClienteProfile[]>(seedClientes);
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const handleRegister = async (
    nome: string,
    telefone: string,
    opts?: { cpf?: string; creditoInicial?: number }
  ) => {
    const newClient: ClienteProfile = {
      id: `new-${clientes.length + 1}`,
      nome,
      whatsapp: telefone,
      cpf: opts?.cpf || null,
      created_at: "2026-11-25T12:00:00Z",
      credito_saldo: opts?.creditoInicial || 0,
    };
    setClientes((prev) => [newClient, ...prev]);
    return { id: newClient.id, nome: newClient.nome, whatsapp: newClient.whatsapp, existing: false };
  };

  return (
    <ClientesTab
      clientes={clientes}
      setClientes={setClientes}
      agendamentos={seedAgendamentos}
      searchTerm={searchTerm}
      setSearchTerm={setSearchTerm}
      selectedClientId={selectedId}
      onSelectClientId={setSelectedId}
      onReload={async () => {}}
      onRegisterClient={handleRegister}
      onBookClient={onBookClient}
    />
  );
}

describe("ClientesTab", () => {
  it("exibe estado vazio acolhedor com botão para cadastrar primeira cliente", () => {
    render(<Harness seedClientes={[]} seedAgendamentos={[]} />);
    expect(screen.getByText(/Nenhuma cliente cadastrada ainda/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Cadastrar primeira cliente/i })).toBeInTheDocument();
  });

  it("permite cadastrar nova cliente com máscara de WhatsApp e abre a ficha criada", async () => {
    render(<Harness seedClientes={[]} seedAgendamentos={[]} />);

    fireEvent.click(screen.getByRole("button", { name: /Nova Cliente/i }));
    fireEvent.change(screen.getByPlaceholderText(/Maria Clara Silva/i), {
      target: { value: "Mariana Souza" },
    });
    const phoneInput = screen.getByPlaceholderText(/\(00\) 00000-0000/i);
    fireEvent.change(phoneInput, { target: { value: "51991234567" } });
    expect((phoneInput as HTMLInputElement).value).toBe("(51) 99123-4567");

    fireEvent.click(screen.getByRole("button", { name: /Cadastrar Cliente/i }));

    await waitFor(() => {
      expect(screen.getAllByText("Mariana Souza").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("filtra corretamente por pendência, VIP, crédito e busca por nome", () => {
    render(<Harness />);

    expect(screen.getByText("Ana VIP")).toBeInTheDocument();
    expect(screen.getByText("Bruna Devedora")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Com pendência/i }));
    expect(screen.queryByText("Ana VIP")).not.toBeInTheDocument();
    expect(screen.getByText("Bruna Devedora")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /VIP \(2\+\)/i }));
    expect(screen.getByText("Ana VIP")).toBeInTheDocument();
    expect(screen.queryByText("Bruna Devedora")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Todas/i }));
    fireEvent.change(screen.getByPlaceholderText(/Buscar cliente/i), {
      target: { value: "Bruna" },
    });
    expect(screen.queryByText("Ana VIP")).not.toBeInTheDocument();
    expect(screen.getByText("Bruna Devedora")).toBeInTheDocument();
  });

  it("aciona o atalho de agendar direto para a cliente", () => {
    const onBookClient = vi.fn();
    render(<Harness onBookClient={onBookClient} />);

    const bookButtons = screen.getAllByRole("button", { name: /Agendar/i });
    fireEvent.click(bookButtons[0]);
    expect(onBookClient).toHaveBeenCalledTimes(1);
  });
});
