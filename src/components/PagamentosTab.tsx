import { useState, useMemo, useEffect } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  Search, CreditCard, Barcode, Clock, CheckCircle, XCircle,
  ChevronDown, AlertCircle, Trash2, Wallet,
  Edit3, DollarSign, Zap, ListChecks, X, Users,
} from "lucide-react";
import pixIcon from "@/assets/pix-icon.png";
import { useConfirm } from "@/contexts/ConfirmContext";
import { Button } from "@/components/ui/button";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { getPaymentDate } from "@/lib/utils";
import {
  persistAppointmentPayment,
  getLocalPagamentoHistorico,
  deleteLocalPagamentoHistorico,
  recordLocalCaixaMovimentacao,
  toLocalDateISO,
  notifyCaixaUpdated,
} from "@/lib/caixa";

interface Agendamento {
  id: string;
  servico: string;
  variacao: string | null;
  data_agendamento: string;
  horario: string;
  valor: number;
  valor_pago: number | null;
  status: string;
  created_at: string;
  user_id: string;
  duracao_minutos: number;
  forma_pagamento: string | null;
  cliente_nome: string | null;
  valor_gorjeta?: number | null;
  valor_troco?: number | null;
  valor_credito?: number | null;
  valor_desconto_credito?: number | null;
  paid_at?: string | null;
  data_venda?: string | null;
}

interface Props {
  agendamentos: Agendamento[];
  getClientName: (userId: string, clienteNome?: string | null) => string;
  onUpdate?: () => void;
  onEdit?: (ag: any) => void;
}

const formatCurrency = (v: number | string | null | undefined) => {
  const num = Number(v) || 0;
  return num.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
};

const formatDate = (d: string) => {
  if (!d) return "";
  const [y, m, day] = d.split("-");
  return `${day}/${m}/${y}`;
};

const parseCurrencyInput = (s: string): number => {
  const clean = s.replace(/\./g, "").replace(",", ".");
  return parseFloat(clean) || 0;
};

type StatusFilter = "todos" | "pendente" | "pago" | "cancelado";
type SortField = "data" | "valor" | "cliente" | "status";
type SortDir = "asc" | "desc";

interface FaturaPendente {
  id: string;
  servico: string;
  variacao: string;
  valor: number;
  valorPago: number;
  restante: number;
  data: string;
  userId?: string;
}

interface SmartPayModalState {
  clienteNome: string;
  pendentes: FaturaPendente[];
}

interface ClienteGroup {
  key: string;
  clienteNome: string;
  userId: string;
  totalPendente: number;
  totalPago: number;
  countPendente: number;
  faturas: any[];
}

interface GroupedFaturasResult {
  groups: ClienteGroup[];
  saidas: any[];
}

