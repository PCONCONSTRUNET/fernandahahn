import { describe, it, expect, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ConfirmProvider } from "@/contexts/ConfirmContext";
import HorariosTab from "@/components/HorariosTab";
import ServicosTab from "@/components/ServicosTab";

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

describe("HorariosTab simplificado", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("exibe os 7 dias da semana e horários do dia selecionado em vez de ficar vazio", async () => {
    render(<HorariosTab />);

    await waitFor(() => {
      expect(screen.queryByText(/Carregando horários/i)).not.toBeInTheDocument();
    });

    expect(screen.getByText("Segunda-feira")).toBeInTheDocument();
    expect(screen.getByText("Sábado")).toBeInTheDocument();
    expect(screen.getByText("Domingo")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Salvar Horários/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Repetir Segunda em Ter–Sex/i })).toBeInTheDocument();
    expect(screen.getByText("09:00")).toBeInTheDocument();
  });

  it("permite alternar dia aberto/fechado e bloquear/desbloquear um horário", async () => {
    render(<HorariosTab />);

    await waitFor(() => {
      expect(screen.getByText("09:00")).toBeInTheDocument();
    });

    const slotBtn = screen.getByRole("button", { name: "09:00" });
    fireEvent.click(slotBtn);
    expect(screen.getByText(/1 bloqueado/i)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Alternar Domingo/i }));
    expect(screen.getByText(/7 dias abertos/i)).toBeInTheDocument();
  });
});

describe("ServicosTab simplificado", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("exibe tela simplificada e permite cadastrar serviço com máscara em R$ e atalho de duração", async () => {
    render(
      <ConfirmProvider>
        <ServicosTab />
      </ConfirmProvider>
    );

    await waitFor(() => {
      expect(screen.queryByText(/Carregando serviços/i)).not.toBeInTheDocument();
    });

    expect(screen.getByText(/Nenhum serviço cadastrado ainda/i)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Novo Serviço/i }));

    fireEvent.change(screen.getByPlaceholderText(/Micropigmentação Fio a Fio/i), {
      target: { value: "Tattoo Fine Line" },
    });

    const priceInput = screen.getByPlaceholderText("0,00");
    fireEvent.change(priceInput, { target: { value: "35000" } });
    expect((priceInput as HTMLInputElement).value).toBe("350,00");

    fireEvent.click(screen.getByRole("button", { name: "1h30" }));
    fireEvent.click(screen.getByRole("button", { name: /Criar Serviço/i }));

    await waitFor(() => {
      expect(screen.getByText("Tattoo Fine Line")).toBeInTheDocument();
    });
    expect(screen.getByText("1h30")).toBeInTheDocument();
  });
});
