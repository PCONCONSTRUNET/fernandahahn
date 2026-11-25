import { parseCurrencyStr } from "@/lib/utils";
import { useState, useMemo, useEffect } from "react";
import { Search, CheckCircle, X, UserX, ChevronDown, Bell, Clock, AlertTriangle, Eye, Wallet, History, Plus, Edit2, Users } from "lucide-react";
import BinButton from "@/components/ui/bin-button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import { toast } from "sonner";
import WhatsAppIcon from "@/components/icons/WhatsAppIcon";
import { useConfirm } from "@/contexts/ConfirmContext";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import { persistAppointmentPayment, getLocalPagamentoHistorico } from "@/lib/caixa";
import ClienteFichaModal, {
  ClienteProfile,
  ClientMetrics,
  computeClientMetrics,
  formatBRL,
} from "@/components/ClienteFichaModal";

interface Agendamento {
  id: string;
  servico: string;
  variacao: string | null;
  data_agendamento: string;
  horario: string;
  valor: number;
  valor_pago: number | null;
  status: string;
  user_id: string;
  created_at: string;
  cliente_nome: string | null;
  origem?: string | null;
  forma_pagamento?: string | null;
  observacao?: string | null;
  payment_id?: string | null;
  paid_at?: string | null;
  payer_name?: string | null;
  receipt_url?: string | null;
  valor_gorjeta?: number | null;
  valor_troco?: number | null;
  valor_credito?: number | null;
  valor_desconto_credito?: number | null;
}

interface Props {
  agendamentos: Agendamento[];
  getClientName: (userId: string, clienteNome?: string | null) => string;
  clientes?: ClienteProfile[];
  setClientes?: React.Dispatch<React.SetStateAction<ClienteProfile[]>>;
  onUpdate: () => void;
  onBookClient?: (cliente: ClienteProfile) => void;
}

const formatDate = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });

const formatCurrency = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

type PagamentoFilter = "todos" | "pago" | "sinal" | "recepcao" | "pendente";

const isFormaRecepcao = (forma_pagamento?: string | null): boolean => {
  const forma = (forma_pagamento || "").toLowerCase();
  return (
    forma.includes("recep") ||
    forma.includes("salao") ||
    forma.includes("salão") ||
    forma === "presencial" ||
    forma === "local" ||
    forma === "dinheiro"
  );
};

const isPago = (a: { valor: number; valor_pago: number | null; valor_desconto_credito?: number | null }): boolean => {
  const valor = Number(a.valor || 0);
  const pago = Number(a.valor_pago || 0) + Number(a.valor_desconto_credito || 0);
  return pago >= valor && valor > 0;
};

const isSinalPago = (a: { valor: number; valor_pago: number | null; valor_desconto_credito?: number | null }): boolean => {
  const valor = Number(a.valor || 0);
  const pago = Number(a.valor_pago || 0) + Number(a.valor_desconto_credito || 0);
  return pago > 0 && pago < valor;
};

const isNaoPago = (a: { valor: number; valor_pago: number | null; valor_desconto_credito?: number | null }): boolean => {
  const pago = Number(a.valor_pago || 0) + Number(a.valor_desconto_credito || 0);
  return pago <= 0;
};

const matchesPagamentoFilter = (
  a: { valor: number; valor_pago: number | null; forma_pagamento?: string | null; valor_desconto_credito?: number | null },
  filter: PagamentoFilter
): boolean => {
  if (filter === "todos") return true;
  if (filter === "pago") return isPago(a);
  if (filter === "sinal") return isSinalPago(a);
  if (filter === "pendente") return isNaoPago(a);
  if (filter === "recepcao") return isFormaRecepcao(a.forma_pagamento);
  return true;
};