const PagamentosTab = ({ agendamentos, getClientName, onUpdate, onEdit }: Props) => {
  const { confirm } = useConfirm();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("todos");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [sortField, setSortField] = useState<SortField>("data");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  const [dateFilter, setDateFilter] = useState<string>("");

  // Smart payment modal state
  const [smartPayModal, setSmartPayModal] = useState<SmartPayModalState | null>(null);
  const [payMode, setPayMode] = useState<"livre" | "especifica">("livre");
  const [payValor, setPayValor] = useState("");
  const [payForma, setPayForma] = useState("pix");
  const [payObs, setPayObs] = useState("");
  const [paySelectedIds, setPaySelectedIds] = useState<string[]>([]);
  const [payLoading, setPayLoading] = useState(false);

  useEffect(() => {
    if (smartPayModal) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "auto";
    }
    return () => {
      document.body.style.overflow = "auto";
    };
  }, [smartPayModal]);

  const toggleSort = (field: SortField) => {
    if (sortField === field) setSortDir(sortDir === "asc" ? "desc" : "asc");
    else { setSortField(field); setSortDir("desc"); }
  };

  const toggleGroup = (key: string) => {
    setExpandedGroups(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDeleteHistorico = (ag: any) => {
    // ag._faturaId = "uuid-hist-histUUID"
    const histId = ag._faturaId.split("-hist-")[1];
    if (!histId) { toast.error("ID do histórico não encontrado"); return; }

    confirm({
      title: "Reverter Pagamento",
      description: `Deseja reverter o pagamento de ${formatCurrency(ag.valor_fatura)}? O valor pendente da fatura será restaurado.`,
      variant: "destructive",
      onConfirm: async () => {
        try {
          const valorEstorno = Number(ag.valor_fatura || 0);
          if (!isSupabaseConfigured) {
            deleteLocalPagamentoHistorico(histId);
            const currentPaid = Number(ag.valor_pago ?? 0);
            const novoValorPago = Math.max(0, currentPaid - valorEstorno);
            const novoStatus = novoValorPago < Number(ag.valor || 0) ? "confirmado" : "concluido";
            setLocalAgendamentos((prev) =>
              prev.map((item) =>
                item.id === ag.id ? { ...item, valor_pago: novoValorPago, status: novoStatus } : item,
              ),
            );
            recordLocalCaixaMovimentacao({
              referencia_tipo: "agendamento",
              referencia_id: ag.id,
              tipo: "estorno",
              valor: -Math.abs(valorEstorno),
              forma_pagamento: ag.forma_pagamento,
              data_pagamento: toLocalDateISO(new Date()),
              origem: "estorno_manual",
              descricao: `Estorno · ${ag.servico || "Atendimento"}`,
              cliente_nome: ag.cliente_nome,
              contabiliza_comissao: true,
              inferido: false,
            });
            setHistorico(getLocalPagamentoHistorico());
            toast.success("Pagamento revertido com sucesso.");
            if (onUpdate) onUpdate();
            return;
          }

          // Deleta o registro do histórico
          const { error: e1 } = await supabase.from("pagamento_historico").delete().eq("id", histId);
          if (e1) throw e1;

          // Busca dados frescos do agendamento para recalcular com segurança
          const { data: freshAg, error: eFetch } = await supabase
            .from("agendamentos")
            .select("valor, valor_pago")
            .eq("id", ag.id)
            .single();

          if (eFetch) throw eFetch;

          const currentPaid = Number(freshAg?.valor_pago ?? ag.valor_pago ?? 0);
          const novoValorPago = Math.max(0, currentPaid - valorEstorno);
          const novoStatus = novoValorPago < Number(freshAg?.valor ?? ag.valor) ? "confirmado" : "concluido";

          const { error: e2 } = await supabase
            .from("agendamentos")
            .update({ valor_pago: novoValorPago, status: novoStatus } as any)
            .eq("id", ag.id);
          if (e2) throw e2;

          notifyCaixaUpdated();
          toast.success("Pagamento revertido com sucesso.");
          setHistorico([]);
          setRefetchKey(k => k + 1);
          if (onUpdate) onUpdate();
        } catch (error: any) {
          console.error(error);
          toast.error(error.message || "Erro ao reverter pagamento.");
        }
      },
    });
  };

  const handleDelete = (id: string, tableType: "despesas" | "agendamentos") => {
    confirm({
      title: "Excluir Transação",
      description: "Tem certeza que deseja excluir esta transação? Essa ação não pode ser desfeita.",
      variant: "destructive",
      onConfirm: async () => {
        try {
          const { error } = await supabase.from(tableType as any).delete().eq("id", id);
          if (error) throw error;
          toast.success("Transação excluída com sucesso.");
          if (onUpdate) onUpdate();
          else window.location.reload();
        } catch (error: any) {
          console.error(error);
          toast.error(error.message || "Erro ao excluir transação.");
        }
      }
    });
  };

  const paymentIcon = (method: string | null) => {
    switch (method) {
      case "cartao": return <CreditCard className="h-4 w-4" />;
      case "boleto": return <Barcode className="h-4 w-4" />;
      default: return <img src={pixIcon} alt="PIX" className="h-4 w-4" />;
    }
  };

  const paymentLabel = (method: string | null) => {
    switch (method) {
      case "cartao": return "Cartão";
      case "boleto": return "Boleto";
      case "pix": return "PIX";
      default: return method || "PIX";
    }
  };

  const statusConfig: Record<string, { bg: string; text: string; icon: typeof CheckCircle; label: string }> = {
    confirmado: { bg: "bg-blue-500/10 border-blue-500/30", text: "text-blue-400", icon: CheckCircle, label: "Confirmado" },
    concluido: { bg: "bg-emerald-500/10 border-emerald-500/30", text: "text-emerald-400", icon: CheckCircle, label: "Concluído" },
    pendente: { bg: "bg-amber-500/10 border-amber-500/30", text: "text-amber-400", icon: Clock, label: "Pendente" },
    cancelado: { bg: "bg-red-500/10 border-red-500/30", text: "text-red-400", icon: XCircle, label: "Cancelado" },
    falta: { bg: "bg-orange-500/10 border-orange-500/30", text: "text-orange-400", icon: XCircle, label: "Falta" },
    pago: { bg: "bg-rose/10 border-rose/30", text: "text-rose", icon: CheckCircle, label: "Saída" },
    pendente_saida: { bg: "bg-orange-500/10 border-orange-500/30", text: "text-orange-400", icon: Clock, label: "Saída Pendente" },
  };

  const [historico, setHistorico] = useState<any[]>([]);

  const [localAgendamentos, setLocalAgendamentos] = useState<any[]>(() => {
    const seen = new Set<string>();
    return agendamentos.filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; });
  });
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [refetchKey, setRefetchKey] = useState(0);
  const [visibleCount, setVisibleCount] = useState(15);

  useEffect(() => {
    setVisibleCount(15);
  }, [statusFilter, dateFilter, debouncedSearch, sortField, sortDir]);

  useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search), 400);
    return () => clearTimeout(handler);
  }, [search]);

  useEffect(() => {
    let isCancelled = false;

    const fetchHistorico = async () => {
      if (!isSupabaseConfigured) {
        const localHist = getLocalPagamentoHistorico();
        if (!isCancelled) {
          setHistorico(localHist);
          if (refetchKey === 0) {
            const seen = new Set<string>();
            const deduped = (agendamentos || []).filter((a) => {
              if (seen.has(a.id)) return false;
              seen.add(a.id);
              return true;
            });
            setLocalAgendamentos(deduped);
          }
        }
        return;
      }

      let currentAgendamentos = agendamentos || [];
      if (debouncedSearch.trim()) {
        const term = `%${debouncedSearch.trim()}%`;
        const { data: matchedAgs } = await supabase
          .from("agendamentos")
          .select("*")
          .neq("status", "aguardando_pagamento")
          .or(`cliente_nome.ilike.${term},servico.ilike.${term},id.ilike.${term},forma_pagamento.ilike.${term}`)
          .order("data_agendamento", { ascending: false })
          .limit(200);
        if (matchedAgs) currentAgendamentos = matchedAgs as any[];
      }

      if (isCancelled) return;

      const seenIds = new Set<string>();
      currentAgendamentos = currentAgendamentos.filter(a => {
        if (seenIds.has(a.id)) return false;
        seenIds.add(a.id);
        return true;
      });

      const { data: histData } = await supabase
        .from("pagamento_historico")
        .select("id,agendamento_id,valor_delta,acao,observacao,created_at")
        .order("created_at", { ascending: false })
        .limit(500);

      if (isCancelled) return;

      setHistorico(histData || []);
      setLocalAgendamentos(currentAgendamentos);
    };

    fetchHistorico();
    return () => { isCancelled = true; };
  }, [debouncedSearch, refetchKey, agendamentos]);

  // Sincroniza localAgendamentos instantaneamente quando o Admin atualizar agendamentos via Realtime
  useEffect(() => {
    if (!debouncedSearch.trim() && agendamentos && agendamentos.length > 0) {
      setLocalAgendamentos(agendamentos);
    }
  }, [agendamentos, debouncedSearch]);

  const faturas = useMemo(() => {
    const list: any[] = [];

    localAgendamentos.forEach((a) => {
      if (["cancelado", "falta"].includes(a.status)) {
        list.push({ ...a, _faturaId: a.id, fatura_tipo: "cancelado_fatura", valor_fatura: a.valor, data_fatura: a.data_agendamento });
        return;
      }

      const hists = historico.filter((h) => h.agendamento_id === a.id && h.valor_delta > 0 && h.acao !== "acrescimo");

      if (hists.length > 0) {
        let totalPaidInHistory = 0;
        hists.forEach((h) => {
          const histDate = getPaymentDate({ paid_at: h.created_at, data_agendamento: a.data_agendamento });
          list.push({ ...a, _faturaId: `${a.id}-hist-${h.id}`, fatura_tipo: "pagamento", valor_fatura: h.valor_delta, data_fatura: histDate, _is_partial: true, _desc_pagamento: "Fatura Paga", _historico_obs: h.observacao || "", _historico_date: histDate });
          totalPaidInHistory += h.valor_delta;
        });
        const valorPagoAtual = Number(a.valor_pago || 0) + Number(a.valor_desconto_credito || 0);
        const initialPayment = valorPagoAtual - totalPaidInHistory;
        if (initialPayment > 0) {
          list.push({ ...a, _faturaId: `${a.id}-initial`, fatura_tipo: "pagamento", valor_fatura: initialPayment, data_fatura: getPaymentDate(a), _is_partial: true, _desc_pagamento: "Pagamento Inicial" });
        }
        const efetivamentePago = Math.max(valorPagoAtual, totalPaidInHistory);
        const restante = Number(a.valor) - efetivamentePago;
        if (restante > 0.01) {
          list.push({ ...a, _faturaId: `${a.id}-restante`, fatura_tipo: "pendente", valor_fatura: restante, data_fatura: a.data_agendamento, _is_partial: true, _desc_pagamento: "Restante Pendente" });
        }
      } else {
        const valorPago = Number(a.valor_pago || 0) + Number(a.valor_desconto_credito || 0);
        if (valorPago === 0) {
          if (Number(a.valor) > 0) list.push({ ...a, _faturaId: a.id, fatura_tipo: "pendente", valor_fatura: a.valor, data_fatura: a.data_agendamento });
        } else if (valorPago < a.valor) {
          list.push({ ...a, _faturaId: `${a.id}-pago`, fatura_tipo: "pagamento", valor_fatura: valorPago, data_fatura: getPaymentDate(a), _is_partial: true, _desc_pagamento: "Fatura Paga" });
          list.push({ ...a, _faturaId: `${a.id}-restante`, fatura_tipo: "pendente", valor_fatura: a.valor - valorPago, data_fatura: a.data_agendamento, _is_partial: true, _desc_pagamento: "Restante Pendente" });
        } else {
          list.push({ ...a, _faturaId: a.id, fatura_tipo: "pagamento", valor_fatura: a.valor, data_fatura: getPaymentDate(a) });
        }
      }

      if (Number(a.valor_gorjeta) > 0) list.push({ ...a, _faturaId: `${a.id}-gorjeta`, fatura_tipo: "pagamento", valor_fatura: Number(a.valor_gorjeta), data_fatura: getPaymentDate(a), _is_partial: true, _desc_pagamento: "Gorjeta (extra)", is_extra: true });
      if (Number(a.valor_troco) > 0) list.push({ ...a, _faturaId: `${a.id}-troco`, fatura_tipo: "pagamento", valor_fatura: Number(a.valor_troco), data_fatura: getPaymentDate(a), _is_partial: true, _desc_pagamento: "Troco pago", is_extra: true });
      if (Number(a.valor_credito) > 0) list.push({ ...a, _faturaId: `${a.id}-credito`, fatura_tipo: "pagamento", valor_fatura: Number(a.valor_credito), data_fatura: getPaymentDate(a), _is_partial: true, _desc_pagamento: "Crédito concedido", is_extra: true });
    });

    return list;
  }, [localAgendamentos, historico]);

  const dateFilteredFaturas = useMemo(() => {
    if (!dateFilter) return faturas;
    return faturas.filter(a => a.data_fatura === dateFilter);
  }, [faturas, dateFilter]);

  const filtered = useMemo(() => {
    // Pendências mostram todas as datas para não esconder sinais ou débitos antigos
    const baseList = (debouncedSearch.trim() || statusFilter === "pendente") ? faturas : dateFilteredFaturas;
    let list = [...baseList];

    if (statusFilter !== "todos") {
      if (statusFilter === "pendente") {
        list = list.filter((a) => a.fatura_tipo === "pendente" && !["cancelado", "falta"].includes(a.status));
      } else if (statusFilter === "pago") {
        list = list.filter((a) => a.fatura_tipo === "pagamento");
      } else if (statusFilter === "cancelado") {
        list = list.filter((a) => ["cancelado", "falta"].includes(a.status));
      }
    }

    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) =>
        getClientName(a.user_id, a.cliente_nome).toLowerCase().includes(q) ||
        a.servico.toLowerCase().includes(q) ||
        a.id.toLowerCase().includes(q) ||
        (a.forma_pagamento || "").toLowerCase().includes(q)
      );
    }

    list.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "data": cmp = a.data_fatura.localeCompare(b.data_fatura) || a.horario.localeCompare(b.horario) || (a.created_at || "").localeCompare(b.created_at || ""); break;
        case "valor": cmp = a.valor_fatura - b.valor_fatura; break;
        case "cliente": cmp = getClientName(a.user_id, a.cliente_nome).localeCompare(getClientName(b.user_id, b.cliente_nome)); break;
        case "status": cmp = a.status.localeCompare(b.status); break;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });

    return list;
  }, [faturas, dateFilteredFaturas, debouncedSearch, statusFilter, search, sortField, sortDir, getClientName]);

  const counts = useMemo(() => ({
    todos: dateFilteredFaturas.length,
    pendente: faturas.filter((a) => a.fatura_tipo === "pendente" && !["cancelado", "falta"].includes(a.status)).length,
    pago: dateFilteredFaturas.filter((a) => a.fatura_tipo === "pagamento").length,
    cancelado: dateFilteredFaturas.filter((a) => ["cancelado", "falta"].includes(a.status)).length,
  }), [dateFilteredFaturas, faturas]);

  const { totalPago, totalPendente, clientesComPendencia } = useMemo(() => {
    let pago = 0;
    let pendente = 0;
    const clientesSet = new Set<string>();
    dateFilteredFaturas.forEach(a => {
      if (a.fatura_tipo === "pagamento") pago += Number(a.valor_fatura);
    });
    faturas.forEach(a => {
      if (a.fatura_tipo === "pendente" && !["cancelado", "falta"].includes(a.status)) {
        pendente += Number(a.valor_fatura);
        clientesSet.add(`${a.user_id}|${a.cliente_nome || ""}`);
      }
    });
    return { totalPago: pago, totalPendente: pendente, clientesComPendencia: clientesSet.size };
  }, [dateFilteredFaturas, faturas]);

  // ── Grouped view (sempre agrupado por cliente) ───────────────────────────
  const groupedFaturas = useMemo((): GroupedFaturasResult => {
    const sourceList = debouncedSearch.trim()
      ? [...filtered].sort((a, b) => {
          const aPend = (a.fatura_tipo === "pendente" && !["cancelado", "falta"].includes(a.status)) ? 0 : 1;
          const bPend = (b.fatura_tipo === "pendente" && !["cancelado", "falta"].includes(b.status)) ? 0 : 1;
          if (aPend !== bPend) return aPend - bPend;
          return b.data_fatura.localeCompare(a.data_fatura);
        })
      : filtered;

    const groupsMap = new Map<string, ClienteGroup>();

    sourceList.forEach(f => {
      const clienteNome = getClientName(f.user_id, f.cliente_nome);
      const key = `${f.user_id}|${f.cliente_nome || ""}`;
      if (!groupsMap.has(key)) {
        groupsMap.set(key, { key, clienteNome, userId: f.user_id, totalPendente: 0, totalPago: 0, countPendente: 0, faturas: [] });
      }
      const group = groupsMap.get(key)!;
      group.faturas.push(f);
      if (f.fatura_tipo === "pendente" && !["cancelado", "falta"].includes(f.status)) {
        group.totalPendente += Number(f.valor_fatura);
        group.countPendente++;
      } else if (f.fatura_tipo === "pagamento" && !f.is_extra) {
        group.totalPago += Number(f.valor_fatura);
      }
    });

    // Within each group: pending first, then paid, then cancelled
    groupsMap.forEach(group => {
      group.faturas.sort((a, b) => {
        const rank = (f: any) => {
          if (f.fatura_tipo === "pendente" && !["cancelado", "falta"].includes(f.status)) return 0;
          if (f.fatura_tipo === "pagamento") return 1;
          return 2;
        };
        return rank(a) - rank(b);
      });
    });

    // Sort groups: groups with pending first
    const groups = Array.from(groupsMap.values()).sort((a, b) => {
      if (a.countPendente > 0 && b.countPendente === 0) return -1;
      if (a.countPendente === 0 && b.countPendente > 0) return 1;
      return b.totalPendente - a.totalPendente;
    });

    return { groups, saidas: [] };
  }, [filtered, debouncedSearch, getClientName]);

  // ── Distribution preview for "livre" mode ─────────────────────────────
  const payDistribuicaoPreview = useMemo(() => {
    if (payMode !== "livre" || !smartPayModal || !payValor.trim()) return [];
    const valor = parseCurrencyInput(payValor);
    if (valor <= 0) return [];
    const pendentes = [...smartPayModal.pendentes].sort((a, b) => a.restante - b.restante);
    let saldo = valor;
    const result: Array<{ servico: string; variacao: string; aPagar: number; quitada: boolean }> = [];
    for (const f of pendentes) {
      if (saldo <= 0.01) break;
      const aPagar = Math.min(saldo, f.restante);
      result.push({ servico: f.servico, variacao: f.variacao, aPagar, quitada: aPagar >= f.restante - 0.01 });
      saldo -= aPagar;
    }
    return result;
  }, [payMode, payValor, smartPayModal]);

  const paySobraPreview = useMemo(() => {
    if (payMode !== "livre" || !smartPayModal || !payValor.trim()) return 0;
    const valor = parseCurrencyInput(payValor);
    if (valor <= 0) return 0;
    const totalDevendo = smartPayModal.pendentes.reduce((s, p) => s + p.restante, 0);
    return Math.max(0, valor - totalDevendo);
  }, [payMode, payValor, smartPayModal]);

  // ── Smart payment handler ──────────────────────────────────────────────
  const handleSmartPayment = async () => {
    if (!smartPayModal) return;
    if (!payForma) { toast.error("Selecione a forma de pagamento"); return; }
    const valor = parseCurrencyInput(payValor);
    if (!valor || valor <= 0) { toast.error("Informe um valor válido"); return; }
    if (payMode === "especifica" && paySelectedIds.length === 0) { toast.error("Selecione ao menos uma fatura para pagar"); return; }

    setPayLoading(true);
    try {
      const byId = new Map(localAgendamentos.map((a) => [a.id, a]));

      if (payMode === "especifica") {
        const faturasSelecionadas = smartPayModal.pendentes.filter(p => paySelectedIds.includes(p.id));
        if (faturasSelecionadas.length === 0) { toast.error("Faturas não encontradas"); setPayLoading(false); return; }
        let totalPago = 0;
        for (const fatura of faturasSelecionadas) {
          const valorPagar = Math.min(valor / faturasSelecionadas.length, fatura.restante);
          const sourceAg = byId.get(fatura.id);
          const res = await persistAppointmentPayment({
            agendamento: {
              id: fatura.id,
              servico: fatura.servico,
              variacao: fatura.variacao,
              valor: fatura.valor,
              valor_pago: fatura.valorPago,
              valor_desconto_credito: sourceAg?.valor_desconto_credito,
              data_agendamento: sourceAg?.data_agendamento || fatura.data,
              forma_pagamento: sourceAg?.forma_pagamento,
              cliente_nome: sourceAg?.cliente_nome || smartPayModal.clienteNome,
              status: sourceAg?.status,
            },
            valorAdicional: valorPagar,
            formaPagamento: payForma,
            observacao: payObs || "",
            markConcluidoOnSettle: true,
            origem: "pagamentos_tab",
          });

          // Atualiza local imediatamente para UI refletir
          setLocalAgendamentos(prev => prev.map(a =>
            a.id === fatura.id
              ? {
                  ...a,
                  valor_pago: res.novoValorPago,
                  forma_pagamento: payForma,
                  paid_at: res.paidAt,
                  ...(res.quitada ? { status: "concluido" } : {}),
                }
              : a
          ));

          totalPago += valorPagar;
        }
        toast.success(`✅ ${formatCurrency(totalPago)} registrado no Caixa (${faturasSelecionadas.length} fatura(s))`);
      } else {
        // Distribute smallest → largest
        const pendentes = [...smartPayModal.pendentes].sort((a, b) => a.restante - b.restante);
        let saldo = valor;
        let count = 0;
        let totalAbatido = 0;

        for (const fatura of pendentes) {
          if (saldo <= 0.01) break;
          const aPagar = Math.min(saldo, fatura.restante);
          const sourceAg = byId.get(fatura.id);
          const res = await persistAppointmentPayment({
            agendamento: {
              id: fatura.id,
              servico: fatura.servico,
              variacao: fatura.variacao,
              valor: fatura.valor,
              valor_pago: fatura.valorPago,
              valor_desconto_credito: sourceAg?.valor_desconto_credito,
              data_agendamento: sourceAg?.data_agendamento || fatura.data,
              forma_pagamento: sourceAg?.forma_pagamento,
              cliente_nome: sourceAg?.cliente_nome || smartPayModal.clienteNome,
              status: sourceAg?.status,
            },
            valorAdicional: aPagar,
            formaPagamento: payForma,
            observacao: payObs || "",
            markConcluidoOnSettle: true,
            origem: "pagamentos_tab",
          });

          // Atualiza local imediatamente para UI refletir
          setLocalAgendamentos(prev => prev.map(a =>
            a.id === fatura.id
              ? {
                  ...a,
                  valor_pago: res.novoValorPago,
                  forma_pagamento: payForma,
                  paid_at: res.paidAt,
                  ...(res.quitada ? { status: "concluido" } : {}),
                }
              : a
          ));

          saldo -= aPagar;
          totalAbatido += aPagar;
          count++;
        }

        if (saldo > 0.01) {
          toast.success(`✅ ${formatCurrency(totalAbatido)} quitou ${count} débito(s) e entrou no Caixa. Troco/Sobra: ${formatCurrency(saldo)}`, { duration: 6000 });
        } else {
          toast.success(`✅ ${formatCurrency(totalAbatido)} registrado no Caixa para ${smartPayModal.clienteNome}`);
        }
      }

      setSmartPayModal(null);
      setPayValor(""); setPayForma("pix"); setPayObs(""); setPaySelectedIds([]);
      setHistorico(isSupabaseConfigured ? [] : getLocalPagamentoHistorico());
      setRefetchKey(k => k + 1);
      if (onUpdate) onUpdate();
    } catch (err: any) {
      console.error(err);
      toast.error(err.message || "Erro ao registrar pagamento");
    } finally {
      setPayLoading(false);
    }
  };

  // ── Fatura card renderer ───────────────────────────────────────────────
  const renderFaturaCard = (ag: any) => {
    const isPendingAmount = ag.fatura_tipo === "pendente" && !["cancelado", "falta"].includes(ag.status);
    const cfg = isPendingAmount ? statusConfig.pendente : (statusConfig[ag.status] || statusConfig.pendente);
    const StatusIcon = cfg.icon;
    const isExpanded = expandedId === ag._faturaId;
    const isPartial = !!ag._is_partial;

    return (
      <div
        className={`rounded-2xl border overflow-hidden transition-all ${
          isPendingAmount
            ? "border-amber-500/40 bg-gradient-to-br from-amber-500/[0.08] via-primary-foreground/[0.02] to-amber-500/[0.04] hover:border-amber-500/60 hover:shadow-[0_4px_16px_-8px_rgba(245,158,11,0.4)]"
            : "border-gold/15 bg-gradient-to-br from-gold/[0.05] via-primary-foreground/[0.02] to-nude/[0.03] hover:border-gold/25 hover:shadow-[0_4px_16px_-8px_hsl(var(--gold)/0.25)]"
        }`}
      >
        <button
          onClick={() => setExpandedId(isExpanded ? null : ag._faturaId)}
          className="flex w-full items-center gap-3 p-4 text-left"
        >
          <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${cfg.bg} border shadow-[0_2px_8px_-4px_hsl(var(--gold)/0.2)]`}>
            <StatusIcon className={`h-4 w-4 ${cfg.text}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5 flex-wrap">
              <p className="font-body text-[14px] font-medium text-primary-foreground truncate">
                {getClientName(ag.user_id, ag.cliente_nome)}
              </p>
              {isPendingAmount && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/20 border border-amber-500/40 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-300 animate-pulse">
                  <AlertCircle className="h-2.5 w-2.5" /> A receber
                </span>
              )}
              {isPartial && (
                <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                  ag.is_extra ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                  : isPendingAmount ? "bg-amber-500/20 border-amber-500/40 text-amber-300"
                  : "bg-emerald-500/20 border-emerald-500/40 text-emerald-400"
                }`}>
                  <Wallet className="h-2.5 w-2.5" />
                  {ag._desc_pagamento || (isPendingAmount ? "Restante Parcial" : "Fatura Paga")}
                </span>
              )}
            </div>
            <p className="font-body text-[11px] text-primary-foreground/75 truncate">
              {ag.servico}{ag.variacao ? ` · ${ag.variacao}` : ""} · {formatDate(ag.data_fatura)}
            </p>
          </div>
          <div className="shrink-0 text-right">
            {Number(ag.valor_desconto_credito) > 0 && !ag.is_extra && ag.valor_fatura === Number(ag.valor) ? (
              <div className="flex flex-col items-end">
                <p className="font-heading text-[15px] font-bold text-green-400">{formatCurrency(Math.max(0, ag.valor_fatura - Number(ag.valor_desconto_credito)))}</p>
                <p className="font-heading text-[10px] font-medium text-primary-foreground/75 line-through">{formatCurrency(ag.valor_fatura)}</p>
              </div>
            ) : (
              <p className={`font-heading text-[15px] font-bold ${isPendingAmount ? "text-amber-300" : "text-gold"}`}>
                {formatCurrency(ag.valor_fatura)}
              </p>
            )}
            <div className="flex items-center justify-end gap-1">
              <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-body text-[9px] font-bold uppercase tracking-wider border relative ${
                isPendingAmount ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
              }`}>
                <span className={`absolute inset-0 rounded-full animate-pulse border ${isPendingAmount ? "border-amber-500/50" : "border-emerald-500/50"}`} />
                <StatusIcon className="h-3 w-3 relative z-10" />
                <span className="relative z-10">{isPendingAmount ? "Pendente" : "Pago"}</span>
              </span>
            </div>
          </div>
          <ChevronDown className={`h-4 w-4 shrink-0 text-primary-foreground/95 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
        </button>

        {isExpanded && (
          <div className="border-t border-primary-foreground/[0.06] bg-primary-foreground/[0.02] px-4 py-3 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Detail label="ID do Pedido (Original)" value={ag.id.slice(0, 8) + "..."} />
              <Detail label="Data Base do Agend." value={`${formatDate(ag.data_agendamento || ag.data_fatura)}${ag.horario !== "00:00" ? ` às ${ag.horario}` : ""}`} />
              {(ag.variacao || ag.observacao) && <Detail label="Detalhes / Origem" value={ag.variacao || ag.observacao} />}
              <Detail label="Método de Pagamento" value={
                <span className="flex items-center gap-1.5">
                  {(() => {
                    const getMethod = () => {
                      if (ag.forma_pagamento && ag.forma_pagamento.includes("|")) {
                        const parts = ag.forma_pagamento.split("|");
                        for (const p of parts) { const [m, v] = p.split(":"); if (Number(v) === ag.valor_fatura) return m; }
                      }
                      return ag.forma_pagamento;
                    };
                    const method = getMethod();
                    return <>{paymentIcon(method)}{paymentLabel(method)}</>;
                  })()}
                </span>
              } />
              <Detail label="Duração" value={`${ag.duracao_minutos} min`} />
              <Detail label="Valor Desta Fatura" value={formatCurrency(ag.valor_fatura)} />
              <Detail label="Valor Total Original" value={
                Number(ag.valor_desconto_credito) > 0 ? (
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-primary-foreground/75 text-[12px] line-through">{formatCurrency(ag.valor || ag.valor_fatura)}</span>
                    <span className="text-green-400 font-bold">{formatCurrency(Math.max(0, Number(ag.valor || ag.valor_fatura) - Number(ag.valor_desconto_credito)))}</span>
                  </div>
                ) : formatCurrency(ag.valor || ag.valor_fatura)
              } />
              {(() => {
                const totalPagoVal = Number(ag.valor_pago || 0) + Number(ag.valor_desconto_credito || 0);
                if (totalPagoVal <= 0) return null;
                return (
                  <Detail label="Total Pago" value={
                    <span className="text-emerald-400 font-bold">✓ {formatCurrency(totalPagoVal)}</span>
                  } />
                );
              })()}
              <Detail label="Status da Fatura" value={
                <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-body text-[9px] font-bold uppercase tracking-wider border relative ${
                  isPendingAmount ? "bg-amber-500/10 text-amber-400 border-amber-500/30"
                  : "bg-emerald-500/10 text-emerald-400 border-emerald-500/30"
                }`}>
                  <span className={`absolute inset-0 rounded-full animate-pulse border ${isPendingAmount ? "border-amber-500/50" : "border-emerald-500/50"}`} />
                  <StatusIcon className="h-3 w-3 relative z-10" />
                  <span className="relative z-10">{isPendingAmount ? "Pendente" : "Pago"}</span>
                </span>
              } />
              {ag.status && <Detail label="Status do Serviço" value={ag.status.charAt(0).toUpperCase() + ag.status.slice(1)} />}
              {Number(ag.valor_desconto_credito) > 0 && <Detail label="Desc. de Crédito Utilizado" value={<span className="text-amber-400">- {formatCurrency(Number(ag.valor_desconto_credito))}</span>} />}
              {Number(ag.valor_gorjeta) > 0 && <Detail label="Gorjeta" value={<span className="text-purple-400">{formatCurrency(Number(ag.valor_gorjeta))}</span>} />}
              {Number(ag.valor_troco) > 0 && <Detail label="Troco Pago" value={<span className="text-blue-400">{formatCurrency(Number(ag.valor_troco))}</span>} />}
              {Number(ag.valor_credito) > 0 && <Detail label="Crédito Concedido" value={<span className="text-green-400">{formatCurrency(Number(ag.valor_credito))}</span>} />}
            </div>
            {ag._historico_obs && ag._historico_obs.trim() && (
              <div className="flex items-start gap-2 rounded-xl border border-gold/25 bg-gold/[0.06] px-3 py-2.5">
                <span className="text-[13px] shrink-0">📝</span>
                <div>
                  <p className="font-body text-[9px] text-gold/70 uppercase tracking-wider mb-0.5">Observação do Pagamento</p>
                  <p className="font-body text-[12px] text-primary-foreground/85 leading-snug">{ag._historico_obs}</p>
                </div>
              </div>
            )}
            <div className="pt-2 border-t border-primary-foreground/[0.05] flex justify-end gap-2">
              {onEdit && !ag._faturaId?.includes("-hist-") && (
                <button
                  onClick={(e) => { e.stopPropagation(); onEdit(ag); }}
                  className="px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 font-body text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors"
                >
                  <Edit3 className="w-3.5 h-3.5" /> Editar
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  if (ag._faturaId?.includes("-hist-")) {
                    handleDeleteHistorico(ag);
                  } else {
                    handleDelete(ag.id, "agendamentos");
                  }
                }}
                className="px-3 py-1.5 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500/20 font-body text-[11px] font-bold uppercase tracking-wider flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" /> {ag._faturaId?.includes("-hist-") ? "Reverter" : "Excluir"}
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  const hasActiveFilters = statusFilter !== "todos" || Boolean(search.trim()) || Boolean(dateFilter);

  const EmptyState = () => (
    <div className="rounded-2xl border border-dashed border-primary-foreground/[0.1] bg-[#1a1919] py-8 px-5 text-center space-y-2.5">
      <div className="mx-auto w-11 h-11 rounded-2xl bg-gold/12 border border-gold/25 flex items-center justify-center">
        <Wallet className="w-5 h-5 text-gold" />
      </div>
      <div className="space-y-1 max-w-xs mx-auto">
        <p className="font-heading text-[15px] font-semibold text-primary-foreground">
          {hasActiveFilters ? "Nenhum resultado neste filtro" : "Nenhum pagamento por aqui ainda"}
        </p>
        <p className="font-body text-[11.5px] text-primary-foreground/50 leading-relaxed">
          {hasActiveFilters
            ? "Limpe os filtros ou tente outro nome para ver os lançamentos."
            : "Pagamentos recebidos, sinais e saldos a cobrar de suas clientes aparecerão aqui."}
        </p>
      </div>
      {hasActiveFilters && (
        <button
          type="button"
          onClick={() => {
            setStatusFilter("todos");
            setSearch("");
            setDateFilter("");
          }}
          className="px-3.5 py-1.5 rounded-xl bg-primary-foreground/[0.06] border border-primary-foreground/[0.1] text-primary-foreground/80 font-body text-[11.5px] font-medium hover:text-gold transition-all"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );

  // ── Render (Mobile-First) ────────────────────────────────────────────────
  return (
    <div className="space-y-3">
      {/* 3 cartões de resumo — mobile-first, sem truncar valores */}
      <div className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          onClick={() => setStatusFilter((prev) => (prev === "pendente" ? "todos" : "pendente"))}
          className={`text-left rounded-xl border p-2.5 transition-all ${
            statusFilter === "pendente"
              ? "border-amber-400/55 bg-amber-500/15"
              : "border-amber-500/25 bg-gradient-to-br from-amber-500/[0.12] to-transparent hover:border-amber-500/40"
          }`}
        >
          <p className="font-body text-[9px] font-bold text-amber-300/80 uppercase tracking-wider leading-tight">
            A Receber
          </p>
          <p className="font-heading text-[13px] sm:text-base font-bold text-amber-300 mt-1 tabular-nums leading-tight break-all">
            {formatCurrency(totalPendente)}
          </p>
          <p className="font-body text-[9px] text-amber-300/55 mt-0.5 leading-tight">
            {clientesComPendencia} {clientesComPendencia === 1 ? "pend." : "pends."}
          </p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter((prev) => (prev === "pago" ? "todos" : "pago"))}
          className={`text-left rounded-xl border p-2.5 transition-all ${
            statusFilter === "pago"
              ? "border-emerald-400/55 bg-emerald-500/15"
              : "border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.1] to-transparent hover:border-emerald-500/40"
          }`}
        >
          <p className="font-body text-[9px] font-bold text-emerald-400/80 uppercase tracking-wider leading-tight">
            Recebido
          </p>
          <p className="font-heading text-[13px] sm:text-base font-bold text-emerald-400 mt-1 tabular-nums leading-tight break-all">
            {formatCurrency(totalPago)}
          </p>
          <p className="font-body text-[9px] text-emerald-400/55 mt-0.5 leading-tight">
            já pago
          </p>
        </button>

        <button
          type="button"
          onClick={() => setStatusFilter((prev) => (prev === "pendente" ? "todos" : "pendente"))}
          className="text-left rounded-xl border border-gold/25 bg-gradient-to-br from-gold/[0.1] to-transparent p-2.5 transition-all hover:border-gold/45"
        >
          <p className="font-body text-[9px] font-bold text-gold/80 uppercase tracking-wider leading-tight">
            Devedoras
          </p>
          <p className="font-heading text-[20px] sm:text-2xl font-bold text-gold mt-1 tabular-nums leading-tight">
            {clientesComPendencia}
          </p>
          <p className="font-body text-[9px] text-gold/55 mt-0.5 leading-tight">
            {clientesComPendencia === 1 ? "cliente" : "clientes"}
          </p>
        </button>
      </div>

      {/* Painel compacto e simétrico (100% proporcional no mobile) */}
      <div className="rounded-2xl border border-primary-foreground/[0.08] bg-[#1a1919] p-3 space-y-2">
        {/* Linha 1: Busca + atalho Hoje */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1 min-w-0">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-primary-foreground/45" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Buscar cliente ou serviço..."
              className="w-full h-9 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.09] pl-9 pr-8 text-primary-foreground font-body text-[12.5px] placeholder:text-primary-foreground/40 focus:outline-none focus:border-gold/45"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch("")}
                aria-label="Limpar busca"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-primary-foreground/50 hover:text-primary-foreground"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              const now = new Date();
              const todayStr = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split("T")[0];
              setDateFilter(dateFilter === todayStr ? "" : todayStr);
            }}
            className={`h-9 px-3 rounded-xl font-body text-[11.5px] font-semibold border transition-all shrink-0 ${
              dateFilter
                ? "bg-gold/15 text-gold border-gold/40"
                : "bg-primary-foreground/[0.04] text-primary-foreground/75 border-primary-foreground/[0.09] hover:text-primary-foreground"
            }`}
          >
            Hoje
          </button>
        </div>

        {/* Linha 2: Data e Ordenação em 2 colunas simétricas (sem cortar dd/mm/aaaa) */}
        <div className="grid grid-cols-2 gap-2">
          <div className="flex items-center gap-1 min-w-0">
            <input
              type="date"
              aria-label="Filtrar pagamentos por data"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              className="w-full h-9 min-w-0 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.09] px-2.5 text-primary-foreground font-body text-[12px] focus:outline-none focus:border-gold/45 [color-scheme:dark]"
            />
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter("")}
                className="h-9 w-9 rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.09] text-primary-foreground/65 hover:text-rose flex items-center justify-center shrink-0"
                title="Limpar data"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <select
            aria-label="Ordenar pagamentos"
            value={`${sortField}:${sortDir}`}
            onChange={(e) => {
              const [f, d] = e.target.value.split(":") as [SortField, SortDir];
              setSortField(f);
              setSortDir(d);
            }}
            className="w-full h-9 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.09] px-2.5 text-primary-foreground/85 font-body text-[12px] focus:outline-none focus:border-gold/45 [color-scheme:dark] [&>option]:bg-[#1c1c1e]"
          >
            <option value="data:desc">Mais recentes</option>
            <option value="valor:desc">Maior valor</option>
            <option value="cliente:asc">Cliente (A–Z)</option>
          </select>
        </div>

        {/* Linha 3: Status filters centralizados em grade 2x2 no mobile / 4 colunas no desktop */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
          {(["todos", "pendente", "pago", "cancelado"] as StatusFilter[]).map((s) => {
            const labels: Record<StatusFilter, string> = {
              todos: "Todos",
              pendente: "A Receber",
              pago: "Pagos",
              cancelado: "Cancelados",
            };
            const colors: Record<StatusFilter, { active: string; inactive: string }> = {
              todos: {
                active: "bg-gold/20 text-gold border-gold/45",
                inactive: "bg-primary-foreground/[0.03] text-primary-foreground/65 border-primary-foreground/[0.08] hover:text-primary-foreground",
              },
              pendente: {
                active: "bg-amber-500/15 text-amber-300 border-amber-500/45",
                inactive: "bg-primary-foreground/[0.03] text-primary-foreground/65 border-primary-foreground/[0.08] hover:text-amber-300",
              },
              pago: {
                active: "bg-emerald-500/15 text-emerald-300 border-emerald-500/45",
                inactive: "bg-primary-foreground/[0.03] text-primary-foreground/65 border-primary-foreground/[0.08] hover:text-emerald-300",
              },
              cancelado: {
                active: "bg-rose/15 text-rose border-rose/45",
                inactive: "bg-primary-foreground/[0.03] text-primary-foreground/65 border-primary-foreground/[0.08] hover:text-rose",
              },
            };
            const c = colors[s];
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatusFilter(s)}
                className={`rounded-xl px-2.5 py-2 font-body text-[11px] font-semibold border transition-all flex items-center justify-center gap-1 ${
                  statusFilter === s ? c.active : c.inactive
                }`}
              >
                <span className="truncate">{labels[s]}</span>
                <span className="opacity-75 tabular-nums shrink-0">({counts[s]})</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── PAYMENT LIST (agrupado por cliente, com pendências no topo) ─────── */}
      <div className="space-y-2">
        {groupedFaturas.groups.length === 0 && <EmptyState />}

        {groupedFaturas.groups.slice(0, visibleCount).map(group => {
          const isExpandedGroup = !!debouncedSearch.trim() || expandedGroups.has(group.key);
          return (
            <div key={group.key} className="space-y-1.5">
              {/* Group header */}
              <div className="flex items-center gap-1 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.07] hover:border-primary-foreground/[0.12] transition-all overflow-hidden">
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="flex items-center gap-2.5 px-3 py-2.5 flex-1 min-w-0 text-left"
                >
                  <div className="w-7 h-7 rounded-full bg-gold/12 border border-gold/25 flex items-center justify-center shrink-0">
                    <Users className="h-3.5 w-3.5 text-gold/80" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <span className="font-body text-[13px] font-semibold text-primary-foreground text-left break-words">{group.clienteNome}</span>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      {group.totalPago > 0 && (
                        <span className="font-heading text-[11px] font-bold text-emerald-400/80" title="Já pago">✓ {formatCurrency(group.totalPago)}</span>
                      )}
                      {group.totalPendente > 0 && (
                        <span className="font-heading text-[12px] font-bold text-amber-300">Falta {formatCurrency(group.totalPendente)}</span>
                      )}
                      {group.countPendente > 0 ? (
                        <span className="rounded-full bg-amber-500/15 border border-amber-500/30 px-2 py-0.5 font-body text-[9px] font-bold text-amber-300">
                          {group.countPendente} pendente{group.countPendente > 1 ? "s" : ""}
                        </span>
                      ) : (
                        <span className="rounded-full bg-emerald-500/15 border border-emerald-500/25 px-2 py-0.5 font-body text-[9px] font-bold text-emerald-400">Em dia ✓</span>
                      )}
                    </div>
                  </div>
                  <ChevronDown className={`h-4 w-4 shrink-0 text-primary-foreground/50 transition-transform duration-200 ${!isExpandedGroup ? "" : "rotate-180"}`} />
                </button>

                {group.countPendente > 0 && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      const todasPendentesDoCliente = faturas.filter(f =>
                        (f.user_id === group.userId || (f.cliente_nome && group.clienteNome && f.cliente_nome.toLowerCase() === group.clienteNome.toLowerCase())) &&
                        f.fatura_tipo === "pendente" &&
                        !["cancelado", "falta"].includes(f.status)
                      );

                      const pendentes: FaturaPendente[] = todasPendentesDoCliente.map(f => ({
                        id: f.id,
                        servico: f.servico,
                        variacao: f.variacao || "",
                        valor: Number(f.valor ?? f.valor_fatura ?? 0),
                        valorPago: Number(f.valor_pago || 0) + Number(f.valor_desconto_credito || 0),
                        restante: Number(f.valor_fatura),
                        data: f.data_fatura,
                        userId: f.user_id,
                      }));
                      setSmartPayModal({ clienteNome: group.clienteNome, pendentes });
                      setPayMode("livre"); setPayValor(""); setPayForma("pix"); setPayObs(""); setPaySelectedIds([]);
                    }}
                    className="shrink-0 flex flex-col sm:flex-row items-center gap-0.5 sm:gap-1.5 border-l border-primary-foreground/[0.07] px-2.5 py-2 hover:bg-amber-500/10 transition-all group"
                    title="Receber sinal, parcela ou quitação"
                  >
                    <Wallet className="h-3.5 w-3.5 text-amber-400/80 group-hover:text-amber-300 transition-colors" />
                    <span className="font-body text-[9.5px] font-bold text-amber-400/80 group-hover:text-amber-300 transition-colors">Receber</span>
                  </button>
                )}

              </div>

              {/* Group faturas */}
              {isExpandedGroup && (
                <div className="space-y-1.5 pl-2 border-l border-primary-foreground/[0.06] ml-3">
                  {group.faturas.map(ag => (
                    <div key={ag._faturaId}>{renderFaturaCard(ag)}</div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        <LoadMoreButton
          visibleCount={visibleCount}
          totalCount={groupedFaturas.groups.length}
          step={15}
          onLoadMore={() => setVisibleCount((c) => c + 15)}
          itemLabel="clientes"
        />
      </div>

      {/* ── SMART PAYMENT MODAL ───────────────────────────────────────────── */}
      {smartPayModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => !payLoading && setSmartPayModal(null)} />
          <div className="relative w-full max-w-md rounded-2xl border border-gold/25 bg-[hsl(var(--primary))] shadow-[0_24px_64px_-12px_hsl(var(--gold)/0.45)] overflow-hidden max-h-[92vh] flex flex-col">

            {/* Modal Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-primary-foreground/[0.07] bg-gradient-to-r from-gold/[0.08] to-transparent">
              <div>
                <p className="font-body text-[9px] text-gold/60 uppercase tracking-wider">Registrar Pagamento</p>
                <p className="font-heading text-[15px] font-bold text-primary-foreground">{smartPayModal.clienteNome}</p>
                <p className="font-body text-[11px] text-amber-300/80 mt-0.5">
                  Total devendo: {formatCurrency(smartPayModal.pendentes.reduce((s, p) => s + p.restante, 0))}
                </p>
              </div>
              <button onClick={() => !payLoading && setSmartPayModal(null)} className="p-2 rounded-xl hover:bg-primary-foreground/[0.08] transition-colors">
                <X className="h-4 w-4 text-primary-foreground/50" />
              </button>
            </div>

            <div className="overflow-y-auto flex-1 p-5 space-y-4">
              {/* Mode selector */}
              <div>
                <p className="font-body text-[10px] text-primary-foreground/80 uppercase tracking-wider mb-2">Como deseja pagar?</p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => setPayMode("livre")}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 transition-all ${
                      payMode === "livre"
                        ? "bg-gold/15 border-gold/50 text-white shadow-[0_4px_12px_-4px_hsl(var(--gold)/0.3)]"
                        : "bg-primary-foreground/[0.04] border-primary-foreground/[0.08] text-white hover:border-primary-foreground/30"
                    }`}
                  >
                    <Zap className="h-4 w-4" />
                    <span className="font-body text-[10px] font-bold uppercase tracking-wider">Valor Total</span>
                    <span className="font-body text-[9px] opacity-85 text-center leading-tight">Distribui do menor<br/>ao maior débito</span>
                  </button>
                  <button
                    onClick={() => setPayMode("especifica")}
                    className={`flex flex-col items-center gap-1.5 rounded-xl border px-3 py-3 transition-all ${
                      payMode === "especifica"
                        ? "bg-gold/15 border-gold/50 text-white shadow-[0_4px_12px_-4px_hsl(var(--gold)/0.3)]"
                        : "bg-primary-foreground/[0.04] border-primary-foreground/[0.08] text-white hover:border-primary-foreground/30"
                    }`}
                  >
                    <ListChecks className="h-4 w-4" />
                    <span className="font-body text-[10px] font-bold uppercase tracking-wider">Por Fatura</span>
                    <span className="font-body text-[9px] opacity-85 text-center leading-tight">Escolha qual<br/>fatura pagar</span>
                  </button>
                </div>
              </div>

              {/* Specific invoice selector */}
              {payMode === "especifica" && (
                <div className="space-y-2">
                  <p className="font-body text-[10px] text-primary-foreground/80 uppercase tracking-wider">Selecione a fatura</p>
                  {smartPayModal.pendentes.map(p => {
                    const isSelected = paySelectedIds.includes(p.id);
                    return (
                      <button
                        key={p.id}
                        onClick={() => {
                          const nextIds = paySelectedIds.includes(p.id)
                            ? paySelectedIds.filter(id => id !== p.id)
                            : [...paySelectedIds, p.id];
                          setPaySelectedIds(nextIds);
                          
                          const total = smartPayModal.pendentes
                            .filter(f => nextIds.includes(f.id))
                            .reduce((s, f) => s + f.restante, 0);
                          setPayValor(total > 0 ? total.toFixed(2).replace(".", ",") : "");
                        }}
                        className={`w-full flex items-center justify-between rounded-xl border px-3 py-2.5 transition-all text-left ${
                          isSelected
                            ? "bg-amber-500/20 border-amber-400/70 shadow-[0_0_16px_-4px_rgba(245,158,11,0.4)] ring-1 ring-amber-400/30"
                            : "bg-primary-foreground/[0.03] border-primary-foreground/[0.08] hover:border-primary-foreground/20"
                        }`}
                      >
                        <div className="min-w-0 flex-1">
                          <p className={`font-body text-[12px] font-medium truncate ${
                            isSelected ? "text-amber-200" : "text-primary-foreground"
                          }`}>{p.servico}{p.variacao ? ` · ${p.variacao}` : ""}</p>
                          <p className={`font-body text-[10px] ${
                            isSelected ? "text-amber-300/70" : "text-primary-foreground/65"
                          }`}>{formatDate(p.data)}</p>
                          {p.valorPago > 0 && (
                            <div className="flex items-center gap-2 mt-1">
                              <span className="font-body text-[9px] text-primary-foreground/40 uppercase tracking-wider">Total: {formatCurrency(p.valor)}</span>
                              <span className="font-body text-[9px] text-emerald-400/80">✓ Pago: {formatCurrency(p.valorPago)}</span>
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-2 shrink-0 ml-3">
                          <div className="text-right">
                            <p className="font-body text-[8px] text-primary-foreground/40 uppercase tracking-wider leading-none mb-0.5">Restante</p>
                            <span className="font-heading text-[14px] font-bold text-amber-300">{formatCurrency(p.restante)}</span>
                          </div>
                          <div className={`w-5 h-5 rounded-full border-2 flex items-center justify-center shrink-0 transition-all ${
                            isSelected
                              ? "bg-emerald-500 border-emerald-400"
                              : "border-primary-foreground/25 bg-transparent"
                          }`}>
                            {isSelected && <CheckCircle className="h-3.5 w-3.5 text-white" />}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                  {paySelectedIds.length > 0 && (
                    <div className="flex items-center justify-between rounded-xl bg-emerald-500/10 border border-emerald-500/25 px-3 py-2 mt-1">
                      <span className="font-body text-[11px] text-emerald-300">{paySelectedIds.length} fatura(s) selecionada(s)</span>
                      <button
                        onClick={() => {
                          const total = smartPayModal.pendentes
                            .filter(p => paySelectedIds.includes(p.id))
                            .reduce((s, p) => s + p.restante, 0);
                          setPayValor(total.toFixed(2).replace(".", ","));
                        }}
                        className="font-body text-[11px] font-bold text-emerald-300 underline underline-offset-2"
                      >
                        Sugerir total: {formatCurrency(smartPayModal.pendentes.filter(p => paySelectedIds.includes(p.id)).reduce((s, p) => s + p.restante, 0))}
                      </button>
                    </div>
                  )}
                </div>
              )}

              {/* Amount input */}
              <div>
                <label className="font-body text-[10px] text-primary-foreground/80 uppercase tracking-wider mb-1.5 block">
                  {payMode === "livre" ? "Valor Recebido" : "Valor a Pagar"}
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-body text-[13px] text-primary-foreground/75 font-medium">R$</span>
                  <input
                    type="text"
                    inputMode="decimal"
                    value={payValor}
                    onChange={(e) => setPayValor(e.target.value)}
                    placeholder="0,00"
                    className="w-full rounded-xl bg-primary-foreground/[0.06] border border-primary-foreground/[0.12] pl-10 pr-4 py-3.5 text-primary-foreground font-heading text-[20px] font-bold placeholder:text-primary-foreground/45 focus:outline-none focus:ring-2 focus:ring-gold/30 focus:border-gold/40"
                  />
                </div>
              </div>

              {/* Distribution preview */}
              {payMode === "livre" && payDistribuicaoPreview.length > 0 && (
                <div className="rounded-xl border border-gold/20 bg-gold/[0.05] p-3 space-y-2">
                  <p className="font-body text-[9px] text-gold/60 uppercase tracking-wider">⚡ Distribuição automática</p>
                  {payDistribuicaoPreview.map((item, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[9px] font-bold shrink-0 ${item.quitada ? "bg-emerald-500/20 text-emerald-400" : "bg-amber-500/20 text-amber-400"}`}>
                          {item.quitada ? "✓" : "~"}
                        </span>
                        <p className="font-body text-[11px] text-primary-foreground/80 truncate">{item.servico}{item.variacao ? ` · ${item.variacao}` : ""}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <span className={`font-heading text-[12px] font-bold ${item.quitada ? "text-emerald-400" : "text-amber-300"}`}>{formatCurrency(item.aPagar)}</span>
                        {item.quitada && <span className="font-body text-[9px] text-emerald-400/60 ml-1">QUITADA</span>}
                      </div>
                    </div>
                  ))}
                  {paySobraPreview > 0 && (
                    <div className="pt-2 border-t border-gold/20 flex items-center justify-between gap-2 text-amber-300">
                      <span className="font-body text-[11px] font-medium flex items-center gap-1.5">
                        💰 Troco / Sobra a devolver:
                      </span>
                      <span className="font-heading text-[13px] font-bold text-amber-200">
                        {formatCurrency(paySobraPreview)}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Payment method */}
              <div>
                <label className="font-body text-[10px] text-primary-foreground/80 uppercase tracking-wider mb-1.5 block">Forma de Pagamento</label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: "pix", label: "PIX", icon: <img src={pixIcon} alt="PIX" className="h-4 w-4" /> },
                    { value: "cartao", label: "Cartão", icon: <CreditCard className="h-4 w-4" /> },
                    { value: "dinheiro", label: "Dinheiro", icon: <DollarSign className="h-4 w-4" /> },
                    // boleto removido
                  ].map(m => (
                    <button
                      key={m.value}
                      onClick={() => setPayForma(m.value)}
                      className={`flex flex-col items-center gap-1.5 rounded-xl border py-2.5 transition-all ${
                        payForma === m.value
                          ? "bg-gold/15 border-gold/50 text-gold"
                          : "bg-primary-foreground/[0.04] border-primary-foreground/[0.08] text-primary-foreground/85 hover:border-primary-foreground/30"
                      }`}
                    >
                      {m.icon}
                      <span className="font-body text-[9px] font-bold">{m.label}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Observation */}
              <div>
                <label className="font-body text-[10px] text-primary-foreground/80 uppercase tracking-wider mb-1.5 block">Observação (opcional)</label>
                <input
                  type="text"
                  value={payObs}
                  onChange={(e) => setPayObs(e.target.value)}
                  placeholder="Ex: Sinal da tatuagem, parcela 1..."
                  className="w-full rounded-xl bg-primary-foreground/[0.06] border border-primary-foreground/[0.12] px-4 py-2.5 text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/45 focus:outline-none focus:ring-2 focus:ring-gold/30"
                />
                <p className="font-body text-[10.5px] text-emerald-300/75 mt-1.5">
                  Cada parcela paga gera automaticamente um lançamento identificado no Caixa.
                </p>
              </div>
            </div>

            {/* Modal footer */}
            <div className="flex gap-3 px-5 py-4 border-t border-primary-foreground/[0.07]">
              <button
                onClick={() => !payLoading && setSmartPayModal(null)}
                className="flex-1 rounded-xl border border-primary-foreground/[0.15] bg-primary-foreground/[0.06] py-3 font-body text-[13px] font-bold text-primary-foreground/90 hover:bg-primary-foreground/[0.10] transition-colors disabled:opacity-50"
                disabled={payLoading}
              >
                Cancelar
              </button>
              <button
                onClick={handleSmartPayment}
                disabled={payLoading || !payValor.trim() || !payForma}
                className="flex-1 rounded-xl bg-gold/20 border border-gold/50 py-3 font-body text-[13px] font-bold text-gold hover:bg-gold/30 transition-all disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_4px_16px_-4px_hsl(var(--gold)/0.3)]"
              >
                {payLoading ? "Registrando..." : "✅ Confirmar"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

const Detail = ({ label, value }: { label: string; value: React.ReactNode }) => (
  <div>
    <p className="font-body text-[10px] text-primary-foreground/95">{label}</p>
    <div className="font-body text-[12px] text-primary-foreground/80 mt-0.5">{value}</div>
  </div>
);

export default PagamentosTab;
