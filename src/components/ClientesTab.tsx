import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import {
  Users,
  Search,
  X,
  Plus,
  Download,
  Calendar,
  Sparkles,
  Wallet,
  AlertCircle,
  CheckCircle2,
  Clock,
  ArrowUpDown,
} from "lucide-react";
import {
  formatWhatsappMask,
  formatCurrencyMask,
  parseCurrencyStr,
} from "@/lib/utils";
import { normalizeWhatsappNumber } from "@/lib/notify-webhook";
import WhatsAppIcon from "@/components/icons/WhatsAppIcon";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import ClienteFichaModal, {
  ClienteProfile,
  ClienteAgendamento,
  ClientMetrics,
  computeClientMetrics,
  formatDateShort,
  formatWhatsappDisplay,
  formatBRL,
  openClienteWhatsapp,
} from "@/components/ClienteFichaModal";

export type { ClienteProfile, ClienteAgendamento };

type FiltroCliente = "todas" | "pendencia" | "vip" | "credito";
type OrdenacaoCliente = "recentes" | "gasto" | "visitas" | "nome";

interface ClientesTabProps {
  clientes: ClienteProfile[];
  setClientes: React.Dispatch<React.SetStateAction<ClienteProfile[]>>;
  searchClientes?: ClienteProfile[];
  agendamentos: ClienteAgendamento[];
  searchTerm: string;
  setSearchTerm: (term: string) => void;
  selectedClientId: string | null;
  onSelectClientId: (id: string | null) => void;
  onReload: () => Promise<void> | void;
  onRegisterClient: (
    nome: string,
    telefone: string,
    opts?: { cpf?: string; creditoInicial?: number }
  ) => Promise<{ id: string; nome: string; whatsapp: string; existing: boolean }>;
  onBookClient?: (cliente: ClienteProfile) => void;
}