const PedidosTab = ({
  agendamentos,
  getClientName,
  clientes = [],
  setClientes,
  onUpdate,
  onBookClient,
}: Props) => {
  const { confirm } = useConfirm();
  const [devedoresOpen, setDevedoresOpen] = useState(false);
  const [expandedDevedorId, setExpandedDevedorId] = useState<string | null>(null);
  const [fichaTarget, setFichaTarget] = useState<{ userId?: string; nome: string } | null>(null);
  const getClienteWhatsapp = (userId: string): string => clientes.find((c) => c.id === userId)?.whatsapp || "";
  const formatWhatsapp = (w: string) => (w ? `(${w.slice(0, 2)}) ${w.slice(2, 7)}-${w.slice(7)}` : "");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchAgendamentos, setSearchAgendamentos] = useState<Agendamento[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [statusFilter, setStatusFilter] = useState("todos");
  const [pagamentoFilter, setPagamentoFilter] = useState<PagamentoFilter>("todos");
  const [dateFilter, setDateFilter] = useState<string>("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [visibleCount, setVisibleCount] = useState(15);
  const [localOverrides, setLocalOverrides] = useState<Record<string, Partial<Agendamento>>>({});

  useEffect(() => {
    setVisibleCount(15);
  }, [statusFilter, pagamentoFilter, dateFilter, searchTerm]);
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() => {
    const saved = localStorage.getItem("pedidos_dismissed");
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });

  const today = new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split("T")[0];

  // Mapa de pagamento efetivo por agendamento_id — calculado localmente sem query ao banco.
  // valor_pago já está sincronizado com o historico real pela migration sync_valor_pago_historico.
  // Isso elimina as N+1 queries em chunks que sobrecargavam o banco Nano.
  const allHistoricoMap = useMemo<Record<string, number>>(() => {
    const map: Record<string, number> = {};
    agendamentos.forEach(a => {
      const pago = Number(a.valor_pago || 0) + Number(a.valor_desconto_credito || 0);
      if (pago > 0) map[a.id] = pago;
    });
    return map;
  }, [agendamentos]);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 450);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  useEffect(() => {
    if (!debouncedSearch.trim() || !isSupabaseConfigured) {
      setSearchAgendamentos([]);
      return;
    }

    let cancelled = false;

    const performSearch = async () => {
      setIsSearching(true);
      try {
        // 1. Query matching profiles first to map names to user_id
        const { data: matchedProfiles } = await supabase
          .from("profiles")
          .select("id, nome")
          .or(`nome.ilike.%${debouncedSearch}%`);

        if (cancelled) return;

        const profileIds = (matchedProfiles || []).map(p => p.id);

        // 2. Query agendamentos
        let agsQuery = supabase.from("agendamentos").select("*").neq("status", "aguardando_pagamento");
        
        const isDate = /^\d{4}-\d{2}-\d{2}$/.test(debouncedSearch);
        if (isDate) {
          agsQuery = agsQuery.eq("data_agendamento", debouncedSearch);
        } else {
          if (profileIds.length > 0) {
            const escapedIds = profileIds.join(",");
            agsQuery = agsQuery.or(`servico.ilike.%${debouncedSearch}%,cliente_nome.ilike.%${debouncedSearch}%,user_id.in.(${escapedIds})`);
          } else {
            agsQuery = agsQuery.or(`servico.ilike.%${debouncedSearch}%,cliente_nome.ilike.%${debouncedSearch}%`);
          }
        }

        const { data: searchAgs } = await agsQuery.order("data_agendamento", { ascending: false }).limit(200);

        if (cancelled) return;
        if (searchAgs) {
          setSearchAgendamentos(searchAgs as Agendamento[]);
        }
      } catch (err) {
        console.error("Erro na busca remota Pedidos:", err);
      } finally {
        if (!cancelled) {
          setIsSearching(false);
        }
      }
    };

    performSearch();

    return () => {
      cancelled = true;
    };
  }, [debouncedSearch]);

  const allItems = useMemo<Agendamento[]>(() => {
    const base = searchTerm.trim() && isSupabaseConfigured ? searchAgendamentos : agendamentos;
    if (Object.keys(localOverrides).length === 0) return base;
    return base.map((a) => (localOverrides[a.id] ? { ...a, ...localOverrides[a.id] } : a));
  }, [agendamentos, searchAgendamentos, searchTerm, localOverrides]);

  const getClientKey = (userId?: string | null, clienteNome?: string | null) =>
    userId ? `id:${userId}` : `name:${(clienteNome || getClientName("", clienteNome)).trim().toLowerCase()}`;

  const clientFinancialMap = useMemo(() => {
    const grouped = new Map<string, Agendamento[]>();
    for (const item of agendamentos) {
      const k = getClientKey(item.user_id, item.cliente_nome);
      const list = grouped.get(k);
      if (list) list.push(item);
      else grouped.set(k, [item]);
    }
    const result = new Map<
      string,
      { cliente: ClienteProfile | null; metrics: ClientMetrics; creditoSaldo: number; ags: Agendamento[] }
    >();
    const profileById = new Map(clientes.map((c) => [c.id, c]));

    grouped.forEach((ags, key) => {
      const first = ags[0];
      const profile = first?.user_id ? profileById.get(first.user_id) || null : null;
      result.set(key, {
        cliente: profile,
        metrics: computeClientMetrics(ags),
        creditoSaldo: Number(profile?.credito_saldo || 0),
        ags,
      });
    });
    return result;
  }, [agendamentos, clientes]);

  const getClientFinancialInfo = (a: Agendamento) => {
    const key = getClientKey(a.user_id, a.cliente_nome);
    return (
      clientFinancialMap.get(key) || {
        cliente: clientes.find((c) => c.id === a.user_id) || null,
        metrics: computeClientMetrics([a]),
        creditoSaldo: 0,
        ags: [a],
      }
    );
  };

  const activeFichaData = useMemo(() => {
    if (!fichaTarget) return null;
    const key = getClientKey(fichaTarget.userId, fichaTarget.nome);
    const info = clientFinancialMap.get(key);
    const profile = fichaTarget.userId
      ? clientes.find((c) => c.id === fichaTarget.userId) || info?.cliente || null
      : null;
    return {
      cliente: profile,
      nome: profile?.nome || fichaTarget.nome,
      ags: info?.ags || [],
    };
  }, [fichaTarget, clientFinancialMap, clientes]);

  // Notifications: today's appointments, pending payments, no-shows
  const notifications = useMemo(() => {
    const notifs: { tipo: "hoje" | "pendente" | "sinal" | "falta" | "proximo"; agendamento: Agendamento; label: string }[] = [];
    const todayDate = new Date(today + "T12:00:00");

    agendamentos.forEach((a) => {
      if (a.status === "cancelado") return;

      const aDate = new Date(a.data_agendamento + "T12:00:00");
      const diffDays = Math.round((aDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));

      // Falta (no-show)
      if (a.status === "falta") {
        notifs.push({ tipo: "falta", agendamento: a, label: "Cliente faltou" });
        return;
      }

      // Today's confirmed appointments
      if (diffDays === 0 && a.status === "confirmado") {
        notifs.push({ tipo: "hoje", agendamento: a, label: `Hoje às ${a.horario}` });
      }

      // Tomorrow
      if (diffDays === 1 && a.status === "confirmado") {
        notifs.push({ tipo: "proximo", agendamento: a, label: "Amanhã" });
      }

      // Quitado parcial ou não pago — usa Math.max(valor_pago, soma_historico) para não mostrar pendente quem já quitou
      const valorPagoBanco = Number(a.valor_pago || 0) + Number(a.valor_desconto_credito || 0);
      const somaHistorico = allHistoricoMap[a.id] || 0;
      const efetivamentePago = Math.max(valorPagoBanco, somaHistorico);
      if (a.status !== "falta" && efetivamentePago < Number(a.valor) && diffDays <= 0) {
        const restante = Number(a.valor) - efetivamentePago;
        if (efetivamentePago > 0) {
          notifs.push({ tipo: "sinal", agendamento: a, label: `Quitado parcial · a receber ${formatCurrency(restante)}` });
        } else {
          notifs.push({ tipo: "pendente", agendamento: a, label: `Não pago · ${formatCurrency(restante)}` });
        }
      }
    });

    const order = { falta: 0, hoje: 1, pendente: 2, sinal: 3, proximo: 4 };
    notifs.sort((a, b) => order[a.tipo] - order[b.tipo]);
    return notifs;
  }, [agendamentos, today, allHistoricoMap]);

  const activeNotifications = useMemo(
    () => notifications.filter((n) => !dismissedIds.has(n.agendamento.id + n.tipo)),
    [notifications, dismissedIds]
  );

  const dismissNotification = (id: string, tipo: string) => {
    setDismissedIds((prev) => {
      const next = new Set(prev);
      next.add(id + tipo);
      localStorage.setItem("pedidos_dismissed", JSON.stringify([...next]));
      return next;
    });
    toast.success("Marcada como lida");
  };

  const clearAllNotifications = () => {
    const keys = activeNotifications.map((n) => n.agendamento.id + n.tipo);
    setDismissedIds((prev) => {
      const next = new Set([...prev, ...keys]);
      localStorage.setItem("pedidos_dismissed", JSON.stringify([...next]));
      return next;
    });
    toast.success("Todas limpas");
  };

  const filtered = useMemo(() => {
    let list = [...allItems];
    if (statusFilter !== "todos") list = list.filter((a) => a.status === statusFilter);
    if (pagamentoFilter !== "todos") {
      list = list.filter((a) => matchesPagamentoFilter(a, pagamentoFilter));
    }
    if (dateFilter) {
      list = list.filter((a) => a.data_agendamento === dateFilter);
    }
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      list = list.filter(
        (a) =>
          getClientName(a.user_id, a.cliente_nome).toLowerCase().includes(term) ||
          a.servico.toLowerCase().includes(term) ||
          a.data_agendamento.includes(term)
      );
    }
    list.sort(
      (a, b) =>
        b.data_agendamento.localeCompare(a.data_agendamento) ||
        b.horario.localeCompare(a.horario)
    );
    return list;
  }, [allItems, statusFilter, pagamentoFilter, dateFilter, searchTerm, getClientName]);

  const updateStatus = async (id: string, status: string) => {
    await supabase.from("agendamentos").update({ status }).eq("id", id);
    onUpdate();
    toast.success(`Status atualizado para ${status}`);
  };

  const deleteAgendamento = (id: string) => {
    confirm({
      title: "Excluir Pedido",
      description: "Esta ação apagará permanentemente o pedido.",
      variant: "destructive",
      onConfirm: async () => {
        await supabase.from("agendamentos").delete().eq("id", id);
        onUpdate();
        toast.success("Pedido excluído");
      }
    });
  };

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      confirmado: "bg-gold/10 text-gold border-gold/20",
      cancelado: "bg-rose/10 text-rose border-rose/20",
      concluido: "bg-green-500/10 text-green-500 border-green-500/20",
      falta: "bg-orange-500/10 text-orange-500 border-orange-500/20",
    };
    const labels: Record<string, string> = { confirmado: "Confirmado", cancelado: "Cancelado", concluido: "Concluído", falta: "Não veio" };
    return (
      <span className={`px-2 py-0.5 rounded-full text-[10px] font-body font-medium border ${map[s] || "bg-secondary text-muted-foreground border-border"}`}>
        {labels[s] || s}
      </span>
    );
  };

  const paidBadge = (a: Agendamento) => {
    if (isPago(a)) {
      return (
        <span title="Pago integralmente" className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-green-500/30 bg-green-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-green-400">
          <CheckCircle className="h-2.5 w-2.5" /> Pago
        </span>
      );
    }
    if (isSinalPago(a)) {
      return (
        <span title="Quitado parcial — falta receber o restante" className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-400">
          <Wallet className="h-2.5 w-2.5" /> Quitado parcial
        </span>
      );
    }
    return (
      <span title="Não pago" className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-red-400">
        <AlertTriangle className="h-2.5 w-2.5" /> Não pago
      </span>
    );
  };

  const paymentBadge = (a: Agendamento) => {
    const recepcao = isFormaRecepcao(a.forma_pagamento);
    return (
      <span className="inline-flex flex-wrap items-center gap-1">
        {recepcao && (
          <span title="Pagar na recepção" className="inline-flex shrink-0 items-center gap-0.5 rounded-full border border-blue-500/30 bg-blue-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-blue-400">
            <Clock className="h-2.5 w-2.5" /> Recepção
          </span>
        )}
        {paidBadge(a)}
      </span>
    );
  };

  // ===== Histórico/auditoria de pagamentos =====
  interface HistoricoEntry {
    id: string;
    agendamento_id: string;
    status_anterior: string;
    status_novo: string;
    valor_anterior: number;
    valor_novo: number;
    valor_delta: number;
    total: number;
    acao: string;
    autor_nome: string;
    observacao?: string;
    created_at: string;
  }
  const [historicoMap, setHistoricoMap] = useState<Record<string, HistoricoEntry[]>>({});

  const statusFromValor = (valor_pago: number, total: number): "nao_pago" | "quitado_parcial" | "quitado" => {
    if (valor_pago <= 0) return "nao_pago";
    if (valor_pago >= total) return "quitado";
    return "quitado_parcial";
  };
  const statusLabel = (s: string) =>
    s === "quitado" ? "Quitado" : s === "quitado_parcial" ? "Quitado parcial" : s === "nao_pago" ? "Não pago" : s;
  const statusColor = (s: string) =>
    s === "quitado" ? "text-green-400 border-green-500/30 bg-green-500/10"
    : s === "quitado_parcial" ? "text-amber-400 border-amber-500/40 bg-amber-500/10"
    : "text-red-400 border-red-500/30 bg-red-500/10";

  const loadHistorico = async (agendamentoId: string) => {
    if (!isSupabaseConfigured) {
      const localRows = getLocalPagamentoHistorico()
        .filter((h) => h.agendamento_id === agendamentoId)
        .sort((a, b) => b.created_at.localeCompare(a.created_at));
      setHistoricoMap((prev) => ({ ...prev, [agendamentoId]: localRows as HistoricoEntry[] }));
      return;
    }
    const { data } = await supabase
      .from("pagamento_historico")
      .select("*")
      .eq("agendamento_id", agendamentoId)
      .order("created_at", { ascending: false });
    setHistoricoMap((prev) => ({ ...prev, [agendamentoId]: (data || []) as HistoricoEntry[] }));
  };

  const logPagamento = async (a: Agendamento, valor_novo: number, acao: "registro" | "quitar" | "estorno", observacao?: string) => {
    const valor_anterior = Number(a.valor_pago || 0);
    const total = Number(a.valor);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const autor_id = userRes?.user?.id || null;
      const autor_nome =
        (userRes?.user?.user_metadata as any)?.nome ||
        userRes?.user?.email ||
        "Admin";
      await supabase.from("pagamento_historico").insert({
        agendamento_id: a.id,
        status_anterior: statusFromValor(valor_anterior, total),
        status_novo: statusFromValor(valor_novo, total),
        valor_anterior,
        valor_novo,
        valor_delta: valor_novo - valor_anterior,
        total,
        acao,
        autor_id,
        autor_nome,
        observacao: observacao || "",
      });
      // refresh if already loaded
      if (historicoMap[a.id]) await loadHistorico(a.id);
    } catch (err) {
      console.error("Falha ao registrar histórico de pagamento", err);
    }
  };

  const registrarPagamentoIntegral = (a: Agendamento) => {
    setQuitarAg(a);
    setQuitarForma("");
  };

  const confirmarQuitarTudo = async () => {
    if (!quitarAg) return;
    if (!quitarForma) { toast.error("Selecione a forma de pagamento"); return; }
    const total = Number(quitarAg.valor);
    const pagoAntes = Number(quitarAg.valor_pago || 0);
    const descontoCredito = Number(quitarAg.valor_desconto_credito || 0);
    const restante = Math.max(0, total - pagoAntes - descontoCredito);
    const valorParcela = restante > 0 ? restante : Math.max(0, total - pagoAntes);
    try {
      const res = await persistAppointmentPayment({
        agendamento: {
          id: quitarAg.id,
          servico: quitarAg.servico,
          variacao: quitarAg.variacao,
          valor: total,
          valor_pago: pagoAntes,
          valor_desconto_credito: descontoCredito,
          data_agendamento: quitarAg.data_agendamento,
          forma_pagamento: quitarAg.forma_pagamento,
          cliente_nome: quitarAg.cliente_nome,
          status: quitarAg.status,
          observacao: quitarAg.observacao,
        },
        valorAdicional: valorParcela > 0 ? valorParcela : total,
        formaPagamento: quitarForma,
        observacao: pagoAntes > 0 ? "Quitação de saldo restante" : "",
        origem: "pedidos_tab",
      });
      setLocalOverrides((prev) => ({
        ...prev,
        [quitarAg.id]: { valor_pago: res.novoValorPago, forma_pagamento: quitarForma, paid_at: res.paidAt },
      }));
      if (historicoMap[quitarAg.id]) await loadHistorico(quitarAg.id);
      onUpdate();
      setQuitarAg(null);
      setQuitarForma("");
      toast.success("Pagamento quitado e lançado no Caixa ✅");
    } catch (err: any) {
      toast.error(err?.message || "Erro ao quitar pagamento");
    }
  };

  const [pagamentoAg, setPagamentoAg] = useState<Agendamento | null>(null);
  const [pagamentoInput, setPagamentoInput] = useState<string>("");
  const [pagamentoForma, setPagamentoForma] = useState<string>("");
  const [pagamentoObs, setPagamentoObs] = useState<string>("");

  const [quitarAg, setQuitarAg] = useState<Agendamento | null>(null);
  const [quitarForma, setQuitarForma] = useState<string>("");

  const [addValorAg, setAddValorAg] = useState<Agendamento | null>(null);
  const [addValorInput, setAddValorInput] = useState<string>("");

  const [editAg, setEditAg] = useState<Agendamento | null>(null);
  const [editValorInput, setEditValorInput] = useState<string>("");
  const [editValorPagoInput, setEditValorPagoInput] = useState<string>("");
  const [savingEdit, setSavingEdit] = useState(false);

  const [obsModalAg, setObsModalAg] = useState<Agendamento | null>(null);
  const [obsModalText, setObsModalText] = useState<string>("");
  const [savingObs, setSavingObs] = useState(false);

  const abrirObsModal = (a: Agendamento) => {
    setObsModalAg(a);
    setObsModalText(a.observacao || "");
  };

  const salvarObservacaoPedido = async () => {
    if (!obsModalAg) return;
    setSavingObs(true);
    await supabase.from("agendamentos").update({ observacao: obsModalText.trim() || null }).eq("id", obsModalAg.id);
    onUpdate();
    setObsModalAg(null);
    setSavingObs(false);
    toast.success(obsModalText.trim() ? "Observação salva ✅" : "Observação removida");
  };

  const abrirEdicaoValores = (a: Agendamento) => {
    setEditAg(a);
    setEditValorInput(Number(a.valor).toFixed(2).replace(".", ","));
    setEditValorPagoInput(Number(a.valor_pago || 0).toFixed(2).replace(".", ","));
  };

  const confirmarEdicaoValores = async () => {
    if (!editAg) return;
    setSavingEdit(true);
    const novoValorPago = parseCurrencyStr(editValorPagoInput);
    let novoValor = parseCurrencyStr(editValorInput);
    
    if (!Number.isFinite(novoValor) || !Number.isFinite(novoValorPago)) {
      toast.error("Valores inválidos");
      setSavingEdit(false);
      return;
    }

    // Se valor pago for maior que o valor do serviço (ex: placeholder R$1),
    // ajusta o valor total do serviço automaticamente.
    if (novoValorPago > novoValor) novoValor = novoValorPago;

    const paymentChanged = novoValorPago !== Number(editAg.valor_pago || 0);
    const updatePayload: any = {
      valor: novoValor,
      valor_pago: novoValorPago,
      ...(paymentChanged ? { paid_at: new Date().toISOString() } : {}),
    };

    await supabase.from("agendamentos").update(updatePayload).eq("id", editAg.id);

    try {
      const { data: userRes } = await supabase.auth.getUser();
      await supabase.from("pagamento_historico").insert({
        agendamento_id: editAg.id,
        status_anterior: statusFromValor(Number(editAg.valor_pago || 0), Number(editAg.valor)),
        status_novo: statusFromValor(novoValorPago, novoValor),
        valor_anterior: Number(editAg.valor_pago || 0),
        valor_novo: novoValorPago,
        valor_delta: novoValorPago - Number(editAg.valor_pago || 0),
        total: novoValor,
        acao: "ajuste_admin",
        autor_id: userRes?.user?.id || null,
        autor_nome: (userRes?.user?.user_metadata as any)?.nome || userRes?.user?.email || "Admin",
      });
      if (historicoMap[editAg.id]) await loadHistorico(editAg.id);
    } catch (err) {}

    onUpdate();
    setEditAg(null);
    setSavingEdit(false);
    toast.success("Valores atualizados com sucesso");
  };

  const abrirAddValor = (a: Agendamento) => {
    setAddValorAg(a);
    setAddValorInput("");
  };

  const confirmarAddValor = async () => {
    if (!addValorAg) return;
    const valorAdicional = parseCurrencyStr(addValorInput);
    if (!Number.isFinite(valorAdicional) || valorAdicional <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    const novoTotal = Number(addValorAg.valor) + valorAdicional;
    await supabase.from("agendamentos").update({ valor: novoTotal }).eq("id", addValorAg.id);
    
    try {
      const { data: userRes } = await supabase.auth.getUser();
      await supabase.from("pagamento_historico").insert({
        agendamento_id: addValorAg.id,
        status_anterior: statusFromValor(Number(addValorAg.valor_pago || 0), Number(addValorAg.valor)),
        status_novo: statusFromValor(Number(addValorAg.valor_pago || 0), novoTotal),
        valor_anterior: Number(addValorAg.valor_pago || 0),
        valor_novo: Number(addValorAg.valor_pago || 0),
        valor_delta: valorAdicional,
        total: novoTotal,
        acao: "acrescimo",
        autor_id: userRes?.user?.id || null,
        autor_nome: (userRes?.user?.user_metadata as any)?.nome || userRes?.user?.email || "Admin",
      });
      if (historicoMap[addValorAg.id]) await loadHistorico(addValorAg.id);
    } catch (err) {}

    onUpdate();
    setAddValorAg(null);
    setAddValorInput("");
    toast.success(`Valor adicional de ${formatCurrency(valorAdicional)} registrado`);
  };

  const abrirRegistroPagamento = (a: Agendamento, sugestao?: "sinal" | "restante") => {
    const valorTotal = Number(a.valor);
    const pago = Number(a.valor_pago || 0);
    const restante = Math.max(0, valorTotal - pago - Number(a.valor_desconto_credito || 0));
    let sugestaoValor = restante;
    if (sugestao === "sinal") sugestaoValor = Math.round(valorTotal * 0.5 * 100) / 100;
    setPagamentoAg(a);
    setPagamentoInput(sugestaoValor.toFixed(2).replace(".", ","));
    setPagamentoObs("");
  };

  const confirmarRegistroPagamento = async () => {
    if (!pagamentoAg) return;
    if (!pagamentoForma) { toast.error("Selecione a forma de pagamento"); return; }
    const valor = parseCurrencyStr(pagamentoInput);
    if (!Number.isFinite(valor) || valor <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    const pagoAntes = Number(pagamentoAg.valor_pago || 0);
    const valorServico = Number(pagamentoAg.valor);
    const novoTotalPago = pagoAntes + valor;

    // Se o valor pago superar o valor do serviço (ex: serviço cadastrado como R$1 placeholder),
    // atualiza o valor total do serviço para refletir o que foi realmente cobrado.
    const novoValorServico = novoTotalPago > valorServico ? novoTotalPago : valorServico;
    const totalAgora = Math.min(novoValorServico, novoTotalPago);
    const valorParcelaReal = Math.max(0, totalAgora - pagoAntes);

    try {
      const res = await persistAppointmentPayment({
        agendamento: {
          id: pagamentoAg.id,
          servico: pagamentoAg.servico,
          variacao: pagamentoAg.variacao,
          valor: valorServico,
          valor_pago: pagoAntes,
          valor_desconto_credito: pagamentoAg.valor_desconto_credito,
          data_agendamento: pagamentoAg.data_agendamento,
          forma_pagamento: pagamentoAg.forma_pagamento,
          cliente_nome: pagamentoAg.cliente_nome,
          status: pagamentoAg.status,
          observacao: pagamentoAg.observacao,
        },
        valorAdicional: valorParcelaReal > 0 ? valorParcelaReal : valor,
        formaPagamento: pagamentoForma,
        observacao: pagamentoObs.trim(),
        novoValorServico,
        origem: "pedidos_tab",
      });
      setLocalOverrides((prev) => ({
        ...prev,
        [pagamentoAg.id]: {
          valor: res.novoValorTotal,
          valor_pago: res.novoValorPago,
          forma_pagamento: pagamentoForma,
          paid_at: res.paidAt,
        },
      }));
      if (historicoMap[pagamentoAg.id]) await loadHistorico(pagamentoAg.id);
      onUpdate();
      setPagamentoAg(null);
      setPagamentoInput("");
      setPagamentoForma("");
      setPagamentoObs("");
      if (res.quitada) {
        toast.success("Pagamento quitado e lançado no Caixa ✅");
      } else {
        toast.success(`Parcela lançada no Caixa · falta ${formatCurrency(res.restante)}`);
      }
    } catch (err: any) {
      toast.error(err?.message || "Erro ao registrar pagamento");
    }
  };




  const counts = useMemo(() => ({
    todos: agendamentos.length,
    confirmado: agendamentos.filter((a) => a.status === "confirmado").length,
    concluido: agendamentos.filter((a) => a.status === "concluido").length,
    cancelado: agendamentos.filter((a) => a.status === "cancelado").length,
    falta: agendamentos.filter((a) => a.status === "falta").length,
  }), [agendamentos]);

  const pagamentoCounts = useMemo(() => {
    return {
      todos: allItems.length,
      pago: allItems.filter((a) => isPago(a)).length,
      sinal: allItems.filter((a) => isSinalPago(a)).length,
      recepcao: allItems.filter((a) => isFormaRecepcao(a.forma_pagamento)).length,
      pendente: allItems.filter((a) => isNaoPago(a)).length,
    };
  }, [allItems]);

  const devedores = useMemo(() => {
    return allItems
      .filter((a) => a.status !== "cancelado" && a.status !== "falta" && !isPago(a))
      .sort((a, b) => (b.data_agendamento || "").localeCompare(a.data_agendamento || ""));
  }, [allItems]);

  const totalAReceber = useMemo(() => {
    return devedores.reduce((sum, a) => sum + (Number(a.valor) - Number(a.valor_pago || 0) - Number(a.valor_desconto_credito || 0)), 0);
  }, [devedores]);

  const notifConfig = {
    hoje: { bg: "bg-gold/10 border-gold/25", icon: Clock, iconColor: "text-gold", titleColor: "text-gold" },
    proximo: { bg: "bg-blue-500/10 border-blue-500/25", icon: Clock, iconColor: "text-blue-400", titleColor: "text-blue-400" },
    pendente: { bg: "bg-red-500/10 border-red-500/25", icon: AlertTriangle, iconColor: "text-red-400", titleColor: "text-red-400" },
    sinal: { bg: "bg-amber-500/10 border-amber-500/25", icon: Wallet, iconColor: "text-amber-400", titleColor: "text-amber-400" },
    falta: { bg: "bg-orange-500/10 border-orange-500/25", icon: UserX, iconColor: "text-orange-400", titleColor: "text-orange-400" },
  };

  const hasActiveFilters =
    statusFilter !== "todos" || pagamentoFilter !== "todos" || Boolean(dateFilter) || Boolean(searchTerm.trim());

  const clearAllFilters = () => {
    setStatusFilter("todos");
    setPagamentoFilter("todos");
    setDateFilter("");
    setSearchTerm("");
  };

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Cabeçalho */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-xl font-semibold text-primary-foreground">Pedidos</h2>
            <span className="px-2 py-0.5 rounded-full bg-gold/15 border border-gold/25 font-body text-[11px] font-semibold text-gold tabular-nums">
              {counts.todos}
            </span>
          </div>
          <p className="font-body text-[11.5px] text-primary-foreground/55 mt-0.5">
            Atendimentos, situação de pagamento e ficha completa de cada cliente
          </p>
        </div>

        <div className="flex items-center gap-2">
          {totalAReceber > 0 && (
            <button
              type="button"
              onClick={() => setDevedoresOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-amber-500/35 bg-amber-500/15 text-amber-300 font-body text-[12px] font-semibold hover:bg-amber-500/25 transition-all"
            >
              <Wallet className="w-3.5 h-3.5" />
              <span>A receber: {formatCurrency(totalAReceber)}</span>
            </button>
          )}

          {/* Notificações */}
          <Sheet>
            <SheetTrigger asChild>
              <button
                type="button"
                title="Notificações da agenda"
                className="relative flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.08] text-primary-foreground/80 font-body text-[12px] font-medium transition-all hover:bg-primary-foreground/[0.09]"
              >
                <Bell className={`h-4 w-4 ${activeNotifications.length > 0 ? "text-gold" : "text-primary-foreground/75"}`} />
                <span className="hidden sm:inline">Alertas</span>
                {activeNotifications.length > 0 && (
                  <span className="flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white">
                    {activeNotifications.length}
                  </span>
                )}
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[340px] sm:w-[400px] bg-charcoal border-primary-foreground/[0.06] p-0">
              <SheetHeader className="px-5 pt-5 pb-4 border-b border-primary-foreground/[0.06]">
                <SheetTitle className="font-heading text-[16px] font-semibold text-primary-foreground flex items-center gap-2">
                  <Bell className="w-4 h-4 text-gold" />
                  Notificações da Agenda
                  {activeNotifications.length > 0 && (
                    <span className="ml-auto px-2 py-0.5 rounded-full bg-red-500/15 text-red-400 text-[10px] font-body font-medium border border-red-500/20">
                      {activeNotifications.length}
                    </span>
                  )}
                </SheetTitle>
              </SheetHeader>

              {activeNotifications.length > 0 && (
                <div className="px-4 pt-3 flex justify-end">
                  <button
                    onClick={clearAllNotifications}
                    className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-body text-[10px] font-medium text-primary-foreground/95 transition-all hover:bg-primary-foreground/[0.06] hover:text-primary-foreground/85"
                  >
                    <X className="h-3 w-3" /> Limpar tudo
                  </button>
                </div>
              )}

              <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 max-h-[calc(100vh-160px)]">
                {activeNotifications.length === 0 ? (
                  <div className="py-16 text-center">
                    <CheckCircle className="h-8 w-8 text-green-400/40 mx-auto mb-3" />
                    <p className="font-body text-[13px] text-primary-foreground/95">Tudo em dia! 🎉</p>
                    <p className="font-body text-[11px] text-primary-foreground/85 mt-1">Nenhuma notificação pendente</p>
                  </div>
                ) : (
                  activeNotifications.map((n, i) => {
                    const cfg = notifConfig[n.tipo];
                    const Icon = cfg.icon;
                    return (
                      <div key={n.agendamento.id + n.tipo + i} className={`rounded-xl border p-3 transition-all ${cfg.bg}`}>
                        <div className="flex items-start gap-2.5">
                          <div className={`mt-0.5 shrink-0 ${cfg.iconColor}`}>
                            <Icon className="h-4 w-4" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className={`font-body text-[11px] font-semibold ${cfg.titleColor}`}>{n.label}</p>
                            <p className="font-body text-[13px] font-medium text-primary-foreground truncate mt-0.5">
                              {getClientName(n.agendamento.user_id, n.agendamento.cliente_nome)}
                            </p>
                            <p className="font-body text-[11px] text-primary-foreground/75 truncate">
                              {n.agendamento.servico}{n.agendamento.variacao ? ` · ${n.agendamento.variacao}` : ""}
                            </p>
                            <div className="flex items-center gap-2 mt-1">
                              <span className="font-heading text-[13px] font-bold text-primary-foreground">
                                {formatCurrency(Number(n.agendamento.valor))}
                              </span>
                              <span className="font-body text-[10px] text-primary-foreground/95">
                                {formatDate(n.agendamento.data_agendamento)} · {n.agendamento.horario}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5 mt-2">
                              <button
                                onClick={() => dismissNotification(n.agendamento.id, n.tipo)}
                                className="flex items-center gap-1 rounded-lg px-2 py-1 bg-primary-foreground/[0.06] text-primary-foreground/75 text-[10px] font-body font-medium border border-primary-foreground/[0.08] hover:bg-primary-foreground/[0.1] hover:text-primary-foreground/95 transition-all"
                              >
                                <Eye className="h-3 w-3" /> Lida
                              </button>
                              <BinButton
                                size="sm"
                                onClick={() => deleteAgendamento(n.agendamento.id)}
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>

      {/* Banner de alertas do dia */}
      {activeNotifications.filter(n => n.tipo === "hoje" || n.tipo === "falta").length > 0 && (
        <div className="flex items-center gap-2 rounded-xl border border-gold/30 bg-gold/10 px-3 py-2.5">
          <Bell className="h-4 w-4 text-gold shrink-0" />
          <p className="font-body text-[12px] text-gold flex-1">
            Você tem <strong>{activeNotifications.filter(n => n.tipo === "hoje").length}</strong> atendimento(s) hoje
            {activeNotifications.filter(n => n.tipo === "falta").length > 0 && (
              <> e <strong className="text-orange-400">{activeNotifications.filter(n => n.tipo === "falta").length}</strong> falta(s)</>
            )}
          </p>
        </div>
      )}

      {/* Cards de Status Clicáveis (funcionam direto como filtro) */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
        {([
          { key: "todos", label: "Todos", color: "text-primary-foreground", activeBorder: "border-gold/55 bg-gold/15" },
          { key: "confirmado", label: "Confirmados", color: "text-gold", activeBorder: "border-gold/55 bg-gold/15" },
          { key: "concluido", label: "Concluídos", color: "text-emerald-400", activeBorder: "border-emerald-500/45 bg-emerald-500/10" },
          { key: "falta", label: "Faltas", color: "text-amber-400", activeBorder: "border-amber-500/45 bg-amber-500/10" },
          { key: "cancelado", label: "Cancelados", color: "text-rose", activeBorder: "border-rose/45 bg-rose/10" },
        ] as const).map((s) => {
          const isActive = statusFilter === s.key;
          return (
            <button
              key={s.key}
              type="button"
              onClick={() =>
                setStatusFilter((prev) => (prev === s.key && s.key !== "todos" ? "todos" : s.key))
              }
              className={`rounded-2xl border p-3 text-center transition-all ${
                isActive
                  ? s.activeBorder
                  : "border-primary-foreground/[0.08] bg-[#1b1a1b] hover:border-primary-foreground/20"
              }`}
            >
              <p className={`font-heading text-[20px] font-bold tabular-nums leading-tight ${s.color}`}>
                {counts[s.key]}
              </p>
              <p className="font-body text-[10px] text-primary-foreground/65 uppercase tracking-wider mt-0.5">
                {s.label}
              </p>
            </button>
          );
        })}
      </div>

      {/* Busca, Data e Filtro de Pagamento unificados */}
      <div className="space-y-2.5 rounded-2xl border border-primary-foreground/[0.07] bg-primary-foreground/[0.02] p-3">
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-primary-foreground/45" />
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Buscar cliente, serviço ou data..."
              className="w-full rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.09] py-2.5 pl-9 pr-9 text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/40 focus:outline-none focus:border-gold/45"
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

          <div className="flex items-center gap-1.5 sm:w-44 shrink-0">
            <input
              type="date"
              value={dateFilter}
              onChange={(e) => setDateFilter(e.target.value)}
              aria-label="Filtrar por data"
              className={`w-full rounded-xl border px-3 py-2.5 font-body text-[12.5px] focus:outline-none focus:border-gold/45 cursor-pointer [color-scheme:dark] ${
                dateFilter
                  ? "bg-gold/15 border-gold/40 text-gold"
                  : "bg-primary-foreground/[0.04] border-primary-foreground/[0.09] text-primary-foreground/75"
              }`}
            />
            {dateFilter && (
              <button
                type="button"
                onClick={() => setDateFilter("")}
                title="Limpar data"
                className="p-2 rounded-xl bg-primary-foreground/[0.05] text-primary-foreground/60 hover:text-rose transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Chips limpos de situação do pagamento */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {([
              {
                value: "todos" as PagamentoFilter,
                label: "Tudo",
                count: pagamentoCounts.todos,
                activeCls: "bg-gold/20 border-gold/45 text-gold",
              },
              {
                value: "pago" as PagamentoFilter,
                label: "Pagos",
                count: pagamentoCounts.pago,
                activeCls: "bg-emerald-500/15 border-emerald-500/40 text-emerald-300",
              },
              {
                value: "sinal" as PagamentoFilter,
                label: "Parcial / Sinal",
                count: pagamentoCounts.sinal,
                activeCls: "bg-amber-500/15 border-amber-500/40 text-amber-300",
              },
              {
                value: "pendente" as PagamentoFilter,
                label: "Em aberto",
                count: pagamentoCounts.pendente,
                activeCls: "bg-red-500/15 border-red-500/40 text-red-300",
              },
            ]).map((f) => {
              const active = pagamentoFilter === f.value;
              return (
                <button
                  key={f.value}
                  type="button"
                  onClick={() => setPagamentoFilter(f.value)}
                  className={`px-2.5 py-1 rounded-full border font-body text-[11px] font-medium transition-all flex items-center gap-1.5 ${
                    active
                      ? f.activeCls
                      : "bg-primary-foreground/[0.03] border-primary-foreground/[0.08] text-primary-foreground/60 hover:text-primary-foreground"
                  }`}
                >
                  <span>{f.label}</span>
                  <span className="opacity-75 tabular-nums">{f.count}</span>
                </button>
              );
            })}
          </div>

          {hasActiveFilters && (
            <button
              type="button"
              onClick={clearAllFilters}
              className="font-body text-[11px] font-medium text-gold/80 hover:text-gold transition-colors"
            >
              Limpar filtros
            </button>
          )}
        </div>
      </div>

      {totalAReceber > 0 && (
        <button
          onClick={() => setDevedoresOpen(true)}
          className="w-full flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-gradient-to-r from-amber-500/10 to-amber-500/[0.03] px-3 py-2.5 hover:border-amber-500/50 hover:bg-amber-500/15 transition-all text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Wallet className="h-4 w-4 text-amber-400 shrink-0" />
            <div className="min-w-0">
              <p className="font-body text-[10px] text-amber-400/70 uppercase tracking-wider">Total a receber</p>
              <p className="font-heading text-[15px] font-bold text-amber-300 leading-tight">{formatCurrency(totalAReceber)}</p>
            </div>
          </div>
          <div className="flex flex-col items-end shrink-0">
            {pagamentoCounts.sinal > 0 && (
              <span className="font-body text-[10px] text-amber-300/80">{pagamentoCounts.sinal} parcial</span>
            )}
            {pagamentoCounts.pendente > 0 && (
              <span className="font-body text-[10px] text-red-300/80">{pagamentoCounts.pendente} sem pagar</span>
            )}
          </div>
        </button>
      )}

      <p className="font-body text-[11px] text-primary-foreground/95">
        {filtered.length} pedido{filtered.length !== 1 ? "s" : ""} encontrado{filtered.length !== 1 ? "s" : ""}
      </p>


      {/* List */}
      {filtered.length === 0 ? (
        <div className="py-12 text-center">
          <p className="font-body text-[13px] text-primary-foreground/95">Nenhum pedido encontrado</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.slice(0, visibleCount).map((a) => {
            const isExpanded = expandedId === a.id;
            const cInfo = getClientFinancialInfo(a);
            const clientDisplayName = getClientName(a.user_id, a.cliente_nome);
            const openFicha = () =>
              setFichaTarget({ userId: a.user_id, nome: clientDisplayName });

            return (
              <div key={a.id} className="rounded-xl border border-gold/15 bg-gradient-to-br from-gold/[0.05] via-primary-foreground/[0.02] to-nude/[0.03] overflow-hidden transition-all hover:border-gold/25 hover:shadow-[0_4px_16px_-8px_hsl(var(--gold)/0.25)]">
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => setExpandedId(isExpanded ? null : a.id)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      setExpandedId(isExpanded ? null : a.id);
                    }
                  }}
                  className="flex w-full items-center gap-3 p-3 text-left cursor-pointer"
                >
                  <div className="flex min-w-[52px] flex-col items-center rounded-xl border border-gold/60 bg-gradient-to-br from-gold/30 to-nude/20 px-2 py-1.5 shadow-[0_2px_12px_-3px_hsl(var(--gold)/0.5)]">
                    <span className="font-body text-[10px] font-semibold text-white/90 leading-tight">
                      {new Date(a.data_agendamento + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })}
                    </span>
                    <span className="font-heading text-[15px] font-bold text-white">{a.horario}</span>
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <p className="font-body text-[14px] font-medium text-primary-foreground break-words">{clientDisplayName}</p>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          openFicha();
                        }}
                        className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 font-body text-[10px] font-semibold text-gold hover:bg-gold/20 transition-all"
                      >
                        <Users className="h-2.5 w-2.5" />
                        Ficha
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap mt-1">
                      {paymentBadge(a)}
                      {cInfo.metrics.saldoDevedor > 0.01 && (
                        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/15 px-2 py-0.5 font-body text-[9.5px] font-semibold text-amber-300">
                          Deve {formatBRL(cInfo.metrics.saldoDevedor)} no total
                        </span>
                      )}
                      {cInfo.creditoSaldo > 0 && (
                        <span className="inline-flex items-center rounded-full border border-sky-400/30 bg-sky-500/15 px-2 py-0.5 font-body text-[9.5px] font-semibold text-sky-300">
                          Crédito {formatBRL(cInfo.creditoSaldo)}
                        </span>
                      )}
                    </div>
                    <p className="font-body text-[11px] text-primary-foreground/75 truncate mt-0.5">{a.servico}{a.variacao ? ` · ${a.variacao}` : ""}</p>
                  </div>
                  <div className="flex flex-col items-end gap-1 shrink-0">
                    {Number(a.valor_desconto_credito) > 0 ? (
                      <div className="flex flex-col items-end">
                        <p className="font-heading text-[14px] font-bold text-green-400">
                          {formatCurrency(Math.max(0, Number(a.valor) - Number(a.valor_desconto_credito)))}
                        </p>
                         <p className="font-heading text-[10px] font-medium text-primary-foreground/75 line-through">
                           {formatCurrency(Number(a.valor))}
                         </p>
                      </div>
                    ) : (
                      <p className="font-heading text-[14px] font-bold text-gold">{formatCurrency(Number(a.valor))}</p>
                    )}
                    {statusBadge(a.status)}
                  </div>
                  <ChevronDown className={`h-3.5 w-3.5 text-primary-foreground/95 shrink-0 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                </div>

                {isExpanded && (
                  <div className="border-t border-primary-foreground/[0.06] p-3 space-y-3 animate-fade-in">
                    {/* Situação completa da cliente */}
                    <div className="rounded-xl border border-gold/25 bg-[#1b1a1b] p-3 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5 text-gold" />
                          <span className="font-body text-[11px] font-semibold uppercase tracking-wider text-gold">
                            Situação da cliente
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openFicha();
                          }}
                          className="px-2.5 py-1 rounded-lg bg-gradient-to-br from-gold to-nude text-charcoal font-body text-[11px] font-bold hover:brightness-105 transition-all"
                        >
                          Ver ficha completa
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-primary-foreground/[0.04] p-2">
                          <p className="font-heading text-[13px] font-bold text-emerald-400 tabular-nums">
                            {formatBRL(cInfo.metrics.totalGasto)}
                          </p>
                          <p className="font-body text-[9.5px] text-primary-foreground/55 uppercase">Já pago</p>
                        </div>
                        <div className="rounded-lg bg-primary-foreground/[0.04] p-2">
                          <p
                            className={`font-heading text-[13px] font-bold tabular-nums ${
                              cInfo.metrics.saldoDevedor > 0.01 ? "text-amber-300" : "text-emerald-300"
                            }`}
                          >
                            {cInfo.metrics.saldoDevedor > 0.01
                              ? formatBRL(cInfo.metrics.saldoDevedor)
                              : "Em dia"}
                          </p>
                          <p className="font-body text-[9.5px] text-primary-foreground/55 uppercase">
                            {cInfo.metrics.pedidosDevendo > 0
                              ? `${cInfo.metrics.pedidosDevendo} em aberto`
                              : "Pendências"}
                          </p>
                        </div>
                        <div className="rounded-lg bg-primary-foreground/[0.04] p-2">
                          <p className="font-heading text-[13px] font-bold text-sky-300 tabular-nums">
                            {formatBRL(cInfo.creditoSaldo)}
                          </p>
                          <p className="font-body text-[9.5px] text-primary-foreground/55 uppercase">
                            Crédito · {cInfo.metrics.totalAgendamentos} visitas
                          </p>
                        </div>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 text-[11px] font-body">
                      <div>
                        <p className="text-primary-foreground/95">Data completa</p>
                        <p className="text-primary-foreground font-medium">{formatDate(a.data_agendamento)}</p>
                      </div>
                      <div>
                        <p className="text-primary-foreground/95">Valor total</p>
                        {Number(a.valor_desconto_credito) > 0 ? (
                          <div className="flex items-center gap-2 mt-0.5">
                             <p className="text-primary-foreground/75 font-medium text-[10px] line-through">{formatCurrency(Number(a.valor))}</p>
                            <p className="text-green-400 font-bold">{formatCurrency(Math.max(0, Number(a.valor) - Number(a.valor_desconto_credito)))}</p>
                          </div>
                        ) : (
                          <p className="text-primary-foreground font-medium">{formatCurrency(Number(a.valor))}</p>
                        )}
                      </div>
                      <div>
                        <p className="text-primary-foreground/95">Criado em</p>
                        <p className="text-primary-foreground font-medium">{new Date(a.created_at).toLocaleDateString("pt-BR")}</p>
                      </div>
                      <div>
                        <p className="text-primary-foreground/95">Serviço</p>
                        <p className="text-primary-foreground font-medium">{a.servico}</p>
                      </div>
                      <div className="col-span-2">
                        <p className="text-primary-foreground/95">Forma de pagamento</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <p className="text-primary-foreground font-medium capitalize">
                            {a.forma_pagamento || "—"}
                          </p>
                          {paymentBadge(a)}
                        </div>
                      </div>

                      {(Number(a.valor_gorjeta) > 0 || Number(a.valor_troco) > 0 || Number(a.valor_credito) > 0 || Number(a.valor_desconto_credito) > 0) && (
                        <div className="col-span-2 rounded-xl border border-primary-foreground/10 bg-primary-foreground/[0.03] p-3 space-y-2 mt-1">
                          <p className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/60 mb-1">Extras Financeiros</p>
                          {Number(a.valor_desconto_credito) > 0 && (
                            <div className="flex items-center justify-between">
                              <p className="text-primary-foreground/95">Desconto de Crédito</p>
                              <p className="text-amber-400 font-medium">- {formatCurrency(Number(a.valor_desconto_credito))}</p>
                            </div>
                          )}
                          {Number(a.valor_gorjeta) > 0 && (
                            <div className="flex items-center justify-between">
                              <p className="text-primary-foreground/95">Gorjeta</p>
                              <p className="text-purple-400 font-medium">{formatCurrency(Number(a.valor_gorjeta))}</p>
                            </div>
                          )}
                          {Number(a.valor_troco) > 0 && (
                            <div className="flex items-center justify-between">
                              <p className="text-primary-foreground/95">Troco</p>
                              <p className="text-blue-400 font-medium">{formatCurrency(Number(a.valor_troco))}</p>
                            </div>
                          )}
                          {Number(a.valor_credito) > 0 && (
                            <div className="flex items-center justify-between">
                              <p className="text-primary-foreground/95">Crédito</p>
                              <p className="text-green-400 font-medium">{formatCurrency(Number(a.valor_credito))}</p>
                            </div>
                          )}
                        </div>
                      )}

                      {isSinalPago(a) && a.status !== "cancelado" && (
                        <div className="col-span-2 rounded-xl border border-amber-500/40 bg-gradient-to-br from-amber-500/15 to-amber-500/[0.04] px-3 py-3 space-y-2">
                          <div className="flex items-center gap-1.5">
                            <Wallet className="h-4 w-4 text-amber-400" />
                            <p className="font-body text-[11px] font-semibold uppercase tracking-wider text-amber-400">Quitado parcial</p>
                          </div>
                          <div className="grid grid-cols-3 gap-2 text-[11px]">
                            <div>
                              <p className="text-primary-foreground/75 text-[10px]">Total</p>
                              <p className="text-primary-foreground/90 font-medium">{formatCurrency(Number(a.valor))}</p>
                            </div>
                            <div>
                              <p className="text-primary-foreground/75 text-[10px]">Pago parcial</p>
                              <p className="text-green-400 font-semibold">{formatCurrency(Number(a.valor_pago || 0))}</p>
                            </div>
                            <div>
                              <p className="text-primary-foreground/75 text-[10px]">A receber</p>
                              <p className="text-amber-300 font-bold">{formatCurrency(Number(a.valor) - Number(a.valor_pago || 0) - Number(a.valor_desconto_credito || 0))}</p>
                            </div>
                          </div>
                          <p className="font-body text-[11px] text-amber-200/80 leading-snug">
                            💡 O cliente pagou parte do valor. Registre quanto recebeu agora ou quite tudo de uma vez.
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); abrirRegistroPagamento(a, "restante"); }}
                              className="flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2 py-2 font-body text-[12px] font-semibold text-amber-200 hover:bg-amber-500/25 transition-all"
                            >
                              <Wallet className="h-4 w-4" /> Registrar pagamento
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); abrirAddValor(a); }}
                              className="flex items-center justify-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/15 px-2 py-2 font-body text-[12px] font-semibold text-blue-300 hover:bg-blue-500/25 hover:text-blue-200 transition-all"
                            >
                              <Plus className="h-4 w-4" /> Adicionar valor
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); registrarPagamentoIntegral(a); }}
                              className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg border border-green-500/40 bg-green-500/15 px-2 py-2 font-body text-[12px] font-semibold text-green-300 hover:bg-green-500/25 hover:text-green-200 transition-all"
                            >
                              <CheckCircle className="h-4 w-4" /> Quitar tudo
                            </button>
                          </div>
                        </div>
                      )}

                      {isNaoPago(a) && a.status !== "cancelado" && a.status !== "falta" && (
                        <div className="col-span-2 rounded-xl border border-red-500/30 bg-gradient-to-br from-red-500/10 to-red-500/[0.03] px-3 py-3 space-y-2">
                          <div className="flex items-center gap-1.5">
                            <AlertTriangle className="h-4 w-4 text-red-400" />
                            <p className="font-body text-[11px] font-semibold uppercase tracking-wider text-red-400">Nada pago ainda</p>
                          </div>
                          <p className="font-body text-[11px] text-primary-foreground/100">
                            A receber: <span className="font-bold text-red-300">{formatCurrency(Number(a.valor))}</span>
                          </p>
                          <div className="grid grid-cols-2 gap-2">
                            <button
                              onClick={(e) => { e.stopPropagation(); abrirRegistroPagamento(a, "sinal"); }}
                              className="flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2 py-2 font-body text-[12px] font-semibold text-amber-200 hover:bg-amber-500/25 transition-all"
                            >
                              <Wallet className="h-4 w-4" /> Registrar sinal
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); abrirAddValor(a); }}
                              className="flex items-center justify-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/15 px-2 py-2 font-body text-[12px] font-semibold text-blue-300 hover:bg-blue-500/25 hover:text-blue-200 transition-all"
                            >
                              <Plus className="h-4 w-4" /> Adicionar valor
                            </button>
                            <button
                              onClick={(e) => { e.stopPropagation(); registrarPagamentoIntegral(a); }}
                              className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg border border-green-500/40 bg-green-500/15 px-2 py-2 font-body text-[12px] font-semibold text-green-300 hover:bg-green-500/25 hover:text-green-200 transition-all"
                            >
                              <CheckCircle className="h-4 w-4" /> Quitar tudo
                            </button>
                          </div>
                        </div>
                      )}
                      {/* Observação do pedido */}
                      <div className="col-span-2">
                        {a.observacao ? (
                          <div className="rounded-xl border border-gold/25 bg-gold/[0.06] px-3 py-2.5 flex items-start gap-2">
                            <span className="text-[13px] shrink-0 mt-0.5">📝</span>
                            <div className="flex-1 min-w-0">
                              <p className="font-body text-[9px] text-gold/70 uppercase tracking-wider mb-0.5">Observação do Pedido</p>
                              <p className="font-body text-[12px] text-primary-foreground/85 leading-snug whitespace-pre-wrap break-words">{a.observacao}</p>
                            </div>
                            <button
                              onClick={(e) => { e.stopPropagation(); abrirObsModal(a); }}
                              className="shrink-0 h-6 w-6 flex items-center justify-center rounded-lg bg-gold/10 border border-gold/20 text-gold/70 hover:bg-gold/20 hover:text-gold transition-all"
                              title="Editar observação"
                            >
                              <Edit2 className="h-3 w-3" />
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={(e) => { e.stopPropagation(); abrirObsModal(a); }}
                            className="w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-primary-foreground/20 bg-transparent px-3 py-2 font-body text-[11px] text-primary-foreground/50 hover:border-gold/30 hover:text-gold/70 hover:bg-gold/[0.04] transition-all"
                          >
                            <span className="text-[13px]">📝</span> Adicionar observação ao pedido
                          </button>
                        )}
                      </div>
                      {a.payment_id && (
                        <div className="col-span-2 rounded-lg border border-green-500/30 bg-gradient-to-br from-green-500/10 to-green-500/[0.03] px-3 py-2.5 space-y-1.5">
                          <div className="flex items-center gap-1.5">
                            <CheckCircle className="h-3.5 w-3.5 text-green-400" />
                            <p className="font-body text-[11px] font-semibold uppercase tracking-wider text-green-400">Pagamento aprovado</p>
                          </div>
                          {a.paid_at && (
                            <div className="flex justify-between gap-2">
                              <span className="text-primary-foreground/75 text-[11px]">Pago em</span>
                              <span className="text-primary-foreground/90 text-[11px] font-medium">
                                {new Date(a.paid_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}
                              </span>
                            </div>
                          )}
                          {a.payer_name && (
                            <div className="flex justify-between gap-2">
                              <span className="text-primary-foreground/75 text-[11px]">Pagador</span>
                              <span className="text-primary-foreground/90 text-[11px] font-medium truncate max-w-[60%]" title={a.payer_name}>{a.payer_name}</span>
                            </div>
                          )}
                          <div className="flex justify-between gap-2">
                            <span className="text-primary-foreground/75 text-[11px]">ID da transação</span>
                            <span className="text-primary-foreground/100 text-[10px] font-mono truncate max-w-[55%]" title={a.payment_id}>{a.payment_id}</span>
                          </div>
                          {a.receipt_url && (
                            <a
                              href={a.receipt_url}
                              target="_blank"
                              rel="noopener noreferrer"
                              onClick={(e) => e.stopPropagation()}
                              className="mt-1 flex items-center justify-center gap-1.5 rounded-lg border border-green-500/40 bg-green-500/15 px-3 py-1.5 font-body text-[11px] font-semibold text-green-300 hover:bg-green-500/25 hover:text-green-200 transition-all"
                            >
                              🧾 Ver comprovante oficial
                            </a>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="border-t border-primary-foreground/[0.06] pt-3 space-y-2">
                      <p className="font-body text-[10px] text-primary-foreground/95 uppercase tracking-wider">Alterar status</p>
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {a.status !== "confirmado" && (
                          <button onClick={() => updateStatus(a.id, "confirmado")}
                            className="group relative flex items-center gap-1.5 overflow-hidden rounded-xl border border-gold/30 bg-gold/[0.08] px-3 py-1.5 font-body text-[11px] font-semibold text-gold backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_12px_-4px_rgba(216,146,106,0.25)] transition-all hover:border-gold/60 hover:bg-gold/15 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_6px_18px_-4px_rgba(216,146,106,0.45)] active:scale-[0.97]">
                            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent" />
                            <CheckCircle className="relative h-3.5 w-3.5" /> <span className="relative">Confirmado</span>
                          </button>
                        )}
                        {a.status !== "concluido" && (
                          <button onClick={() => updateStatus(a.id, "concluido")}
                            className="group relative flex items-center gap-1.5 overflow-hidden rounded-xl border border-green-500/30 bg-green-500/[0.08] px-3 py-1.5 font-body text-[11px] font-semibold text-green-400 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_12px_-4px_rgba(34,197,94,0.25)] transition-all hover:border-green-400/60 hover:bg-green-500/15 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_6px_18px_-4px_rgba(34,197,94,0.45)] active:scale-[0.97]">
                            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent" />
                            <CheckCircle className="relative h-3.5 w-3.5" /> <span className="relative">Concluído</span>
                          </button>
                        )}
                        {a.status !== "falta" && (
                          <button onClick={() => updateStatus(a.id, "falta")}
                            className="group relative flex items-center gap-1.5 overflow-hidden rounded-xl border border-orange-500/30 bg-orange-500/[0.08] px-3 py-1.5 font-body text-[11px] font-semibold text-orange-400 backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_12px_-4px_rgba(249,115,22,0.25)] transition-all hover:border-orange-400/60 hover:bg-orange-500/15 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_6px_18px_-4px_rgba(249,115,22,0.45)] active:scale-[0.97]">
                            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent" />
                            <UserX className="relative h-3.5 w-3.5" /> <span className="relative">Falta</span>
                          </button>
                        )}
                        {a.status !== "cancelado" && (
                          <button onClick={() => updateStatus(a.id, "cancelado")}
                            className="group relative flex items-center gap-1.5 overflow-hidden rounded-xl border border-rose/30 bg-rose/[0.08] px-3 py-1.5 font-body text-[11px] font-semibold text-rose backdrop-blur-md shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_4px_12px_-4px_rgba(244,63,94,0.25)] transition-all hover:border-rose/60 hover:bg-rose/15 hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.15),0_6px_18px_-4px_rgba(244,63,94,0.45)] active:scale-[0.97]">
                            <span className="pointer-events-none absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-white/10 to-transparent" />
                            <X className="relative h-3.5 w-3.5" /> <span className="relative">Cancelado</span>
                          </button>
                        )}
                      </div>
                      <div className="flex justify-end gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); abrirEdicaoValores(a); }}
                          className="flex items-center justify-center h-8 w-8 rounded-lg bg-primary-foreground/[0.05] border border-primary-foreground/10 text-primary-foreground/60 hover:bg-blue-500/10 hover:border-blue-500/30 hover:text-blue-400 transition-all"
                          title="Editar Valores"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <BinButton size="sm" onClick={() => deleteAgendamento(a.id)} />
                      </div>

                    </div>
                  </div>
                )}
              </div>
            );
          })}

          <LoadMoreButton
            visibleCount={visibleCount}
            totalCount={filtered.length}
            step={15}
            onLoadMore={() => setVisibleCount((c) => c + 15)}
            itemLabel="pedidos"
          />
        </div>
      )}

      {/* Sheet: Devedores (clientes que devem pagar restante) */}
      <Sheet open={devedoresOpen} onOpenChange={setDevedoresOpen}>
        <SheetContent side="right" className="w-full sm:w-[440px] bg-charcoal border-primary-foreground/[0.06] p-0 flex flex-col">
          <SheetHeader className="px-5 pt-5 pb-4 border-b border-primary-foreground/[0.06]">
            <SheetTitle className="font-heading text-[16px] font-semibold text-primary-foreground flex items-center gap-2">
              <Wallet className="h-4 w-4 text-amber-400" />
              Clientes a receber
            </SheetTitle>
            <div className="flex items-center gap-3 pt-2">
              <div>
                <p className="font-body text-[10px] text-amber-400/70 uppercase tracking-wider">Total</p>
                <p className="font-heading text-[20px] font-bold text-amber-300 leading-tight">{formatCurrency(totalAReceber)}</p>
              </div>
              <div className="ml-auto text-right">
                <p className="font-body text-[10px] text-primary-foreground/75 uppercase tracking-wider">Pedidos</p>
                <p className="font-heading text-[16px] font-semibold text-primary-foreground">{devedores.length}</p>
              </div>
            </div>
          </SheetHeader>
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
            {devedores.length === 0 ? (
              <div className="py-12 text-center">
                <p className="font-body text-[13px] text-primary-foreground/75">🎉 Ninguém devendo no momento</p>
              </div>
            ) : devedores.map((a) => {
              const nome = getClientName(a.user_id, a.cliente_nome);
              const whats = getClienteWhatsapp(a.user_id);
              const restante = Number(a.valor) - Number(a.valor_pago || 0) - Number(a.valor_desconto_credito || 0);
              const sinal = isSinalPago(a);
              const origemLabel = a.origem === "presencial" ? "Presencial" : "App";
              const isExpanded = expandedDevedorId === a.id;
              const tipoAgendamento = a.origem === "presencial" ? "Agendado presencialmente" : "Agendado pelo app";
              return (
                <div key={a.id} className="rounded-xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.03] overflow-hidden">
                  <button
                    type="button"
                    onClick={() => {
                      const next = isExpanded ? null : a.id;
                      setExpandedDevedorId(next);
                      if (next && !historicoMap[a.id]) loadHistorico(a.id);
                    }}
                    className="w-full text-left p-3 space-y-2 hover:bg-primary-foreground/[0.04] transition-colors"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <p className="font-body text-[14px] font-semibold text-primary-foreground truncate">{nome}</p>
                          <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase border-blue-500/30 bg-blue-500/10 text-blue-400">{origemLabel}</span>
                          {a.status === "concluido" ? (
                            <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-pink-500/30 bg-pink-500/10 text-pink-400 px-1.5 py-0.5 text-[9px] font-semibold uppercase">Atendido s/ Pgto</span>
                          ) : (
                            <span className="shrink-0 inline-flex items-center gap-0.5 rounded-full border border-sky-500/30 bg-sky-500/10 text-sky-400 px-1.5 py-0.5 text-[9px] font-semibold uppercase">Agendado</span>
                          )}
                        </div>
                        <p className="font-body text-[11px] text-primary-foreground/85 mt-0.5 truncate">{a.servico}{a.variacao ? ` · ${a.variacao}` : ""}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-body text-[9px] text-amber-400/70 uppercase tracking-wider">A receber</p>
                        <p className="font-heading text-[15px] font-bold text-amber-300 leading-tight">{formatCurrency(restante)}</p>
                        {sinal ? (
                          <span className="inline-flex items-center gap-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-400 mt-0.5">
                            Quitado parcial
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-0.5 rounded-full border border-red-500/30 bg-red-500/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-red-400 mt-0.5">
                            Não pago
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-2 pt-1 text-[10px] font-body text-primary-foreground/75 uppercase tracking-wider">
                      <span>{isExpanded ? "Recolher detalhes" : "Toque para ver detalhes"}</span>
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? "rotate-180" : ""}`} />
                    </div>
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3 pt-1 space-y-3 border-t border-primary-foreground/[0.06]">
                      <div className="space-y-2 pt-2">
                        <div>
                          <p className="text-primary-foreground/75 text-[9px] uppercase tracking-wider font-body">Nome completo</p>
                          <p className="text-primary-foreground/90 font-body text-[13px] font-medium">{nome}</p>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-primary-foreground/75 text-[9px] uppercase tracking-wider font-body">CPF</p>
                            <p className="text-primary-foreground/85 font-body text-[12px] italic">Não cadastrado</p>
                          </div>
                          <div>
                            <p className="text-primary-foreground/75 text-[9px] uppercase tracking-wider font-body">Telefone</p>
                            {whats ? (
                              <a
                                href={`https://wa.me/55${whats.replace(/\D/g, "")}?text=${encodeURIComponent(`Olá ${nome}! Passando para lembrar do valor restante do seu atendimento (${formatCurrency(restante)}). Obrigada!`)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="inline-flex items-center gap-1 font-body text-[12px] text-green-400 hover:text-green-300"
                              >
                                <WhatsAppIcon className="h-3 w-3" /> {formatWhatsapp(whats)}
                              </a>
                            ) : (
                              <p className="text-primary-foreground/85 font-body text-[12px] italic">Não cadastrado</p>
                            )}
                          </div>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <p className="text-primary-foreground/75 text-[9px] uppercase tracking-wider font-body">Gerado em</p>
                            <p className="text-primary-foreground/80 font-body text-[12px]">{new Date(a.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</p>
                          </div>
                          <div>
                            <p className="text-primary-foreground/75 text-[9px] uppercase tracking-wider font-body">Tipo</p>
                            <p className="text-primary-foreground/80 font-body text-[12px]">{tipoAgendamento}</p>
                          </div>
                        </div>
                        <div>
                          <p className="text-primary-foreground/75 text-[9px] uppercase tracking-wider font-body">Serviço</p>
                          <p className="text-primary-foreground/90 font-body text-[13px] font-medium">{a.servico}{a.variacao ? ` · ${a.variacao}` : ""}</p>
                        </div>
                        <div>
                          <p className="text-primary-foreground/75 text-[9px] uppercase tracking-wider font-body">Atendimento</p>
                          <p className="text-primary-foreground/80 font-body text-[12px]">{formatDate(a.data_agendamento)} · {a.horario}</p>
                        </div>
                        <div className="grid grid-cols-3 gap-2 pt-2 border-t border-primary-foreground/[0.06]">
                          <div>
                            <p className="text-primary-foreground/75 text-[9px] uppercase tracking-wider font-body">Total</p>
                            <p className="text-primary-foreground/90 font-body text-[13px] font-semibold">{formatCurrency(Number(a.valor))}</p>
                          </div>
                          <div>
                            <p className="text-primary-foreground/75 text-[9px] uppercase tracking-wider font-body">Pago</p>
                            <p className="text-green-400 font-body text-[13px] font-semibold">{formatCurrency(Number(a.valor_pago || 0))}</p>
                          </div>
                          <div>
                            <p className="text-primary-foreground/75 text-[9px] uppercase tracking-wider font-body">Em aberto</p>
                            <p className="text-amber-300 font-body text-[13px] font-semibold">{formatCurrency(restante)}</p>
                          </div>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <button
                          onClick={(e) => { e.stopPropagation(); abrirRegistroPagamento(a, sinal ? "restante" : "sinal"); }}
                          className="flex items-center justify-center gap-1.5 rounded-lg border border-amber-500/40 bg-amber-500/15 px-2 py-2 font-body text-[12px] font-semibold text-amber-200 hover:bg-amber-500/25 transition-all"
                        >
                          <Wallet className="h-4 w-4" /> {sinal ? "Registrar pagamento" : "Registrar sinal"}
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); abrirAddValor(a); }}
                          className="flex items-center justify-center gap-1.5 rounded-lg border border-blue-500/40 bg-blue-500/15 px-2 py-2 font-body text-[12px] font-semibold text-blue-300 hover:bg-blue-500/25 hover:text-blue-200 transition-all"
                        >
                          <Plus className="h-4 w-4" /> Adicionar valor
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); registrarPagamentoIntegral(a); }}
                          className="col-span-2 flex items-center justify-center gap-1.5 rounded-lg border border-green-500/40 bg-green-500/15 px-2 py-2 font-body text-[12px] font-semibold text-green-300 hover:bg-green-500/25 hover:text-green-200 transition-all"
                        >
                          <CheckCircle className="h-4 w-4" /> Quitar tudo
                        </button>
                      </div>

                      {/* Histórico de pagamentos */}
                      <div className="pt-2 border-t border-primary-foreground/[0.06]">
                        <div className="flex items-center gap-1.5 mb-2">
                          <History className="h-3.5 w-3.5 text-primary-foreground/85" />
                          <p className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/85 font-semibold">Histórico de pagamentos</p>
                        </div>
                        {!historicoMap[a.id] ? (
                          <p className="font-body text-[11px] text-primary-foreground/95">Carregando…</p>
                        ) : historicoMap[a.id].length === 0 ? (
                          <p className="font-body text-[11px] text-primary-foreground/95 italic">Nenhuma alteração registrada ainda.</p>
                        ) : (
                          <ul className="space-y-1.5">
                            {historicoMap[a.id].map((h) => (
                              <li key={h.id} className="rounded-lg border border-primary-foreground/[0.06] bg-primary-foreground/[0.02] px-2.5 py-2">
                                <div className="flex items-center gap-1.5 flex-wrap">
                                  <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${statusColor(h.status_anterior)}`}>{statusLabel(h.status_anterior)}</span>
                                  <span className="text-primary-foreground/95 text-[10px]">→</span>
                                  <span className={`inline-flex items-center rounded-full border px-1.5 py-0.5 text-[9px] font-semibold uppercase ${statusColor(h.status_novo)}`}>{statusLabel(h.status_novo)}</span>
                                  {h.acao === "acrescimo" ? (
                                    <span className="ml-auto font-body text-[11px] font-semibold text-amber-400">Acréscimo +{formatCurrency(h.valor_delta)}</span>
                                  ) : (
                                    <span className="ml-auto font-body text-[11px] font-semibold text-green-400">+{formatCurrency(h.valor_delta)}</span>
                                  )}
                                </div>
                                <div className="flex items-center justify-between gap-2 mt-1 font-body text-[10px] text-primary-foreground/85">
                                  <span>por <span className="text-primary-foreground/80">{h.autor_nome}</span></span>
                                  <span>{new Date(h.created_at).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" })}</span>
                                </div>
                                {h.observacao && h.observacao.trim() && (
                                  <div className="mt-1.5 flex items-start gap-1.5 rounded-lg bg-gold/[0.06] border border-gold/20 px-2 py-1.5">
                                    <span className="text-[11px] shrink-0">📝</span>
                                    <p className="font-body text-[11px] text-primary-foreground/80 leading-snug">{h.observacao}</p>
                                  </div>
                                )}
                              </li>
                            ))}
                          </ul>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </SheetContent>
      </Sheet>

      {/* Modal: Registrar pagamento (sinal ou restante) */}
      <Dialog open={!!pagamentoAg} onOpenChange={(open) => { if (!open) { setPagamentoAg(null); setPagamentoInput(""); setPagamentoForma(""); setPagamentoObs(""); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[360px] mx-auto bg-charcoal border-primary-foreground/[0.08] rounded-2xl p-0 sm:p-0 shadow-2xl overflow-hidden">
          {pagamentoAg && (() => {
            const valorTotal = Number(pagamentoAg.valor);
            const jaPago = Number(pagamentoAg.valor_pago || 0);
            const restante = Math.max(0, valorTotal - jaPago);
            const valorAtual = parseCurrencyStr(pagamentoInput || "0") || 0;
            const novoTotal = Math.min(valorTotal, jaPago + valorAtual);
            const novoRestante = Math.max(0, valorTotal - novoTotal);
            const quitaTudo = novoTotal >= valorTotal;
            const presets = [
              { label: "50% (sinal)", valor: Math.round(valorTotal * 0.5 * 100) / 100 },
              { label: "30%", valor: Math.round(valorTotal * 0.3 * 100) / 100 },
              { label: `Restante (${formatCurrency(restante)})`, valor: restante },
            ];
            const formaOpts = [
              { value: "pix", label: "Pix", emoji: "🔑" },
              { value: "cartao", label: "Cartão", emoji: "💳" },
              { value: "dinheiro", label: "Dinheiro", emoji: "💵" },
            ];
            return (
              <div className="p-4 space-y-3 mx-auto w-full">
                <DialogHeader>
                  <DialogTitle className="font-heading text-[16px] font-semibold text-primary-foreground">Registrar Pagamento</DialogTitle>
                </DialogHeader>
                <div>
                  <p className="font-body text-[11px] text-primary-foreground/70 mt-0.5 truncate">
                    {getClientName(pagamentoAg.user_id, pagamentoAg.cliente_nome)} · {pagamentoAg.servico}
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.03] p-2 text-[10px] font-body">
                  <div>
                    <p className="text-primary-foreground/60 text-[8px] uppercase tracking-wider mb-0.5">Total</p>
                    <p className="text-primary-foreground/90 font-semibold">{formatCurrency(valorTotal)}</p>
                  </div>
                  <div>
                    <p className="text-green-400/70 text-[8px] uppercase tracking-wider mb-0.5">Já pago</p>
                    <p className="text-green-400 font-semibold">{formatCurrency(jaPago)}</p>
                  </div>
                  <div>
                    <p className="text-amber-300/70 text-[8px] uppercase tracking-wider mb-0.5">A receber</p>
                    <p className="text-amber-300 font-semibold">{formatCurrency(restante)}</p>
                  </div>
                </div>

                {/* Forma de pagamento */}
                <div className="space-y-1.5">
                  <label className="font-body text-[10px] font-bold text-gold uppercase tracking-[0.05em]">Forma de pagamento</label>
                  <div className="grid grid-cols-3 gap-2">
                    {formaOpts.map((f) => (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => setPagamentoForma(f.value)}
                        className={`flex flex-col items-center gap-1 rounded-xl border py-2.5 font-body text-[11px] font-semibold transition-all ${
                          pagamentoForma === f.value
                            ? "border-gold bg-gold/15 text-gold shadow-[0_0_8px_hsl(var(--gold)/0.25)]"
                            : "border-primary-foreground/[0.08] bg-primary-foreground/[0.03] text-primary-foreground/70 hover:border-gold/30 hover:bg-gold/[0.05] hover:text-gold/80"
                        }`}
                      >
                        <span className="text-lg">{f.emoji}</span>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="space-y-1.5 pt-1">
                  <label className="font-body text-[10px] font-bold text-gold uppercase tracking-[0.05em] flex items-center gap-1.5">
                    Valor recebido agora
                  </label>
                  <div className="relative group">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-heading text-lg text-primary-foreground/50 group-focus-within:text-gold transition-colors">R$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoFocus
                      placeholder="0,00"
                      value={pagamentoInput}
                      onChange={(e) => setPagamentoInput(e.target.value.replace(/[^\d,.]/g, ""))}
                      className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-primary-foreground/[0.02] border border-primary-foreground/[0.08] text-primary-foreground font-heading text-xl font-bold focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/30 transition-all"
                    />
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {presets.filter((p) => p.valor > 0).map((p) => (
                      <button
                        key={p.label}
                        onClick={() => setPagamentoInput(p.valor.toFixed(2).replace(".", ","))}
                        className="rounded-full border border-gold/20 bg-gold/[0.04] px-2.5 py-1 font-body text-[10px] text-gold/80 hover:bg-gold/15 hover:text-gold transition-all"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.03] p-2.5 space-y-1 text-[11px] font-body mt-1">
                  <div className="flex justify-between items-center">
                    <span className="text-primary-foreground/75">Pago após registro</span>
                    <span className="text-green-400 font-semibold">{formatCurrency(novoTotal)}</span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-primary-foreground/75">Ainda a receber</span>
                    <span className={`font-bold ${novoRestante === 0 ? "text-green-400" : "text-amber-300"}`}>{formatCurrency(novoRestante)}</span>
                  </div>
                  <div className="pt-1.5 mt-1.5 border-t border-primary-foreground/[0.06] flex items-center justify-between">
                    <span className="text-primary-foreground/60 text-[9px] uppercase tracking-wider">Novo status</span>
                    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[9px] font-semibold uppercase ${
                      quitaTudo ? "bg-green-500/15 text-green-400 border border-green-500/30" :
                      novoTotal > 0 ? "bg-amber-500/15 text-amber-400 border border-amber-500/30" :
                      "bg-red-500/15 text-red-400 border border-red-500/30"
                    }`}>
                      {quitaTudo ? "Pago" : novoTotal > 0 ? "Quitado parcial" : "Não pago"}
                    </span>
                  </div>
                </div>

                {/* Observação do pagamento */}
                <div className="space-y-1.5">
                  <label className="font-body text-[10px] font-bold text-gold/80 uppercase tracking-[0.05em] flex items-center gap-1.5">
                    📝 Observação <span className="text-primary-foreground/40 font-normal normal-case tracking-normal">(opcional)</span>
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Ex: Sinal da sessão de tatuagem, cliente pagou via pix pessoal…"
                    value={pagamentoObs}
                    onChange={(e) => setPagamentoObs(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl bg-primary-foreground/[0.02] border border-primary-foreground/[0.08] text-primary-foreground font-body text-[12px] placeholder:text-primary-foreground/30 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/20 transition-all resize-none leading-relaxed"
                  />
                </div>

                <div className="pt-1 flex gap-2">
                  <button onClick={() => { setPagamentoAg(null); setPagamentoInput(""); setPagamentoForma(""); setPagamentoObs(""); }} className="flex-1 py-2.5 rounded-xl bg-primary-foreground/[0.04] text-primary-foreground/80 hover:bg-primary-foreground/[0.08] hover:text-primary-foreground font-heading text-[11px] font-bold uppercase tracking-wider transition-all">Cancelar</button>
                  <button onClick={confirmarRegistroPagamento} disabled={valorAtual <= 0 || !pagamentoForma} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gold text-charcoal font-heading text-[11px] font-bold uppercase tracking-wider hover:bg-gold/90 transition-all shadow-[0_0_10px_hsl(var(--gold)/0.2)] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">Confirmar</button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Modal: Quitar tudo */}
      <Dialog open={!!quitarAg} onOpenChange={(open) => { if (!open) { setQuitarAg(null); setQuitarForma(""); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[340px] mx-auto bg-charcoal border-primary-foreground/[0.08] rounded-2xl p-0 shadow-2xl overflow-hidden">
          {quitarAg && (() => {
            const formaOpts = [
              { value: "pix", label: "Pix", emoji: "🔑" },
              { value: "cartao", label: "Cartão", emoji: "💳" },
              { value: "dinheiro", label: "Dinheiro", emoji: "💵" },
            ];
            return (
              <div className="p-4 space-y-4 mx-auto w-full">
                <DialogHeader>
                  <DialogTitle className="font-heading text-[16px] font-semibold text-primary-foreground flex items-center gap-2">
                    <CheckCircle className="h-4 w-4 text-green-400" /> Quitar Pagamento
                  </DialogTitle>
                </DialogHeader>
                <div>
                  <p className="font-body text-[11px] text-primary-foreground/70 truncate">
                    {getClientName(quitarAg.user_id, quitarAg.cliente_nome)} · {quitarAg.servico}
                  </p>
                  <p className="font-heading text-[15px] font-bold text-green-400 mt-1">
                    Total: {formatCurrency(Number(quitarAg.valor))}
                  </p>
                </div>

                <div className="space-y-2">
                  <label className="font-body text-[10px] font-bold text-gold uppercase tracking-[0.05em]">Forma de pagamento</label>
                  <div className="grid grid-cols-3 gap-2">
                    {formaOpts.map((f) => (
                      <button
                        key={f.value}
                        type="button"
                        onClick={() => setQuitarForma(f.value)}
                        className={`flex flex-col items-center gap-1 rounded-xl border py-2.5 font-body text-[11px] font-semibold transition-all ${
                          quitarForma === f.value
                            ? "border-green-500/60 bg-green-500/15 text-green-300 shadow-[0_0_8px_rgba(34,197,94,0.2)]"
                            : "border-primary-foreground/[0.08] bg-primary-foreground/[0.03] text-primary-foreground/70 hover:border-green-500/30 hover:bg-green-500/[0.05] hover:text-green-400/80"
                        }`}
                      >
                        <span className="text-lg">{f.emoji}</span>
                        {f.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex gap-2 pt-1">
                  <button onClick={() => { setQuitarAg(null); setQuitarForma(""); }} className="flex-1 py-2.5 rounded-xl bg-primary-foreground/[0.04] text-primary-foreground/80 hover:bg-primary-foreground/[0.08] hover:text-primary-foreground font-heading text-[11px] font-bold uppercase tracking-wider transition-all">Cancelar</button>
                  <button onClick={confirmarQuitarTudo} disabled={!quitarForma} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-green-500 text-charcoal font-heading text-[11px] font-bold uppercase tracking-wider hover:bg-green-400 transition-all shadow-[0_0_10px_rgba(34,197,94,0.3)] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">Quitar ✅</button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>

      {/* Modal: Adicionar valor à dívida */}
      <Dialog open={!!addValorAg} onOpenChange={(open) => { if (!open) { setAddValorAg(null); setAddValorInput(""); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] max-w-[calc(100vw-2rem)] sm:max-w-[360px] mx-auto bg-charcoal border-primary-foreground/[0.08] rounded-2xl p-0 sm:p-0 shadow-2xl overflow-hidden">
          {addValorAg && (() => {
            const valorTotalAtual = Number(addValorAg.valor);
            const valorAdicional = parseCurrencyStr(addValorInput || "0") || 0;
            const novoTotal = valorTotalAtual + valorAdicional;
            
            return (
              <div className="p-4 space-y-3 mx-auto w-full min-w-0">
                <DialogHeader>
                  <DialogTitle className="font-heading text-[16px] font-semibold text-primary-foreground">Adicionar Valor Extra</DialogTitle>
                </DialogHeader>
                <div className="min-w-0 w-full overflow-hidden">
                  <p className="font-body text-[11px] text-primary-foreground/70 mt-0.5 truncate w-full">
                    {getClientName(addValorAg.user_id, addValorAg.cliente_nome)} · {addValorAg.servico}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.03] p-2 text-[10px] font-body">
                  <div>
                    <p className="text-primary-foreground/60 text-[8px] uppercase tracking-wider mb-0.5">Valor atual</p>
                    <p className="text-primary-foreground/90 font-semibold">{formatCurrency(valorTotalAtual)}</p>
                  </div>
                  <div>
                    <p className="text-amber-300/70 text-[8px] uppercase tracking-wider mb-0.5">Novo total</p>
                    <p className="text-amber-300 font-semibold">{formatCurrency(novoTotal)}</p>
                  </div>
                </div>

                <div className="space-y-1.5 pt-1">
                  <label className="font-body text-[10px] font-bold text-gold uppercase tracking-[0.05em] flex items-center gap-1.5">
                    Valor adicional
                  </label>
                  <div className="relative group">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-heading text-lg text-primary-foreground/50 group-focus-within:text-gold transition-colors">R$</span>
                    <input
                      type="text"
                      inputMode="decimal"
                      autoFocus
                      placeholder="0,00"
                      value={addValorInput}
                      onChange={(e) => setAddValorInput(e.target.value.replace(/[^\d,.]/g, ""))}
                      className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-primary-foreground/[0.02] border border-primary-foreground/[0.08] text-primary-foreground font-heading text-xl font-bold focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/30 transition-all"
                    />
                  </div>
                </div>

                <div className="pt-2 flex gap-2">
                  <button onClick={() => { setAddValorAg(null); setAddValorInput(""); }} className="flex-1 py-2.5 rounded-xl bg-primary-foreground/[0.04] text-primary-foreground/80 hover:bg-primary-foreground/[0.08] hover:text-primary-foreground font-heading text-[11px] font-bold uppercase tracking-wider transition-all">Cancelar</button>
                  <button onClick={confirmarAddValor} disabled={valorAdicional <= 0} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gold text-charcoal font-heading text-[11px] font-bold uppercase tracking-wider hover:bg-gold/90 transition-all shadow-[0_0_10px_hsl(var(--gold)/0.2)] disabled:opacity-40 disabled:cursor-not-allowed disabled:shadow-none">Confirmar</button>
                </div>
              </div>
            );
          })()}
        </DialogContent>
      </Dialog>
      {/* Dialog: Editar Valores */}
      <Dialog open={!!editAg} onOpenChange={(open) => !open && setEditAg(null)}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-sm rounded-2xl border-primary-foreground/[0.08] bg-charcoal p-5 shadow-2xl">
          <DialogHeader className="mb-4">
            <DialogTitle className="font-heading text-lg font-semibold text-primary-foreground">
              Editar Valores
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="font-body text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/75 mb-1.5 block">Valor Total (R$)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-body text-[14px] text-primary-foreground/40">R$</span>
                <input
                  type="text"
                  placeholder="0,00"
                  value={editValorInput}
                  onChange={(e) => setEditValorInput(e.target.value.replace(/[^\d,.]/g, ""))}
                  className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-primary-foreground/[0.02] border border-primary-foreground/[0.08] text-primary-foreground font-heading text-xl font-bold focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/30 transition-all"
                />
              </div>
            </div>
            <div>
              <label className="font-body text-[11px] font-semibold uppercase tracking-wider text-primary-foreground/75 mb-1.5 block">Valor Pago (R$)</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 font-body text-[14px] text-primary-foreground/40">R$</span>
                <input
                  type="text"
                  placeholder="0,00"
                  value={editValorPagoInput}
                  onChange={(e) => setEditValorPagoInput(e.target.value.replace(/[^\d,.]/g, ""))}
                  className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-primary-foreground/[0.02] border border-primary-foreground/[0.08] text-primary-foreground font-heading text-xl font-bold focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/30 transition-all"
                />
              </div>
            </div>
            <div className="pt-2 flex gap-2">
              <button onClick={() => setEditAg(null)} className="flex-1 py-2.5 rounded-xl bg-primary-foreground/[0.04] text-primary-foreground/80 hover:bg-primary-foreground/[0.08] hover:text-primary-foreground font-heading text-[11px] font-bold uppercase tracking-wider transition-all">Cancelar</button>
              <button onClick={confirmarEdicaoValores} disabled={savingEdit} className="flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-gold text-charcoal font-heading text-[11px] font-bold uppercase tracking-wider hover:bg-gold/90 transition-all shadow-[0_0_10px_hsl(var(--gold)/0.2)] disabled:opacity-40">Salvar</button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Observação do Pedido */}
      <Dialog open={!!obsModalAg} onOpenChange={(open) => { if (!open) { setObsModalAg(null); setObsModalText(""); } }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[400px] mx-auto bg-charcoal border-primary-foreground/[0.08] rounded-2xl p-0 shadow-2xl overflow-hidden">
          {obsModalAg && (
            <div className="p-5 space-y-4">
              <DialogHeader>
                <DialogTitle className="font-heading text-[16px] font-semibold text-primary-foreground flex items-center gap-2">
                  📝 Observação do Pedido
                </DialogTitle>
              </DialogHeader>
              <p className="font-body text-[11px] text-primary-foreground/60 -mt-2 truncate">
                {getClientName(obsModalAg.user_id, obsModalAg.cliente_nome)} · {obsModalAg.servico}
              </p>
              <div className="space-y-1.5">
                <label className="font-body text-[10px] font-bold text-gold/80 uppercase tracking-[0.05em]">Nota interna <span className="text-primary-foreground/40 font-normal normal-case tracking-normal">(visível apenas para o estúdio)</span></label>
                <textarea
                  rows={4}
                  autoFocus
                  placeholder="Ex: cliente prefere sessões após as 14h, tem alergia a tinta X, sinal pago por transferência…"
                  value={obsModalText}
                  onChange={(e) => setObsModalText(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl bg-primary-foreground/[0.03] border border-primary-foreground/[0.08] text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/25 focus:outline-none focus:border-gold/50 focus:ring-1 focus:ring-gold/20 transition-all resize-none leading-relaxed"
                />
                {obsModalText.trim() && (
                  <button
                    onClick={() => setObsModalText("")}
                    className="font-body text-[10px] text-red-400/70 hover:text-red-400 transition-colors"
                  >
                    ✕ Limpar observação
                  </button>
                )}
              </div>
              <div className="flex gap-2 pt-1">
                <button
                  onClick={() => { setObsModalAg(null); setObsModalText(""); }}
                  className="flex-1 py-2.5 rounded-xl bg-primary-foreground/[0.04] text-primary-foreground/80 hover:bg-primary-foreground/[0.08] font-heading text-[11px] font-bold uppercase tracking-wider transition-all"
                >
                  Cancelar
                </button>
                <button
                  onClick={salvarObservacaoPedido}
                  disabled={savingObs}
                  className="flex-1 py-2.5 rounded-xl bg-gold text-charcoal font-heading text-[11px] font-bold uppercase tracking-wider hover:bg-gold/90 transition-all shadow-[0_0_10px_hsl(var(--gold)/0.2)] disabled:opacity-40"
                >
                  {savingObs ? "Salvando…" : "Salvar"}
                </button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <ClienteFichaModal
        open={!!fichaTarget}
        onOpenChange={(open) => {
          if (!open) setFichaTarget(null);
        }}
        cliente={activeFichaData?.cliente || null}
        fallbackName={activeFichaData?.nome}
        clienteAgendamentos={activeFichaData?.ags || []}
        setClientes={setClientes}
        onReload={onUpdate}
        onBookClient={onBookClient}
      />
    </div>
  );
};

export default PedidosTab;