const formatCpfMask = (raw: string) => {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 6) return `${digits.slice(0, 3)}.${digits.slice(3)}`;
  if (digits.length <= 9) return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6)}`;
  return `${digits.slice(0, 3)}.${digits.slice(3, 6)}.${digits.slice(6, 9)}-${digits.slice(9)}`;
};

/**
 * Painel de gestão de clientes do estúdio: KPIs, busca, filtros rápidos,
 * cadastro direto, atalhos de WhatsApp/agendamento e ficha completa.
 */
const ClientesTab = ({
  clientes,
  setClientes,
  searchClientes = [],
  agendamentos,
  searchTerm,
  setSearchTerm,
  selectedClientId,
  onSelectClientId,
  onReload,
  onRegisterClient,
  onBookClient,
}: ClientesTabProps) => {
  const [filtro, setFiltro] = useState<FiltroCliente>("todas");
  const [ordenacao, setOrdenacao] = useState<OrdenacaoCliente>("recentes");
  const [visibleCount, setVisibleCount] = useState(15);

  useEffect(() => {
    setVisibleCount(15);
  }, [filtro, ordenacao, searchTerm]);

  // Modal de nova cliente
  const [createOpen, setCreateOpen] = useState(false);
  const [createNome, setCreateNome] = useState("");
  const [createWhatsapp, setCreateWhatsapp] = useState("");
  const [createCpf, setCreateCpf] = useState("");
  const [createCredito, setCreateCredito] = useState("");
  const [creating, setCreating] = useState(false);

  const agendamentosByUser = useMemo(() => {
    const map = new Map<string, ClienteAgendamento[]>();
    for (const a of agendamentos) {
      if (!a.user_id) continue;
      const list = map.get(a.user_id);
      if (list) list.push(a);
      else map.set(a.user_id, [a]);
    }
    return map;
  }, [agendamentos]);

  const metricsByUser = useMemo(() => {
    const map = new Map<string, ClientMetrics>();
    for (const c of clientes) {
      map.set(c.id, computeClientMetrics(agendamentosByUser.get(c.id) || []));
    }
    for (const c of searchClientes) {
      if (!map.has(c.id)) {
        map.set(c.id, computeClientMetrics(agendamentosByUser.get(c.id) || []));
      }
    }
    return map;
  }, [clientes, searchClientes, agendamentosByUser]);

  // Une lista local e resultados remotos sem apagar clientes ao buscar offline
  const mergedClientes = useMemo(() => {
    if (!searchTerm.trim()) return clientes;
    const byId = new Map<string, ClienteProfile>();
    for (const c of clientes) byId.set(c.id, c);
    for (const c of searchClientes) byId.set(c.id, c);
    return Array.from(byId.values());
  }, [clientes, searchClientes, searchTerm]);

  const summary = useMemo(() => {
    let ativas = 0;
    let comPendencia = 0;
    let totalPendencia = 0;
    let vipCount = 0;
    let comCredito = 0;
    let receitaTotal = 0;

    for (const c of clientes) {
      const m = metricsByUser.get(c.id) || computeClientMetrics([]);
      if (m.realizadas > 0) ativas += 1;
      if (m.realizadas >= 2) vipCount += 1;
      if (m.saldoDevedor > 0.01) {
        comPendencia += 1;
        totalPendencia += m.saldoDevedor;
      }
      if (Number(c.credito_saldo || 0) > 0) comCredito += 1;
      receitaTotal += m.totalGasto;
    }

    return {
      total: clientes.length,
      ativas,
      comPendencia,
      totalPendencia,
      vipCount,
      comCredito,
      receitaTotal,
    };
  }, [clientes, metricsByUser]);

  const filteredAndSortedClientes = useMemo(() => {
    const cleanQuery = searchTerm.trim().toLowerCase();
    const cleanDigits = searchTerm.replace(/\D/g, "");

    const list = mergedClientes.filter((c) => {
      if (cleanQuery) {
        const nomeMatch = (c.nome || "").toLowerCase().includes(cleanQuery);
        const wppDigits = (c.whatsapp || "").replace(/\D/g, "");
        const cpfDigits = (c.cpf || "").replace(/\D/g, "");
        const phoneMatch = cleanDigits.length > 0 && wppDigits.includes(cleanDigits);
        const cpfMatch = cleanDigits.length > 0 && cpfDigits.includes(cleanDigits);
        if (!nomeMatch && !phoneMatch && !cpfMatch) return false;
      }

      const m = metricsByUser.get(c.id) || computeClientMetrics([]);
      if (filtro === "pendencia") return m.saldoDevedor > 0.01;
      if (filtro === "vip") return m.realizadas >= 2;
      if (filtro === "credito") return Number(c.credito_saldo || 0) > 0;
      return true;
    });

    return [...list].sort((a, b) => {
      const ma = metricsByUser.get(a.id) || computeClientMetrics([]);
      const mb = metricsByUser.get(b.id) || computeClientMetrics([]);

      if (ordenacao === "gasto") return mb.totalGasto - ma.totalGasto;
      if (ordenacao === "visitas") return mb.totalAgendamentos - ma.totalAgendamentos;
      if (ordenacao === "nome") return a.nome.localeCompare(b.nome, "pt-BR");
      return (b.created_at || "").localeCompare(a.created_at || "");
    });
  }, [mergedClientes, metricsByUser, searchTerm, filtro, ordenacao]);

  const selProfile = useMemo(
    () => mergedClientes.find((c) => c.id === selectedClientId) || null,
    [mergedClientes, selectedClientId]
  );

  const selAgendamentos = useMemo(
    () => (selectedClientId ? agendamentosByUser.get(selectedClientId) || [] : []),
    [agendamentosByUser, selectedClientId]
  );

  const resetCreateModal = () => {
    setCreateNome("");
    setCreateWhatsapp("");
    setCreateCpf("");
    setCreateCredito("");
  };

  const handleCreateClient = async () => {
    const cleanNome = createNome.trim();
    const cleanPhone = createWhatsapp.replace(/\D/g, "");
    const cleanCpf = createCpf.replace(/\D/g, "");
    const creditoInicial = Math.max(0, parseCurrencyStr(createCredito));

    if (cleanNome.length < 2) {
      toast.error("Informe o nome completo da cliente");
      return;
    }
    if (cleanPhone.length < 10) {
      toast.error("Informe um WhatsApp válido com DDD");
      return;
    }
    if (cleanCpf && cleanCpf.length !== 11) {
      toast.error("Se informado, o CPF deve ter 11 dígitos");
      return;
    }

    setCreating(true);
    try {
      const res = await onRegisterClient(cleanNome, cleanPhone, {
        cpf: cleanCpf || undefined,
        creditoInicial: creditoInicial > 0 ? creditoInicial : undefined,
      });
      toast.success(
        res.existing
          ? `${res.nome} já estava cadastrada e foi aberta!`
          : `${res.nome} cadastrada com sucesso!`
      );
      setCreateOpen(false);
      resetCreateModal();
      onSelectClientId(res.id);
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível cadastrar a cliente");
    } finally {
      setCreating(false);
    }
  };

  const exportCsv = () => {
    const header = "Nome,WhatsApp,Agendamentos,Total Pago (R$),Em Aberto (R$),Credito (R$),Cliente Desde\n";
    const rows = clientes
      .map((c) => {
        const m = metricsByUser.get(c.id) || computeClientMetrics([]);
        return `"${(c.nome || "").replace(/"/g, '""')}","${c.whatsapp || ""}",${m.totalAgendamentos},${m.totalGasto.toFixed(2)},${m.saldoDevedor.toFixed(2)},${Number(c.credito_saldo || 0).toFixed(2)},"${new Date(c.created_at).toLocaleDateString("pt-BR")}"`;
      })
      .join("\n");
    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `clientes_${new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const filterChips: { id: FiltroCliente; label: string; count: number }[] = [
    { id: "todas", label: "Todas", count: summary.total },
    { id: "pendencia", label: "Com pendência", count: summary.comPendencia },
    { id: "vip", label: "VIP (2+)", count: summary.vipCount },
    { id: "credito", label: "Com crédito", count: summary.comCredito },
  ];

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-xl font-semibold text-primary-foreground">Clientes</h2>
            <span className="px-2 py-0.5 rounded-full bg-gold/15 border border-gold/25 font-body text-[11px] font-semibold text-gold tabular-nums">
              {summary.total}
            </span>
          </div>
          <p className="font-body text-[11.5px] text-primary-foreground/55 mt-0.5">
            Cadastre clientes, acompanhe pagamentos e chame direto no WhatsApp
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={exportCsv}
            disabled={clientes.length === 0}
            title="Baixar planilha CSV com todas as clientes"
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.08] text-primary-foreground/75 font-body text-[12px] font-medium hover:bg-primary-foreground/[0.08] hover:text-primary-foreground transition-all disabled:opacity-40"
          >
            <Download className="w-3.5 h-3.5 text-gold/80" />
            <span className="hidden sm:inline">Exportar CSV</span>
          </button>
          <button
            type="button"
            onClick={() => {
              resetCreateModal();
              setCreateOpen(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-br from-gold to-nude text-charcoal font-body text-[12.5px] font-bold shadow-[0_6px_22px_-6px_hsl(23_52%_52%/0.5)] hover:brightness-105 active:scale-[0.98] transition-all"
          >
            <Plus className="w-4 h-4" />
            Nova Cliente
          </button>
        </div>
      </div>

      {/* Cards Resumo */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2.5 sm:gap-3">
        <div className="rounded-2xl border border-primary-foreground/[0.08] bg-[#1b1a1b] p-3.5 sm:p-4">
          <div className="flex items-center justify-between text-primary-foreground/50">
            <span className="font-body text-[10px] uppercase tracking-wider font-semibold">Cadastradas</span>
            <Users className="w-3.5 h-3.5 text-gold/80" />
          </div>
          <p className="font-heading text-[22px] sm:text-[24px] font-bold text-primary-foreground mt-1 tabular-nums">
            {summary.total}
          </p>
          <p className="font-body text-[10.5px] text-primary-foreground/45 mt-0.5">
            {summary.vipCount} recorrente{summary.vipCount !== 1 ? "s" : ""} (VIP)
          </p>
        </div>

        <div className="rounded-2xl border border-emerald-500/20 bg-[#1b1a1b] p-3.5 sm:p-4">
          <div className="flex items-center justify-between text-emerald-400/75">
            <span className="font-body text-[10px] uppercase tracking-wider font-semibold">Ativas</span>
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
          </div>
          <p className="font-heading text-[22px] sm:text-[24px] font-bold text-emerald-400 mt-1 tabular-nums">
            {summary.ativas}
          </p>
          <p className="font-body text-[10.5px] text-emerald-400/60 mt-0.5">
            já têm visita ou horário
          </p>
        </div>

        <button
          type="button"
          onClick={() => setFiltro((prev) => (prev === "pendencia" ? "todas" : "pendencia"))}
          className={`text-left rounded-2xl border p-3.5 sm:p-4 transition-all ${
            filtro === "pendencia"
              ? "border-amber-400/50 bg-amber-500/10"
              : summary.comPendencia > 0
                ? "border-amber-500/25 bg-[#1b1a1b] hover:border-amber-400/40"
                : "border-primary-foreground/[0.08] bg-[#1b1a1b] hover:border-primary-foreground/15"
          }`}
        >
          <div className="flex items-center justify-between text-amber-300/80">
            <span className="font-body text-[10px] uppercase tracking-wider font-semibold">A receber</span>
            <Clock className="w-3.5 h-3.5 text-amber-400" />
          </div>
          <p className="font-heading text-[20px] sm:text-[22px] font-bold text-amber-300 mt-1 tabular-nums truncate">
            {formatBRL(summary.totalPendencia)}
          </p>
          <p className="font-body text-[10.5px] text-amber-300/65 mt-0.5">
            {summary.comPendencia} cliente{summary.comPendencia !== 1 ? "s" : ""} em aberto
          </p>
        </button>

        <div className="rounded-2xl border border-gold/20 bg-gradient-to-br from-[#1f1b19] to-[#171617] p-3.5 sm:p-4">
          <div className="flex items-center justify-between text-gold/80">
            <span className="font-body text-[10px] uppercase tracking-wider font-semibold">Já recebido</span>
            <Wallet className="w-3.5 h-3.5 text-gold" />
          </div>
          <p className="font-heading text-[20px] sm:text-[22px] font-bold text-primary-foreground mt-1 tabular-nums truncate">
            {formatBRL(summary.receitaTotal)}
          </p>
          <p className="font-body text-[10.5px] text-gold/70 mt-0.5">
            total acumulado no estúdio
          </p>
        </div>
      </div>

      {/* Busca, Filtros Rápidos e Ordenação */}
      <div className="space-y-2.5 rounded-2xl border border-primary-foreground/[0.07] bg-primary-foreground/[0.02] p-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary-foreground/45" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar cliente por nome, WhatsApp ou CPF..."
              className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.09] text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/40 focus:outline-none focus:border-gold/40"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm("")}
                aria-label="Limpar busca"
                className="absolute right-3 top-1/2 -translate-y-1/2 text-primary-foreground/50 hover:text-primary-foreground"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="relative sm:w-44 shrink-0">
            <ArrowUpDown className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gold/70 pointer-events-none" />
            <select
              value={ordenacao}
              onChange={(e) => setOrdenacao(e.target.value as OrdenacaoCliente)}
              aria-label="Ordenar clientes"
              className="w-full pl-8 pr-3 py-2.5 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.09] text-primary-foreground font-body text-[12.5px] focus:outline-none focus:border-gold/40 [color-scheme:dark]"
            >
              <option value="recentes" className="bg-[#1c1c1e]">Mais recentes</option>
              <option value="gasto" className="bg-[#1c1c1e]">Maior valor pago</option>
              <option value="visitas" className="bg-[#1c1c1e]">Mais atendimentos</option>
              <option value="nome" className="bg-[#1c1c1e]">Nome (A–Z)</option>
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {filterChips.map((chip) => {
            const active = filtro === chip.id;
            return (
              <button
                key={chip.id}
                type="button"
                onClick={() => setFiltro(chip.id)}
                className={`px-2.5 py-1 rounded-full border font-body text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                  active
                    ? "bg-gold/20 border-gold/45 text-gold"
                    : "bg-primary-foreground/[0.03] border-primary-foreground/[0.08] text-primary-foreground/60 hover:text-primary-foreground"
                }`}
              >
                <span>{chip.label}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[10px] tabular-nums ${
                    active ? "bg-gold/25 text-gold" : "bg-primary-foreground/[0.06] text-primary-foreground/50"
                  }`}
                >
                  {chip.count}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Lista de Clientes ou Estado Vazio */}
      {filteredAndSortedClientes.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-primary-foreground/[0.12] bg-[#191819] py-10 px-6 text-center space-y-3">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-gold/15 border border-gold/25 flex items-center justify-center">
            <Users className="w-6 h-6 text-gold" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="font-heading text-[16px] font-semibold text-primary-foreground">
              {searchTerm || filtro !== "todas"
                ? "Nenhuma cliente encontrada neste filtro"
                : "Nenhuma cliente cadastrada ainda"}
            </h3>
            <p className="font-body text-[12px] text-primary-foreground/55">
              {searchTerm || filtro !== "todas"
                ? "Tente buscar por outro nome ou limpar os filtros para ver todas."
                : "Cadastre suas clientes por aqui ou direto na Agenda ao marcar um novo horário."}
            </p>
          </div>
          <div className="pt-1 flex flex-wrap items-center justify-center gap-2">
            {(searchTerm || filtro !== "todas") && (
              <button
                type="button"
                onClick={() => {
                  setSearchTerm("");
                  setFiltro("todas");
                }}
                className="px-4 py-2 rounded-xl bg-primary-foreground/[0.06] border border-primary-foreground/[0.1] text-primary-foreground/80 font-body text-[12px] font-medium hover:bg-primary-foreground/[0.1] transition-all"
              >
                Limpar filtros
              </button>
            )}
            <button
              type="button"
              onClick={() => {
                resetCreateModal();
                setCreateOpen(true);
              }}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-br from-gold to-nude text-charcoal font-body text-[12.5px] font-bold hover:brightness-105 transition-all"
            >
              <Plus className="w-4 h-4" />
              Cadastrar primeira cliente
            </button>
          </div>
        </div>
      ) : (
        <div className="overflow-y-auto max-h-[62dvh] custom-scrollbar pr-1 pb-4 space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            {filteredAndSortedClientes.slice(0, visibleCount).map((c) => {
            const m = metricsByUser.get(c.id) || computeClientMetrics([]);
            const credito = Number(c.credito_saldo || 0);
            const hasWhatsapp = normalizeWhatsappNumber(c.whatsapp || "").length >= 12;

            return (
              <div
                key={c.id}
                onClick={() => onSelectClientId(c.id)}
                className="group cursor-pointer rounded-2xl border border-primary-foreground/[0.09] bg-[#1b1a1b] p-4 hover:border-gold/35 hover:bg-[#222021] transition-all flex flex-col justify-between gap-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex items-center gap-3.5 flex-1 min-w-0">
                    <div className="w-11 h-11 shrink-0 rounded-2xl bg-gradient-to-br from-gold/25 to-gold/10 border border-gold/25 flex items-center justify-center">
                      <span className="font-heading text-[17px] font-bold text-gold">
                        {(c.nome || "?").charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <p className="font-body text-[15px] font-semibold text-primary-foreground truncate">
                          {c.nome}
                        </p>
                        {m.realizadas >= 2 && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-gold/15 border border-gold/30 font-body text-[9.5px] font-bold uppercase tracking-wider text-gold">
                            <Sparkles className="w-2.5 h-2.5" /> VIP
                          </span>
                        )}
                        {m.saldoDevedor > 0.01 && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-500/15 border border-amber-500/30 font-body text-[9.5px] font-bold text-amber-300">
                            <AlertCircle className="w-2.5 h-2.5" /> Em aberto
                          </span>
                        )}
                        {credito > 0 && (
                          <span className="inline-flex items-center px-1.5 py-0.5 rounded-full bg-sky-500/15 border border-sky-400/30 font-body text-[9.5px] font-semibold text-sky-300">
                            Crédito {formatBRL(credito)}
                          </span>
                        )}
                      </div>
                      <p className="font-body text-[12.5px] text-primary-foreground/55 mt-0.5">
                        {formatWhatsappDisplay(c.whatsapp)}
                      </p>
                      <p className="font-body text-[11px] text-primary-foreground/40 mt-0.5">
                        {m.ultimaVisita
                          ? `Última visita: ${formatDateShort(m.ultimaVisita)}`
                          : "Ainda sem atendimento realizado"}
                      </p>
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-heading text-[15.5px] font-bold text-primary-foreground tabular-nums">
                      {formatBRL(m.totalGasto)}
                    </p>
                    <p className="font-body text-[10.5px] text-primary-foreground/45 mt-0.5">
                      {m.totalAgendamentos} {m.totalAgendamentos === 1 ? "visita" : "visitas"}
                    </p>
                    {m.saldoDevedor > 0.01 && (
                      <p className="font-body text-[10.5px] font-semibold text-amber-300 mt-0.5 tabular-nums">
                        Falta {formatBRL(m.saldoDevedor)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Ações rápidas */}
                <div className="flex items-center justify-between gap-2 pt-2 border-t border-primary-foreground/[0.06]">
                  <div className="flex items-center gap-1.5">
                    {hasWhatsapp && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openClienteWhatsapp(c.whatsapp);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 font-body text-[11px] font-medium hover:bg-emerald-500/20 transition-all"
                      >
                        <WhatsAppIcon className="w-3 h-3" />
                        WhatsApp
                      </button>
                    )}
                    {onBookClient && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onBookClient(c);
                        }}
                        className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-gold/10 border border-gold/25 text-gold font-body text-[11px] font-medium hover:bg-gold/20 transition-all"
                      >
                        <Calendar className="w-3 h-3" />
                        Agendar
                      </button>
                    )}
                  </div>

                  <span className="font-body text-[11px] text-primary-foreground/40 group-hover:text-gold transition-colors">
                    Ver ficha →
                  </span>
                </div>
              </div>
            );
          })}
          </div>
          <LoadMoreButton
            visibleCount={visibleCount}
            totalCount={filteredAndSortedClientes.length}
            step={15}
            onLoadMore={() => setVisibleCount((c) => c + 15)}
            itemLabel="clientes"
          />
        </div>
      )}

      {/* Modal: Nova Cliente */}
      <Dialog
        open={createOpen}
        onOpenChange={(open) => {
          setCreateOpen(open);
          if (!open) resetCreateModal();
        }}
      >
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md max-h-[90dvh] overflow-y-auto overflow-x-hidden rounded-[24px] border border-gold/25 bg-charcoal p-5 shadow-2xl custom-scrollbar">
          <DialogHeader className="mb-1">
            <DialogTitle className="font-heading text-[20px] font-semibold text-primary-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gold/15 border border-gold/30 flex items-center justify-center">
                <Users className="w-4 h-4 text-gold" />
              </div>
              <span>Nova Cliente</span>
            </DialogTitle>
            <p className="font-body text-[11.5px] text-primary-foreground/55 text-left">
              Cadastre rapidamente para agilizar os próximos agendamentos
            </p>
          </DialogHeader>

          <div className="space-y-3.5 pt-2">
            <div className="space-y-1.5">
              <label className="font-body text-[10.5px] uppercase tracking-wider text-primary-foreground/65 font-semibold block">
                Nome completo *
              </label>
              <input
                type="text"
                value={createNome}
                onChange={(e) => setCreateNome(e.target.value)}
                placeholder="Ex: Maria Clara Silva"
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.1] text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/30 focus:outline-none focus:border-gold/45"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-body text-[10.5px] uppercase tracking-wider text-primary-foreground/65 font-semibold block">
                WhatsApp / Telefone *
              </label>
              <input
                type="tel"
                inputMode="numeric"
                value={createWhatsapp}
                onChange={(e) => setCreateWhatsapp(formatWhatsappMask(e.target.value))}
                placeholder="(00) 00000-0000"
                className="w-full px-3.5 py-2.5 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.1] text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/30 focus:outline-none focus:border-gold/45 tabular-nums"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-body text-[10.5px] uppercase tracking-wider text-primary-foreground/65 font-semibold block">
                  CPF <span className="normal-case font-normal text-primary-foreground/40">(opcional)</span>
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  value={createCpf}
                  onChange={(e) => setCreateCpf(formatCpfMask(e.target.value))}
                  placeholder="000.000.000-00"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.1] text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/30 focus:outline-none focus:border-gold/45 tabular-nums"
                />
              </div>

              <div className="space-y-1.5">
                <label className="font-body text-[10.5px] uppercase tracking-wider text-primary-foreground/65 font-semibold block">
                  Crédito inicial{" "}
                  <span className="normal-case font-normal text-primary-foreground/40">(opcional)</span>
                </label>
                <div className="relative">
                  <span className="absolute left-3 top-1/2 -translate-y-1/2 font-body text-[12px] text-primary-foreground/45">
                    R$
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={createCredito}
                    onChange={(e) => setCreateCredito(formatCurrencyMask(e.target.value))}
                    placeholder="0,00"
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.1] text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/30 focus:outline-none focus:border-gold/45 tabular-nums"
                  />
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 pt-2">
              <button
                type="button"
                onClick={() => setCreateOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-primary-foreground/[0.05] text-primary-foreground/75 font-body text-[12.5px] font-medium hover:bg-primary-foreground/[0.1] transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={creating}
                onClick={handleCreateClient}
                className="flex-[1.5] py-2.5 rounded-xl bg-gradient-to-br from-gold to-nude text-charcoal font-body text-[13px] font-bold hover:brightness-105 transition-all disabled:opacity-50"
              >
                {creating ? "Cadastrando..." : "Cadastrar Cliente"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <ClienteFichaModal
        open={!!selectedClientId}
        onOpenChange={(open) => {
          if (!open) onSelectClientId(null);
        }}
        cliente={selProfile}
        clienteAgendamentos={selAgendamentos}
        setClientes={setClientes}
        onReload={onReload}
        onBookClient={onBookClient}
      />
    </div>
  );
};

export default ClientesTab;
