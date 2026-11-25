import { useState, useMemo, useEffect } from "react";
import {
  Calendar,
  Wallet,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Clock,
  Pencil,
  Check,
  X,
  Plus,
  Minus,
  FileText,
  CreditCard,
  Banknote,
  Table2,
  Search,
  BarChart3,
  ArrowDownLeft,
  ArrowUpRight,
  Sparkles,
  Settings,
} from "lucide-react";
import {
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import pixIcon from "@/assets/pix-icon.png";
import { toast } from "sonner";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarPicker } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ptBR } from "date-fns/locale";
import NovaTransacaoModal from "@/components/NovaTransacaoModal";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import {
  parseCurrencyStr,
  formatCurrencyMask,
  formatCurrencyValue,
} from "@/lib/utils";
import {
  calculateDailyClosing,
  calculateCommission,
  CommissionHistoryEntry,
  getCommissionHistory,
  saveNewCommissionRate,
  CaixaMovimentacao,
  isLancamentoOperacional,
  normalizePaymentMethod,
  classifyInstallmentMovement,
  getLocalCaixaMovimentacoes,
  CAIXA_UPDATED_EVENT,
} from "@/lib/caixa";

interface Agendamento {
  id: string;
  servico: string;
  variacao: string | null;
  data_agendamento: string;
  horario: string;
  valor: number;
  valor_pago: number | null;
  valor_troco: number | null;
  valor_gorjeta: number | null;
  valor_credito: number | null;
  valor_desconto_credito?: number | null;
  status: string;
  created_at: string;
  user_id: string;
  cliente_nome: string | null;
  observacao?: string | null;
  forma_pagamento?: string | null;
}

interface DespesaRow {
  id?: string;
  valor: number;
  pago: boolean;
  data_vencimento: string;
  data_pagamento?: string | null;
  tipo?: string;
  observacao?: string;
  descricao?: string;
  categoria?: string;
}

interface Props {
  agendamentos: Agendamento[];
  getClientName: (userId: string, clienteNome?: string | null) => string;
  onUpdate?: () => void;
}

type ViewTab = "extrato" | "dia" | "resumo";
type ExtratoFilter = "tudo" | "entradas" | "saidas";
type PeriodFilter = "hoje" | "semana" | "mes";

const SERVICE_COLORS = [
  "hsl(22 58% 63%)",
  "hsl(340 40% 56%)",
  "hsl(142 71% 45%)",
  "hsl(217 91% 60%)",
  "hsl(38 85% 58%)",
  "hsl(270 60% 60%)",
];

const formatCurrency = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatDateShort = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

const toLocalISO = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

const getExpDate = (d: { data_pagamento?: string | null; data_vencimento: string }) =>
  d.data_pagamento || d.data_vencimento;

const CaixaTab = ({ agendamentos, getClientName, onUpdate }: Props) => {
  const [modalConfig, setModalConfig] = useState<{ open: boolean; tab: "entrada" | "saida" }>({
    open: false,
    tab: "entrada",
  });
  const [viewTab, setViewTab] = useState<ViewTab>("extrato");
  const [extratoFilter, setExtratoFilter] = useState<ExtratoFilter>("tudo");
  const [period, setPeriod] = useState<PeriodFilter>("mes");
  const [visibleExtratoCount, setVisibleExtratoCount] = useState(15);
  const [serviceSearch, setServiceSearch] = useState("");
  const [monthOffset, setMonthOffset] = useState(0);
  const [caixaDate, setCaixaDate] = useState(() => toLocalISO(new Date()));
  const [histByAgId, setHistByAgId] = useState<
    Record<
      string,
      Array<{
        id: string;
        valor_delta: number;
        valor_novo: number;
        total: number;
        observacao?: string | null;
        created_at: string;
        parcelaNumero: number;
      }>
    >
  >({});

  useEffect(() => {
    setVisibleExtratoCount(15);
  }, [extratoFilter, period, monthOffset]);

  // Configurações do Caixa: dia de fechamento e % de comissão
  const [diaFechamento, setDiaFechamento] = useState<number>(() => {
    try {
      const saved = Number(localStorage.getItem("studio_caixa_dia_fechamento"));
      return saved >= 1 && saved <= 28 ? saved : 1;
    } catch {
      return 1;
    }
  });
  const [comissaoPct, setComissaoPct] = useState<number>(() => {
    try {
      const raw = localStorage.getItem("studio_comissao_pct");
      if (raw !== null) {
        const val = Number(raw);
        if (Number.isFinite(val) && val >= 0 && val <= 100) return val;
      }
    } catch {
      /* ignore */
    }
    return 40;
  });
  const [commissionHistory, setCommissionHistory] = useState<CommissionHistoryEntry[]>(() =>
    getCommissionHistory(comissaoPct)
  );
  const [configOpen, setConfigOpen] = useState(false);
  const [tempDiaFechamento, setTempDiaFechamento] = useState("1");
  const [tempComissaoPct, setTempComissaoPct] = useState("40");
  const [comissaoEscopo, setComissaoEscopo] = useState<"ciclo" | "hoje">("ciclo");

  // Modal de retirada de comissão
  const [retiradaOpen, setRetiradaOpen] = useState(false);
  const [retiradaValor, setRetiradaValor] = useState("");
  const [retiradaDesc, setRetiradaDesc] = useState("Retirada de Comissão");
  const [retiradaData, setRetiradaData] = useState(() => toLocalISO(new Date()));
  const [retiradaSaving, setRetiradaSaving] = useState(false);

  // Saldo ajustado manualmente pela dona (contagem física)
  const [saldoFisicoManual, setSaldoFisicoManual] = useState<number | null>(null);
  const [editingSaldo, setEditingSaldo] = useState(false);
  const [tempSaldo, setTempSaldo] = useState("");
  const [savingSaldo, setSavingSaldo] = useState(false);
  const [showPaymentMethodModal, setShowPaymentMethodModal] = useState(false);

  const [despesas, setDespesas] = useState<DespesaRow[]>([]);
  const [movimentacoes, setMovimentacoes] = useState<CaixaMovimentacao[]>([]);
  const [missingAgendamentos, setMissingAgendamentos] = useState<any[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);

  const calcCycleForOffset = (closingDay: number, offset: number) => {
    const now = new Date();
    let startYear = now.getFullYear();
    let startMonth = now.getMonth();
    if (closingDay > 1 && now.getDate() < closingDay) {
      startMonth -= 1;
    }
    const start = new Date(startYear, startMonth + offset, closingDay, 12, 0, 0);
    const end =
      closingDay === 1
        ? new Date(start.getFullYear(), start.getMonth() + 1, 0, 12, 0, 0)
        : new Date(start.getFullYear(), start.getMonth() + 1, closingDay - 1, 12, 0, 0);

    const monthTitle = start.toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
    const rangeLabel = `${formatDateShort(toLocalISO(start))} → ${formatDateShort(toLocalISO(end))}`;
    return {
      startISO: toLocalISO(start),
      endISO: toLocalISO(end),
      startDate: start,
      endDate: end,
      label: closingDay === 1 ? monthTitle.charAt(0).toUpperCase() + monthTitle.slice(1) : rangeLabel,
      rangeLabel,
    };
  };

  // Ciclo selecionado conforme o dia de fechamento configurado
  const mesSelecionado = useMemo(
    () => calcCycleForOffset(diaFechamento, monthOffset),
    [diaFechamento, monthOffset]
  );

  const openConfigModal = () => {
    setTempDiaFechamento(String(diaFechamento));
    setTempComissaoPct(String(comissaoPct));
    setComissaoEscopo("ciclo");
    setConfigOpen(true);
  };

  const handleSaveConfig = () => {
    const parsedDay = Math.max(1, Math.min(28, parseInt(tempDiaFechamento, 10) || 1));
    const parsedRate = Math.max(0, Math.min(100, Number(String(tempComissaoPct).replace(",", ".")) || 0));

    try {
      localStorage.setItem("studio_caixa_dia_fechamento", String(parsedDay));
    } catch {
      /* ignore */
    }
    setDiaFechamento(parsedDay);

    const effectiveDate = comissaoEscopo === "hoje" ? toLocalISO(new Date()) : calcCycleForOffset(parsedDay, monthOffset).startISO;
    const updatedHistory = saveNewCommissionRate(parsedRate, effectiveDate, commissionHistory);
    setComissaoPct(parsedRate);
    setCommissionHistory(updatedHistory);

    setConfigOpen(false);
    toast.success(`Configurações salvas · Fechamento dia ${parsedDay} · Comissão ${parsedRate}%`);
  };

  // Carrega ajuste manual de saldo físico se existir
  useEffect(() => {
    const key = `${mesSelecionado.startISO}_${mesSelecionado.endISO}`;
    let cancelled = false;
    (supabase.from as any)("caixa_config")
      .select("saldo_fisico_manual")
      .eq("id", key)
      .maybeSingle()
      .then(({ data }: any) => {
        if (!cancelled) {
          setSaldoFisicoManual(data?.saldo_fisico_manual != null ? Number(data.saldo_fisico_manual) : null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [mesSelecionado.startISO, mesSelecionado.endISO]);

  const handleSaveSaldo = async () => {
    const val = parseCurrencyStr(tempSaldo);
    if (isNaN(val) || val < 0) return toast.error("Informe um valor válido");
    setSavingSaldo(true);
    try {
      const key = `${mesSelecionado.startISO}_${mesSelecionado.endISO}`;
      const { error } = await (supabase.from as any)("caixa_config").upsert(
        { id: key, saldo_fisico_manual: val, updated_at: new Date().toISOString() },
        { onConflict: "id" }
      );
      if (error) throw new Error(error.message || "Erro ao salvar");
      setSaldoFisicoManual(val);
      setEditingSaldo(false);
      toast.success("Saldo em caixa ajustado!");
    } catch (e: any) {
      toast.error("Erro ao salvar: " + (e.message || "Tente novamente"));
    } finally {
      setSavingSaldo(false);
    }
  };

  // Busca despesas do mês/ciclo selecionado
  useEffect(() => {
    let cancelled = false;
    if (!isSupabaseConfigured) {
      try {
        const raw = localStorage.getItem("studio_caixa_retiradas_preview");
        const localRows: DespesaRow[] = raw ? JSON.parse(raw) : [];
        if (!cancelled) setDespesas(Array.isArray(localRows) ? localRows : []);
      } catch {
        if (!cancelled) setDespesas([]);
      }
      return;
    }

    (supabase.from as any)("despesas")
      .select("id,valor,pago,data_vencimento,data_pagamento,tipo,observacao,descricao,categoria")
      .or(
        `and(data_vencimento.gte.${mesSelecionado.startISO},data_vencimento.lte.${mesSelecionado.endISO}),and(data_pagamento.gte.${mesSelecionado.startISO},data_pagamento.lte.${mesSelecionado.endISO})`
      )
      .limit(2000)
      .then(({ data }: any) => {
        if (!cancelled && data) setDespesas(data);
      });
    return () => {
      cancelled = true;
    };
  }, [mesSelecionado.startISO, mesSelecionado.endISO, refreshTick]);

  // Busca movimentos financeiros do mês (e da data selecionada no Resumo do Dia)
  useEffect(() => {
    let cancelled = false;
    const rangeStart = caixaDate < mesSelecionado.startISO ? caixaDate : mesSelecionado.startISO;
    const rangeEnd = caixaDate > mesSelecionado.endISO ? caixaDate : mesSelecionado.endISO;

    if (!isSupabaseConfigured) {
      const localMovs = getLocalCaixaMovimentacoes()
        .filter((m) => m.data_pagamento >= rangeStart && m.data_pagamento <= rangeEnd)
        .map((m) => ({ ...m, valor: Number(m.valor) }))
        .sort((a, b) => (b.ocorrido_em || "").localeCompare(a.ocorrido_em || ""));
      if (!cancelled) setMovimentacoes(localMovs);
      return () => {
        cancelled = true;
      };
    }

    (supabase.from as any)("caixa_movimentacoes")
      .select("*")
      .gte("data_pagamento", rangeStart)
      .lte("data_pagamento", rangeEnd)
      .order("ocorrido_em", { ascending: false })
      .then(({ data, error }: any) => {
        if (cancelled) return;
        if (error) {
          console.error("Erro ao carregar movimentos do caixa:", error);
          setMovimentacoes([]);
          return;
        }
        setMovimentacoes((data || []).map((m: any) => ({ ...m, valor: Number(m.valor) })));
      });

    return () => {
      cancelled = true;
    };
  }, [mesSelecionado.startISO, mesSelecionado.endISO, caixaDate, refreshTick]);

  // Realtime e eventos locais: sincroniza pagamentos, parcelas e gastos automaticamente
  useEffect(() => {
    const handleLocalUpdate = () => setRefreshTick((t) => t + 1);
    window.addEventListener(CAIXA_UPDATED_EVENT, handleLocalUpdate);

    if (!isSupabaseConfigured) {
      return () => {
        window.removeEventListener(CAIXA_UPDATED_EVENT, handleLocalUpdate);
      };
    }

    const channel = supabase
      .channel("caixa-movimentos-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "caixa_movimentacoes" }, () => {
        setRefreshTick((t) => t + 1);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "despesas" }, () => {
        setRefreshTick((t) => t + 1);
      })
      .subscribe();
    return () => {
      window.removeEventListener(CAIXA_UPDATED_EVENT, handleLocalUpdate);
      supabase.removeChannel(channel);
    };
  }, []);

  // Agendamentos vinculados e histórico de parcelas dos movimentos do período
  useEffect(() => {
    if (movimentacoes.length === 0) {
      setMissingAgendamentos([]);
      setHistByAgId({});
      return;
    }
    const movimentoIds = new Set(
      movimentacoes.filter((m) => m.referencia_tipo === "agendamento").map((m) => m.referencia_id)
    );
    const existingIds = new Set(agendamentos.map((a) => a.id));
    const missingIds = [...movimentoIds].filter((id) => !existingIds.has(id));
    if (missingIds.length === 0) {
      setMissingAgendamentos([]);
    } else if (isSupabaseConfigured) {
      supabase
        .from("agendamentos")
        .select("*")
        .in("id", missingIds.slice(0, 200))
        .then(({ data }) => {
          if (data) setMissingAgendamentos(data);
        });
    }

    const allMovAgIds = [...movimentoIds].slice(0, 200);
    if (!isSupabaseConfigured || allMovAgIds.length === 0) {
      setHistByAgId({});
      return;
    }

    let cancelled = false;
    supabase
      .from("pagamento_historico")
      .select("id,agendamento_id,valor_delta,valor_novo,total,acao,observacao,created_at")
      .in("agendamento_id", allMovAgIds)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (cancelled || !data) return;
        const grouped: Record<string, any[]> = {};
        for (const h of data as any[]) {
          if (h.acao === "acrescimo" || Number(h.valor_delta || 0) <= 0) continue;
          const list = grouped[h.agendamento_id] || [];
          list.push({
            id: h.id,
            valor_delta: Number(h.valor_delta || 0),
            valor_novo: Number(h.valor_novo || 0),
            total: Number(h.total || 0),
            observacao: h.observacao || "",
            created_at: h.created_at,
            parcelaNumero: list.length + 1,
          });
          grouped[h.agendamento_id] = list;
        }
        setHistByAgId(grouped);
      });

    return () => {
      cancelled = true;
    };
  }, [movimentacoes, agendamentos]);

  const allAgendamentos = useMemo(
    () => [...agendamentos, ...missingAgendamentos],
    [agendamentos, missingAgendamentos]
  );

  // Entradas do mês (com identificação de parcelas / quitações de pendências)
  const entradasMes = useMemo(() => {
    const byId = new Map(allAgendamentos.map((a) => [a.id, a]));
    return movimentacoes
      .filter((m) => m.data_pagamento >= mesSelecionado.startISO && m.data_pagamento <= mesSelecionado.endISO)
      .map((m) => {
        const linked = byId.get(m.referencia_id);
        const histList = histByAgId[m.referencia_id] || [];
        let matchedHist: (typeof histList)[number] | null = null;
        if (histList.length > 0 && Number(m.valor) > 0) {
          const movTime = new Date(m.ocorrido_em).getTime();
          matchedHist =
            histList.find(
              (h) =>
                Math.abs(h.valor_delta - Number(m.valor)) < 0.05 &&
                Math.abs(new Date(h.created_at).getTime() - movTime) < 120_000
            ) ||
            histList.find((h) => Math.abs(h.valor_delta - Number(m.valor)) < 0.05) ||
            null;
        }

        const parcelaInfo = classifyInstallmentMovement(m, linked, matchedHist);

        return {
          ...(linked || {}),
          id: linked?.id || m.referencia_id,
          _movimentoId: m.id,
          _is_gasto: false as const,
          _parcelaInfo: parcelaInfo,
          valor: Number(m.valor_total_servico || linked?.valor || Math.abs(m.valor)),
          valor_pago: Number(m.valor),
          data_agendamento: m.data_atendimento || linked?.data_agendamento || m.data_pagamento,
          data_fatura: m.data_pagamento,
          forma_pagamento: m.forma_pagamento || linked?.forma_pagamento,
          cliente_nome: m.cliente_nome || linked?.cliente_nome,
          servico: m.tipo === "gorjeta" ? "Gorjeta" : m.descricao || linked?.servico || "Pagamento",
          user_id: linked?.user_id || "admin",
          inferido: m.inferido,
        };
      });
  }, [allAgendamentos, movimentacoes, histByAgId, mesSelecionado.startISO, mesSelecionado.endISO]);

  // Números principais do mês (linguagem simples para a dona)
  const resumoMes = useMemo(() => {
    const agsMes = allAgendamentos.filter(
      (a) =>
        a.status !== "cancelado" &&
        a.status !== "falta" &&
        a.data_agendamento >= mesSelecionado.startISO &&
        a.data_agendamento <= mesSelecionado.endISO
    );

    const entrou = entradasMes.reduce((s, f) => s + Number(f.valor_pago || 0), 0);
    const faltaReceber = agsMes
      .filter((a) => isLancamentoOperacional(a.servico))
      .reduce((s, a) => {
        const devido = Math.max(0, Number(a.valor) - Number(a.valor_desconto_credito || 0));
        return s + Math.max(0, devido - Number(a.valor_pago || 0));
      }, 0);

    const gastosEstudio = despesas
      .filter(
        (d) =>
          (d.tipo || "estudio") === "estudio" &&
          d.pago &&
          getExpDate(d) >= mesSelecionado.startISO &&
          getExpDate(d) <= mesSelecionado.endISO
      )
      .reduce((s, d) => s + Number(d.valor), 0);

    const gastosPessoaisPuros = despesas
      .filter(
        (d) =>
          d.tipo === "pessoal" &&
          d.pago &&
          getExpDate(d) >= mesSelecionado.startISO &&
          getExpDate(d) <= mesSelecionado.endISO
      )
      .reduce((s, d) => s + Number(d.valor), 0);

    const comissaoRetirada = despesas
      .filter(
        (d) =>
          d.tipo === "comissao" &&
          d.pago &&
          getExpDate(d) >= mesSelecionado.startISO &&
          getExpDate(d) <= mesSelecionado.endISO
      )
      .reduce((s, d) => s + Number(d.valor), 0);

    const gastosPessoais = gastosPessoaisPuros + comissaoRetirada;

    const movsCiclo = movimentacoes.filter(
      (m) => m.data_pagamento >= mesSelecionado.startISO && m.data_pagamento <= mesSelecionado.endISO
    );
    const comissao = calculateCommission(movsCiclo, comissaoPct, commissionHistory);

    const totalGastos = gastosEstudio + gastosPessoais;
    const sobraEstudio = entrou - gastosEstudio;
    const sobraAposComissao = sobraEstudio - comissao.total;
    const comissaoDisponivel = Math.max(0, comissao.total - comissaoRetirada);
    const saldoCaixa = entrou - totalGastos;
    const qtdAtendimentos = agsMes.filter((a) => a.servico !== "Adição de Crédito").length;

    return {
      entrou,
      faltaReceber,
      gastosEstudio,
      gastosPessoais,
      totalGastos,
      sobraEstudio,
      comissaoTotal: comissao.total,
      comissaoRetirada,
      comissaoDisponivel,
      sobraAposComissao,
      saldoCaixa,
      qtdAtendimentos,
    };
  }, [allAgendamentos, entradasMes, despesas, movimentacoes, mesSelecionado.startISO, mesSelecionado.endISO, comissaoPct, commissionHistory]);

  // Formas de pagamento no mês
  const paymentMethodStats = useMemo(() => {
    const totals: Record<string, number> = { pix: 0, cartao: 0, dinheiro: 0, outro: 0 };
    const counts: Record<string, number> = { pix: 0, cartao: 0, dinheiro: 0, outro: 0 };
    const items: Record<string, any[]> = { pix: [], cartao: [], dinheiro: [], outro: [] };

    entradasMes.forEach((a) => {
      const pago = Number(a.valor_pago || 0);
      if (pago === 0) return;

      if (a.forma_pagamento && a.forma_pagamento.includes("|")) {
        const parsed = a.forma_pagamento
          .split("|")
          .map((part: string) => {
            const [method, valStr] = part.split(":");
            return { method, value: Number(valStr || 0) };
          })
          .filter((part: any) => part.value > 0);
        const partTotal = parsed.reduce((sum: number, part: any) => sum + part.value, 0);
        if (Math.abs(partTotal - Math.abs(pago)) < 0.01) {
          parsed.forEach(({ method, value }: any) => {
            const key = normalizePaymentMethod(method);
            const signedValue = pago < 0 ? -value : value;
            totals[key] += signedValue;
            if (pago > 0) counts[key] += 1;
            items[key].push({ ...a, valor_pago: signedValue });
          });
          return;
        }
      }

      const key = normalizePaymentMethod(a.forma_pagamento);
      totals[key] += pago;
      if (pago > 0) counts[key] += 1;
      items[key].push(a);
    });

    const grandTotal = totals.pix + totals.cartao + totals.dinheiro + totals.outro;
    return { totals, counts, items, grandTotal };
  }, [entradasMes]);

  // Faixa do filtro (Hoje / Semana / Mês)
  const periodRange = useMemo(() => {
    const now = new Date();
    const todayISO = toLocalISO(now);
    if (period === "hoje") return { start: todayISO, end: todayISO };
    if (period === "semana") {
      const wa = new Date(now);
      wa.setDate(wa.getDate() - 6);
      return { start: toLocalISO(wa), end: todayISO };
    }
    return { start: mesSelecionado.startISO, end: mesSelecionado.endISO };
  }, [period, mesSelecionado]);

  // Extrato unificado (Entradas + Saídas)
  const extratoLista = useMemo(() => {
    const entradas = entradasMes
      .filter((f) => f.data_fatura >= periodRange.start && f.data_fatura <= periodRange.end)
      .map((f) => ({
        ...f,
        _is_gasto: false as const,
        _gasto_escopo: "",
      }));

    const saidas = despesas
      .filter((d) => {
        const dt = getExpDate(d);
        return d.pago && dt >= periodRange.start && dt <= periodRange.end;
      })
      .map((d, idx) => {
        const dt = getExpDate(d);
        const escopo =
          d.tipo === "comissao" ? "Comissão" : d.tipo === "pessoal" ? "Pessoal" : "Estúdio";
        return {
          id: d.id || `gasto-${idx}`,
          _movimentoId: `gasto-${d.id || idx}-${dt}`,
          _is_gasto: true as const,
          _gasto_escopo: escopo,
          user_id: "admin",
          cliente_nome: d.descricao || d.categoria || "Gasto",
          servico: `${d.categoria || "Gasto"} · ${escopo}`,
          data_fatura: dt,
          valor_pago: -Math.abs(Number(d.valor || 0)),
          forma_pagamento: "",
          inferido: false,
        };
      });

    let all = [...entradas, ...saidas];
    if (extratoFilter === "entradas") all = entradas;
    else if (extratoFilter === "saidas") all = saidas;

    return all.sort((a, b) => b.data_fatura.localeCompare(a.data_fatura));
  }, [entradasMes, despesas, periodRange, extratoFilter]);

  // Fechamento diário (aba Dia a Dia)
  const caixaDia = useMemo(
    () => calculateDailyClosing(allAgendamentos, movimentacoes, caixaDate),
    [allAgendamentos, movimentacoes, caixaDate]
  );

  // Dados para gráfico (Entrou x Saiu por dia) e Ranking de Serviços
  const mesAppointments = useMemo(
    () =>
      allAgendamentos.filter(
        (a) =>
          a.status !== "cancelado" &&
          a.status !== "falta" &&
          a.data_agendamento >= mesSelecionado.startISO &&
          a.data_agendamento <= mesSelecionado.endISO
      ),
    [allAgendamentos, mesSelecionado]
  );

  const dailyChartData = useMemo(() => {
    const map: Record<string, { dia: string; entradas: number; gastos: number }> = {};
    entradasMes.forEach((f) => {
      const d = f.data_fatura;
      if (!map[d]) map[d] = { dia: d, entradas: 0, gastos: 0 };
      map[d].entradas += Number(f.valor_pago || 0);
    });
    despesas.forEach((d) => {
      if (!d.pago) return;
      const dt = getExpDate(d);
      if (dt < mesSelecionado.startISO || dt > mesSelecionado.endISO) return;
      if (!map[dt]) map[dt] = { dia: dt, entradas: 0, gastos: 0 };
      map[dt].gastos += Number(d.valor || 0);
    });
    return Object.values(map)
      .sort((a, b) => a.dia.localeCompare(b.dia))
      .map((d) => ({ ...d, diaLabel: formatDateShort(d.dia) }));
  }, [entradasMes, despesas, mesSelecionado]);

  const paymentStatusChart = useMemo(() => {
    let pago = 0;
    let sinal = 0;
    let pendente = 0;
    mesAppointments.forEach((a) => {
      if (!isLancamentoOperacional(a.servico)) return;
      const vPago = Number(a.valor_pago || 0) + Number(a.valor_desconto_credito || 0);
      const vTotal = Number(a.valor);
      if (vPago >= vTotal) pago++;
      else if (vPago > 0) sinal++;
      else pendente++;
    });
    return [
      { name: "Pago", value: pago, color: "hsl(142 71% 45%)" },
      { name: "Sinal", value: sinal, color: "hsl(22 58% 63%)" },
      { name: "Pendente", value: pendente, color: "hsl(0 0% 45%)" },
    ].filter((d) => d.value > 0);
  }, [mesAppointments]);

  const serviceRankingData = useMemo(() => {
    const map: Record<string, { count: number; total: number }> = {};
    mesAppointments
      .filter((a) => a.servico && isLancamentoOperacional(a.servico))
      .forEach((a) => {
        if (!map[a.servico]) map[a.servico] = { count: 0, total: 0 };
        map[a.servico].count += 1;
        map[a.servico].total += Number(a.valor);
      });
    let entries = Object.entries(map)
      .map(([name, d]) => ({ name, count: d.count, total: d.total }))
      .sort((a, b) => b.total - a.total);
    if (serviceSearch.trim()) {
      const q = serviceSearch.toLowerCase();
      entries = entries.filter((e) => e.name.toLowerCase().includes(q));
    }
    return entries;
  }, [mesAppointments, serviceSearch]);

  const exportCSV = () => {
    const header = "Data,Tipo,Descrição,Valor\n";
    const rows = extratoLista
      .map((item: any) => {
        const tipo = item._is_gasto ? `Saída (${item._gasto_escopo})` : "Entrada";
        const nome = item._is_gasto ? item.cliente_nome : `${getClientName(item.user_id, item.cliente_nome)} - ${item.servico}`;
        return `${item.data_fatura},"${tipo}","${nome}",${Number(item.valor_pago).toFixed(2)}`;
      })
      .join("\n");
    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `caixa_${mesSelecionado.startISO}_a_${mesSelecionado.endISO}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const exportPDF = () => {
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Caixa - ${mesSelecionado.label}</title>
    <style>
      body { font-family: Arial, sans-serif; padding: 32px; color: #1c1c1c; }
      h1 { font-size: 20px; margin-bottom: 4px; }
      .sub { color: #666; font-size: 12px; margin-bottom: 20px; }
      .metrics { display: flex; gap: 12px; margin-bottom: 20px; flex-wrap: wrap; }
      .metric { background: #f5f5f5; padding: 12px 16px; border-radius: 10px; min-width: 140px; }
      .lbl { font-size: 10px; color: #777; text-transform: uppercase; }
      .val { font-size: 18px; font-weight: 700; margin-top: 4px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; }
      th { text-align: left; padding: 8px; border-bottom: 2px solid #ddd; font-size: 10px; text-transform: uppercase; color: #666; }
      td { padding: 8px; border-bottom: 1px solid #eee; }
    </style></head><body>
    <h1>Caixa · Fernanda Hahn</h1>
    <p class="sub">${mesSelecionado.label} · Gerado em ${new Date().toLocaleDateString("pt-BR")}</p>
    <div class="metrics">
      <div class="metric"><div class="lbl">Entrou no Caixa</div><div class="val">${formatCurrency(resumoMes.entrou)}</div></div>
      <div class="metric"><div class="lbl">Gastos Pagos</div><div class="val">${formatCurrency(resumoMes.totalGastos)}</div></div>
      <div class="metric"><div class="lbl">Saldo do Caixa</div><div class="val">${formatCurrency(saldoFisicoManual ?? resumoMes.saldoCaixa)}</div></div>
      <div class="metric"><div class="lbl">Falta Receber</div><div class="val">${formatCurrency(resumoMes.faltaReceber)}</div></div>
    </div>
    <table><thead><tr><th>Data</th><th>Descrição</th><th>Tipo</th><th>Valor</th></tr></thead>
    <tbody>${extratoLista
      .map((item: any) => {
        const tipo = item._is_gasto ? `Gasto (${item._gasto_escopo})` : "Entrada";
        const nome = item._is_gasto ? item.cliente_nome : `${getClientName(item.user_id, item.cliente_nome)} · ${item.servico}`;
        return `<tr><td>${formatDateShort(item.data_fatura)}</td><td>${nome}</td><td>${tipo}</td><td>${formatCurrency(Number(item.valor_pago))}</td></tr>`;
      })
      .join("")}</tbody></table></body></html>`);
    w.document.close();
    w.print();
  };

  const saldoVisivel = saldoFisicoManual ?? resumoMes.saldoCaixa;

  return (
    <div className="space-y-4">
      {/* ═══════════ BARRA SUPERIOR COMPACTA (MOBILE-FIRST) ═══════════ */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              onClick={() => setMonthOffset((m) => m - 1)}
              aria-label="Mês anterior"
              className="w-8 h-8 rounded-lg bg-primary-foreground/[0.04] border border-primary-foreground/[0.08] hover:border-gold/30 hover:text-gold flex items-center justify-center text-primary-foreground/80 shrink-0 transition-all"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <div className="px-2.5 py-1.5 rounded-lg bg-primary-foreground/[0.03] border border-primary-foreground/[0.08] flex items-center gap-1.5 min-w-0">
              <Calendar className="w-3.5 h-3.5 text-gold shrink-0" />
              <span className="font-heading text-[13.5px] sm:text-[15px] font-semibold text-primary-foreground truncate">
                {mesSelecionado.label}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setMonthOffset((m) => m + 1)}
              aria-label="Próximo mês"
              className="w-8 h-8 rounded-lg bg-primary-foreground/[0.04] border border-primary-foreground/[0.08] hover:border-gold/30 hover:text-gold flex items-center justify-center text-primary-foreground/80 shrink-0 transition-all"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
            {monthOffset !== 0 && (
              <button
                type="button"
                onClick={() => setMonthOffset(0)}
                className="px-2 py-1 rounded-lg bg-gold/15 border border-gold/30 text-gold font-body text-[10.5px] font-semibold hover:bg-gold/25 shrink-0 transition-all"
              >
                Atual
              </button>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={exportCSV}
              title="Baixar Planilha (CSV)"
              aria-label="Exportar CSV"
              className="w-8 h-8 rounded-lg bg-primary-foreground/[0.04] border border-primary-foreground/[0.08] hover:border-emerald-400/35 hover:text-emerald-400 flex items-center justify-center text-primary-foreground/75 transition-all"
            >
              <Table2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={exportPDF}
              title="Imprimir / Salvar PDF"
              aria-label="Exportar PDF"
              className="w-8 h-8 rounded-lg bg-primary-foreground/[0.04] border border-primary-foreground/[0.08] hover:border-gold/35 hover:text-gold flex items-center justify-center text-primary-foreground/75 transition-all"
            >
              <FileText className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={openConfigModal}
              title="Configurar comissão e dia de fechamento"
              aria-label="Configurar Caixa"
              className="inline-flex items-center gap-1 px-2.5 h-8 rounded-lg bg-primary-foreground/[0.05] border border-primary-foreground/[0.1] hover:border-gold/40 hover:text-gold text-primary-foreground/85 font-body text-[11px] font-medium transition-all"
            >
              <Settings className="w-3.5 h-3.5 text-gold" />
              <span className="hidden xs:inline sm:inline">Configurar</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setModalConfig({ open: true, tab: "entrada" })}
            className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-emerald-500/15 border border-emerald-500/35 hover:bg-emerald-500/25 text-emerald-400 font-body text-[12px] font-semibold transition-all whitespace-nowrap"
          >
            <Plus className="w-3.5 h-3.5 shrink-0" /> Entrada
          </button>
          <button
            type="button"
            onClick={() => setModalConfig({ open: true, tab: "saida" })}
            className="inline-flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl bg-rose/15 border border-rose/35 hover:bg-rose/25 text-rose font-body text-[12px] font-semibold transition-all whitespace-nowrap"
          >
            <Minus className="w-3.5 h-3.5 shrink-0" /> Saída
          </button>
        </div>
      </div>

      {/* ═══════════ CARTÃO PRINCIPAL COMPACTO (100% MOBILE) ═══════════ */}
      <section className="rounded-2xl border border-primary-foreground/[0.09] bg-[#1a1919] p-3.5 sm:p-4 space-y-3">
        {/* Saldo + Ciclo */}
        <div className="space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 min-w-0">
              <Wallet className="w-4 h-4 text-gold shrink-0" />
              <span className="font-body text-[12px] font-semibold text-primary-foreground/80 truncate">
                Saldo em Caixa
              </span>
              {saldoFisicoManual !== null && (
                <span className="px-1.5 py-0.5 rounded-full bg-gold/15 border border-gold/30 font-body text-[9.5px] font-semibold text-gold shrink-0">
                  Manual
                </span>
              )}
            </div>

            <button
              type="button"
              onClick={openConfigModal}
              className="font-body text-[10.5px] text-primary-foreground/55 hover:text-gold transition-colors truncate"
            >
              Fechamento: dia {diaFechamento} · {mesSelecionado.rangeLabel}
            </button>
          </div>

          {editingSaldo ? (
            <div className="flex items-center gap-2 pt-0.5">
              <span className="font-heading text-base font-bold text-gold">R$</span>
              <input
                type="text"
                inputMode="numeric"
                value={tempSaldo}
                onChange={(e) => setTempSaldo(formatCurrencyMask(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleSaveSaldo();
                  if (e.key === "Escape") setEditingSaldo(false);
                }}
                placeholder="0,00"
                autoFocus
                className="w-32 px-2.5 py-1 rounded-xl bg-[#262523] border border-gold/45 text-gold font-heading text-lg font-bold tabular-nums focus:outline-none focus:border-gold"
              />
              <button
                type="button"
                onClick={handleSaveSaldo}
                disabled={savingSaldo}
                className="w-7 h-7 rounded-lg bg-emerald-500/20 text-emerald-400 hover:bg-emerald-500/30 flex items-center justify-center"
                aria-label="Confirmar ajuste de saldo"
              >
                <Check className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setEditingSaldo(false)}
                className="w-7 h-7 rounded-lg bg-rose/20 text-rose hover:bg-rose/30 flex items-center justify-center"
                aria-label="Cancelar ajuste de saldo"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <p
                className={`font-heading text-[28px] sm:text-3xl font-bold tabular-nums leading-none tracking-tight ${
                  saldoVisivel >= 0 ? "text-emerald-400" : "text-rose"
                }`}
              >
                {formatCurrency(saldoVisivel)}
              </p>
              <button
                type="button"
                onClick={() => {
                  setTempSaldo(formatCurrencyValue(saldoFisicoManual ?? resumoMes.saldoCaixa));
                  setEditingSaldo(true);
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-primary-foreground/[0.04] border border-primary-foreground/[0.08] text-primary-foreground/65 hover:text-gold hover:border-gold/30 font-body text-[10.5px] shrink-0 transition-all"
              >
                <Pencil className="w-3 h-3" /> Ajustar
              </button>
            </div>
          )}
        </div>

        {/* Faixa compacta de Comissão + Retirada */}
        <div className="rounded-xl border border-gold/20 bg-gold/[0.05] px-3 py-2 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={openConfigModal}
            className="text-left min-w-0 flex-1"
          >
            <p className="font-body text-[11px] text-gold font-semibold flex items-center gap-1 truncate">
              <Sparkles className="w-3 h-3 shrink-0" />
              <span>
                Comissão ({comissaoPct}%):{" "}
                <strong className="tabular-nums text-primary-foreground">
                  {formatCurrency(resumoMes.comissaoTotal)}
                </strong>
              </span>
            </p>
            <p className="font-body text-[10px] text-primary-foreground/55 truncate tabular-nums">
              Retirado {formatCurrency(resumoMes.comissaoRetirada)} · Disp. {formatCurrency(resumoMes.comissaoDisponivel)}
            </p>
          </button>

          <button
            type="button"
            onClick={() => {
              setRetiradaValor(
                resumoMes.comissaoDisponivel > 0 ? formatCurrencyValue(resumoMes.comissaoDisponivel) : ""
              );
              setRetiradaDesc("Retirada de Comissão");
              setRetiradaData(toLocalISO(new Date()));
              setRetiradaOpen(true);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/35 text-emerald-300 hover:bg-emerald-500/25 font-body text-[11px] font-semibold whitespace-nowrap shrink-0 transition-all"
          >
            <Banknote className="w-3 h-3" />
            <span>Retirar Comissão</span>
          </button>
        </div>

        {/* Formas de pagamento em 3 colunas compactas */}
        <button
          type="button"
          onClick={() => setShowPaymentMethodModal(true)}
          className="w-full text-left rounded-xl border border-primary-foreground/[0.07] bg-primary-foreground/[0.025] hover:border-gold/30 p-2.5 transition-all"
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="font-body text-[10.5px] font-medium text-primary-foreground/65">
              Como as clientes pagaram
            </span>
            <span className="font-body text-[10px] text-gold font-medium">Detalhes →</span>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <p className="font-body text-[10px] text-primary-foreground/50 flex items-center gap-1">
                <img src={pixIcon} alt="PIX" className="w-3 h-3" /> PIX
              </p>
              <p className="font-heading text-[12.5px] font-bold text-emerald-400 tabular-nums mt-0.5 truncate">
                {formatCurrency(paymentMethodStats.totals.pix)}
              </p>
            </div>
            <div>
              <p className="font-body text-[10px] text-primary-foreground/50 flex items-center gap-1">
                <CreditCard className="w-3 h-3 text-sky-400" /> Cartão
              </p>
              <p className="font-heading text-[12.5px] font-bold text-sky-400 tabular-nums mt-0.5 truncate">
                {formatCurrency(paymentMethodStats.totals.cartao)}
              </p>
            </div>
            <div>
              <p className="font-body text-[10px] text-primary-foreground/50 flex items-center gap-1">
                <Banknote className="w-3 h-3 text-gold" /> Dinheiro
              </p>
              <p className="font-heading text-[12.5px] font-bold text-gold tabular-nums mt-0.5 truncate">
                {formatCurrency(paymentMethodStats.totals.dinheiro)}
              </p>
            </div>
          </div>
        </button>

        {/* 4 cartões compactos 2x2 */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.06] p-2.5">
            <p className="font-body text-[10.5px] font-medium text-emerald-300/90 flex items-center gap-1">
              <ArrowDownLeft className="w-3 h-3" /> Entrou (Pago)
            </p>
            <p className="font-heading text-[16px] sm:text-[18px] font-bold text-emerald-400 tabular-nums mt-0.5">
              {formatCurrency(resumoMes.entrou)}
            </p>
            <p className="font-body text-[10px] text-primary-foreground/50 truncate">
              {resumoMes.qtdAtendimentos} {resumoMes.qtdAtendimentos === 1 ? "atendimento" : "atendimentos"}
            </p>
          </div>

          <div className="rounded-xl border border-rose/25 bg-rose/[0.06] p-2.5">
            <p className="font-body text-[10.5px] font-medium text-rose flex items-center gap-1">
              <ArrowUpRight className="w-3 h-3" /> Saiu (Gastos)
            </p>
            <p className="font-heading text-[16px] sm:text-[18px] font-bold text-rose tabular-nums mt-0.5">
              - {formatCurrency(resumoMes.totalGastos)}
            </p>
            <p className="font-body text-[10px] text-primary-foreground/50 truncate">
              Est. {formatCurrency(resumoMes.gastosEstudio)} · Pess. {formatCurrency(resumoMes.gastosPessoais)}
            </p>
          </div>

          <div className="rounded-xl border border-gold/25 bg-gold/[0.06] p-2.5">
            <p className="font-body text-[10.5px] font-medium text-gold flex items-center gap-1">
              <Clock className="w-3 h-3" /> Falta Receber
            </p>
            <p className="font-heading text-[16px] sm:text-[18px] font-bold text-gold tabular-nums mt-0.5">
              {formatCurrency(resumoMes.faltaReceber)}
            </p>
            <p className="font-body text-[10px] text-primary-foreground/50 truncate">
              Em aberto / sinais
            </p>
          </div>

          <div className="rounded-xl border border-primary-foreground/[0.09] bg-[#252423] p-2.5">
            <p className="font-body text-[10.5px] font-medium text-primary-foreground/80">
              {comissaoPct > 0 ? "Lucro Líquido" : "Lucro do Estúdio"}
            </p>
            <p
              className={`font-heading text-[16px] sm:text-[18px] font-bold tabular-nums mt-0.5 ${
                (comissaoPct > 0 ? resumoMes.sobraAposComissao : resumoMes.sobraEstudio) >= 0
                  ? "text-emerald-400"
                  : "text-rose"
              }`}
            >
              {formatCurrency(comissaoPct > 0 ? resumoMes.sobraAposComissao : resumoMes.sobraEstudio)}
            </p>
            <p className="font-body text-[10px] text-primary-foreground/50 truncate">
              {comissaoPct > 0
                ? `Após ${comissaoPct}% comissão`
                : "Entrou − gastos estúdio"}
            </p>
          </div>
        </div>
      </section>

      {/* ═══════════ NAVEGAÇÃO INFERIOR ÚNICA: EXTRATO | DIA A DIA | GRÁFICOS ═══════════ */}
      <div className="flex gap-1.5 p-1 rounded-2xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.08]">
        {([
          { id: "extrato" as const, label: "Extrato (Entradas e Saídas)", icon: Wallet },
          { id: "dia" as const, label: "Resumo do Dia", icon: Calendar },
          { id: "resumo" as const, label: "Gráfico e Serviços", icon: BarChart3 },
        ]).map((tabItem) => {
          const Icon = tabItem.icon;
          const active = viewTab === tabItem.id;
          return (
            <button
              key={tabItem.id}
              type="button"
              onClick={() => setViewTab(tabItem.id)}
              className={`flex-1 py-2.5 px-3 rounded-xl font-body text-[12px] font-semibold transition-all flex items-center justify-center gap-1.5 ${
                active
                  ? "bg-gold/15 text-gold border border-gold/30"
                  : "text-primary-foreground/60 hover:text-primary-foreground"
              }`}
            >
              <Icon className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{tabItem.label}</span>
            </button>
          );
        })}
      </div>

      {/* ═══════════ ABA 1: EXTRATO SIMPLIFICADO ═══════════ */}
      {viewTab === "extrato" && (
        <section className="rounded-3xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.025] p-4 sm:p-5 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
            {/* O que mostrar: Tudo | Entradas | Saídas */}
            <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#252423] border border-primary-foreground/[0.08]">
              {([
                { id: "tudo" as const, label: "Tudo" },
                { id: "entradas" as const, label: "Só Entradas" },
                { id: "saidas" as const, label: "Só Saídas" },
              ]).map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setExtratoFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg font-body text-[11.5px] font-medium transition-all ${
                    extratoFilter === f.id
                      ? "bg-gold/20 text-gold font-semibold"
                      : "text-primary-foreground/60 hover:text-primary-foreground"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Período rápido */}
            <div className="inline-flex items-center gap-1.5">
              {([
                { id: "hoje" as const, label: "Hoje" },
                { id: "semana" as const, label: "7 dias" },
                { id: "mes" as const, label: "Todo o mês" },
              ]).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => setPeriod(p.id)}
                  className={`px-3 py-1.5 rounded-xl border font-body text-[11.5px] font-medium transition-all ${
                    period === p.id
                      ? "border-gold/40 bg-gold/15 text-gold font-semibold"
                      : "border-primary-foreground/[0.08] bg-primary-foreground/[0.03] text-primary-foreground/60 hover:text-primary-foreground"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-1.5 max-h-[520px] overflow-y-auto custom-scrollbar pr-1">
            {extratoLista.slice(0, visibleExtratoCount).map((item: any) => {
              const isGasto = Boolean(item._is_gasto);
              const val = Number(item.valor_pago || 0);
              const parcelaInfo = !isGasto ? item._parcelaInfo : null;
              return (
                <div
                  key={item._movimentoId}
                  className="flex items-start justify-between gap-2.5 p-3 rounded-2xl bg-[#252423] border border-primary-foreground/[0.07] hover:border-gold/25 transition-all"
                >
                  <div className="flex items-start gap-2.5 min-w-0 flex-1">
                    <span
                      className={`w-8 h-8 rounded-xl flex items-center justify-center shrink-0 mt-0.5 ${
                        isGasto || val < 0
                          ? "bg-rose/15 text-rose"
                          : parcelaInfo?.kind === "parcela"
                            ? "bg-amber-500/15 text-amber-300"
                            : "bg-emerald-500/15 text-emerald-400"
                      }`}
                    >
                      {isGasto || val < 0 ? (
                        <ArrowUpRight className="w-4 h-4" />
                      ) : (
                        <ArrowDownLeft className="w-4 h-4" />
                      )}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-body text-[13.5px] font-semibold text-primary-foreground truncate">
                          {isGasto ? item.cliente_nome : getClientName(item.user_id, item.cliente_nome)}
                        </p>
                        {parcelaInfo?.badgeLabel && (
                          <span
                            className={`px-1.5 py-0.5 rounded-full border font-body text-[9px] font-bold uppercase tracking-wider shrink-0 ${
                              parcelaInfo.kind === "parcela"
                                ? "bg-amber-500/15 text-amber-300 border-amber-500/35"
                                : parcelaInfo.kind === "estorno"
                                  ? "bg-rose/15 text-rose border-rose/35"
                                  : "bg-emerald-500/15 text-emerald-300 border-emerald-500/35"
                            }`}
                          >
                            {parcelaInfo.badgeLabel}
                          </span>
                        )}
                      </div>
                      <p className="font-body text-[11px] text-primary-foreground/60 truncate mt-0.5">
                        {formatDateShort(item.data_fatura)} · {item.servico}
                        {!isGasto && item.forma_pagamento ? ` · ${item.forma_pagamento.toUpperCase()}` : ""}
                      </p>
                      {(parcelaInfo?.progressText || parcelaInfo?.refDateText || parcelaInfo?.observacaoText) && (
                        <p className="font-body text-[10px] text-primary-foreground/45 truncate mt-0.5">
                          {[parcelaInfo.progressText, parcelaInfo.refDateText, parcelaInfo.observacaoText]
                            .filter(Boolean)
                            .join(" · ")}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="text-right shrink-0">
                    <p
                      className={`font-heading text-[14px] font-bold tabular-nums ${
                        isGasto || val < 0 ? "text-rose" : "text-emerald-400"
                      }`}
                    >
                      {val >= 0 ? `+ ${formatCurrency(val)}` : formatCurrency(val)}
                    </p>
                    <p className="font-body text-[10px] text-primary-foreground/45">
                      {isGasto
                        ? `Saída (${item._gasto_escopo})`
                        : parcelaInfo?.kind === "parcela"
                          ? "Parcela"
                          : parcelaInfo?.kind === "quitacao"
                            ? "Quitação"
                            : val >= 0
                              ? "Recebido"
                              : "Estorno"}
                    </p>
                  </div>
                </div>
              );
            })}

            {extratoLista.length === 0 && (
              <div className="py-12 text-center rounded-2xl border border-dashed border-primary-foreground/[0.08]">
                <p className="font-body text-[13px] text-primary-foreground/60">
                  Nenhuma movimentação encontrada neste período
                </p>
              </div>
            )}

            <LoadMoreButton
              visibleCount={visibleExtratoCount}
              totalCount={extratoLista.length}
              step={15}
              onLoadMore={() => setVisibleExtratoCount((c) => c + 15)}
              itemLabel="lançamentos"
            />
          </div>
        </section>
      )}

      {/* ═══════════ ABA 2: RESUMO DO DIA (FECHAMENTO DIÁRIO) ═══════════ */}
      {viewTab === "dia" && (
        <section className="rounded-3xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.025] p-4 sm:p-5 space-y-5">
          {/* Navegador de data */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2 p-1.5 rounded-2xl bg-[#252423] border border-primary-foreground/[0.08]">
              <button
                type="button"
                onClick={() => {
                  const d = new Date(caixaDate + "T12:00:00");
                  d.setDate(d.getDate() - 1);
                  setCaixaDate(toLocalISO(d));
                }}
                aria-label="Dia anterior"
                className="w-9 h-9 rounded-xl hover:bg-primary-foreground/[0.06] flex items-center justify-center text-primary-foreground/80 hover:text-gold transition-all"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>

              <Popover>
                <PopoverTrigger asChild>
                  <button
                    type="button"
                    aria-label="Abrir calendário para selecionar dia"
                    className="flex-1 text-center py-1.5 rounded-xl hover:bg-primary-foreground/[0.04] transition-all"
                  >
                    <span className="inline-flex items-center gap-2">
                      <Calendar className="w-3.5 h-3.5 text-gold" />
                      <span className="font-heading text-[15px] font-semibold text-primary-foreground capitalize">
                        {new Date(caixaDate + "T12:00:00").toLocaleDateString("pt-BR", {
                          weekday: "long",
                          day: "2-digit",
                          month: "long",
                        })}
                      </span>
                    </span>
                  </button>
                </PopoverTrigger>
                <PopoverContent
                  align="center"
                  className="w-auto p-0 bg-charcoal text-primary-foreground border border-primary-foreground/[0.12] rounded-3xl shadow-2xl overflow-hidden"
                >
                  <CalendarPicker
                    mode="single"
                    locale={ptBR}
                    selected={new Date(caixaDate + "T12:00:00")}
                    onSelect={(d) => d && setCaixaDate(toLocalISO(d))}
                    classNames={{
                      months: "flex flex-col space-y-4",
                      month: "space-y-3",
                      caption: "flex justify-center pt-1 relative items-center",
                      caption_label: "text-sm font-semibold text-primary-foreground capitalize",
                      nav: "space-x-1 flex items-center",
                      nav_button:
                        "inline-flex items-center justify-center h-7 w-7 rounded-lg border border-primary-foreground/15 bg-primary-foreground/[0.05] p-0 text-primary-foreground/80 hover:bg-primary-foreground/15",
                      nav_button_previous: "absolute left-1",
                      nav_button_next: "absolute right-1",
                      table: "w-full border-collapse space-y-1",
                      head_row: "flex",
                      head_cell: "text-primary-foreground/50 rounded-md w-9 font-medium text-[0.75rem] capitalize",
                      row: "flex w-full mt-1.5",
                      cell: "h-9 w-9 text-center text-sm p-0 relative",
                      day: "inline-flex items-center justify-center h-9 w-9 p-0 font-normal rounded-full text-primary-foreground hover:bg-primary-foreground/10 transition-colors",
                      day_selected: "!bg-gold !text-charcoal font-bold rounded-full",
                      day_today: "border border-gold/50 text-gold font-semibold",
                      day_outside: "text-primary-foreground/25 opacity-60",
                    }}
                    initialFocus
                  />
                </PopoverContent>
              </Popover>

              <button
                type="button"
                onClick={() => {
                  const d = new Date(caixaDate + "T12:00:00");
                  d.setDate(d.getDate() + 1);
                  setCaixaDate(toLocalISO(d));
                }}
                aria-label="Próximo dia"
                className="w-9 h-9 rounded-xl hover:bg-primary-foreground/[0.06] flex items-center justify-center text-primary-foreground/80 hover:text-gold transition-all"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="flex gap-1.5 justify-center">
              {[
                { label: "Ontem", offset: -1 },
                { label: "Hoje", offset: 0 },
                { label: "Amanhã", offset: 1 },
              ].map(({ label, offset }) => {
                const d = new Date();
                d.setDate(d.getDate() + offset);
                const dateStr = toLocalISO(d);
                const active = caixaDate === dateStr;
                return (
                  <button
                    key={label}
                    type="button"
                    onClick={() => setCaixaDate(dateStr)}
                    className={`px-3.5 py-1 rounded-full font-body text-[11px] font-medium border transition-all ${
                      active
                        ? "bg-gold/15 text-gold border-gold/35 font-semibold"
                        : "bg-primary-foreground/[0.03] text-primary-foreground/65 border-primary-foreground/[0.08] hover:text-primary-foreground"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Destaque do dia */}
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
            <div className="sm:col-span-2 rounded-2xl border border-gold/25 bg-gold/[0.07] p-4 flex items-center justify-between">
              <div>
                <p className="font-body text-[11px] text-gold uppercase tracking-wider font-semibold">
                  Entrou neste dia
                </p>
                <p className="font-heading text-3xl font-bold text-primary-foreground tabular-nums mt-1">
                  {formatCurrency(caixaDia.recebido)}
                </p>
                <p className="font-body text-[11px] text-primary-foreground/55 mt-0.5">
                  de {formatCurrency(caixaDia.total)} previstos ({caixaDia.progressPercent}% pago)
                </p>
              </div>
              <CheckCircle2 className="w-8 h-8 text-gold/70 shrink-0" />
            </div>

            <div className="rounded-2xl border border-primary-foreground/[0.08] bg-[#252423] p-4 text-center flex flex-col justify-center">
              <p className="font-heading text-2xl font-bold text-primary-foreground tabular-nums">{caixaDia.qtd}</p>
              <p className="font-body text-[10.5px] text-primary-foreground/55 uppercase tracking-wider mt-0.5">
                Atendimentos
              </p>
            </div>

            <div className="rounded-2xl border border-primary-foreground/[0.08] bg-[#252423] p-4 text-center flex flex-col justify-center">
              <p className="font-heading text-xl font-bold text-rose tabular-nums">
                {formatCurrency(caixaDia.pendente)}
              </p>
              <p className="font-body text-[10.5px] text-primary-foreground/55 uppercase tracking-wider mt-0.5">
                Falta receber
              </p>
            </div>
          </div>

          {/* Parcelas e pendências avulsas recebidas neste dia */}
          {(() => {
            const byId = new Map(allAgendamentos.map((a) => [a.id, a]));
            const parcelasDia = caixaDia.pagamentos
              .filter((m) => {
                const linked = byId.get(m.referencia_id);
                const info = classifyInstallmentMovement(m, linked);
                const dataAtend = m.data_atendimento || linked?.data_agendamento;
                return (
                  info.kind === "parcela" ||
                  info.kind === "quitacao" ||
                  Boolean(dataAtend && dataAtend !== caixaDate)
                );
              })
              .map((m) => {
                const linked = byId.get(m.referencia_id);
                return { m, linked, info: classifyInstallmentMovement(m, linked) };
              });
            if (parcelasDia.length === 0) return null;
            return (
              <div className="space-y-1.5">
                <p className="font-body text-[11px] font-semibold text-amber-300/80 uppercase tracking-wider px-1">
                  Parcelas e pendências recebidas neste dia
                </p>
                {parcelasDia.map(({ m, linked, info }) => (
                  <div
                    key={m.id}
                    className="flex items-center justify-between gap-2.5 p-3 rounded-2xl bg-amber-500/[0.06] border border-amber-500/20"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className="font-body text-[13px] font-semibold text-primary-foreground truncate">
                          {getClientName(linked?.user_id || "admin", m.cliente_nome || linked?.cliente_nome)}
                        </p>
                        {info.badgeLabel && (
                          <span className="px-1.5 py-0.5 rounded-full border border-amber-500/35 bg-amber-500/15 font-body text-[9px] font-bold uppercase text-amber-300">
                            {info.badgeLabel}
                          </span>
                        )}
                      </div>
                      <p className="font-body text-[11px] text-primary-foreground/60 truncate mt-0.5">
                        {m.descricao || linked?.servico || "Pagamento"}
                        {m.forma_pagamento ? ` · ${m.forma_pagamento.toUpperCase()}` : ""}
                      </p>
                      {(info.progressText || info.refDateText) && (
                        <p className="font-body text-[10px] text-primary-foreground/45 truncate mt-0.5">
                          {[info.progressText, info.refDateText].filter(Boolean).join(" · ")}
                        </p>
                      )}
                    </div>
                    <p className="font-heading text-[13.5px] font-bold text-emerald-400 tabular-nums shrink-0">
                      + {formatCurrency(Number(m.valor || 0))}
                    </p>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Lista de atendimentos do dia */}
          {caixaDia.items.length > 0 ? (
            <div className="space-y-1.5">
              <p className="font-body text-[11px] font-semibold text-primary-foreground/60 uppercase tracking-wider px-1">
                Atendimentos deste dia
              </p>
              {[...caixaDia.items]
                .sort((a, b) => a.horario.localeCompare(b.horario))
                .map((a) => {
                  const totalDevido = Math.max(0, Number(a.valor) - Number(a.valor_desconto_credito || 0));
                  const vPago = Number(a.valor_pago || 0);
                  const pago = totalDevido === 0 || vPago >= totalDevido - 0.01;
                  const parcial = vPago > 0 && !pago;
                  return (
                    <div
                      key={a.id}
                      className="flex items-center justify-between gap-3 p-3 rounded-2xl bg-[#252423] border border-primary-foreground/[0.07]"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className="font-heading text-[13px] font-bold text-primary-foreground tabular-nums w-12 shrink-0">
                          {a.horario.slice(0, 5)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="font-body text-[13px] font-semibold text-primary-foreground truncate">
                            {getClientName(a.user_id, a.cliente_nome)}
                          </p>
                          <p className="font-body text-[11px] text-primary-foreground/55 truncate">{a.servico}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="font-heading text-[13px] font-bold text-primary-foreground tabular-nums">
                          {formatCurrency(totalDevido)}
                        </p>
                        <p
                          className={`font-body text-[10.5px] font-medium ${
                            pago ? "text-emerald-400" : parcial ? "text-gold" : "text-primary-foreground/45"
                          }`}
                        >
                          {pago ? "Pago" : parcial ? `Sinal ${formatCurrency(vPago)}` : "Pendente"}
                        </p>
                      </div>
                    </div>
                  );
                })}
            </div>
          ) : (
            <div className="py-10 text-center rounded-2xl border border-dashed border-primary-foreground/[0.08]">
              <p className="font-body text-[12.5px] text-primary-foreground/55">Nenhum atendimento neste dia</p>
            </div>
          )}
        </section>
      )}

      {/* ═══════════ ABA 3: GRÁFICOS E SERVIÇOS ═══════════ */}
      {viewTab === "resumo" && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="rounded-3xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.025] p-5">
              <p className="font-body text-[12px] font-semibold text-primary-foreground/75 mb-3">
                Entradas x Gastos no mês
              </p>
              {dailyChartData.length > 0 ? (
                <>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={dailyChartData}>
                        <defs>
                          <linearGradient id="gradCaixaEntradas" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(142 71% 45%)" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="hsl(142 71% 45%)" stopOpacity={0} />
                          </linearGradient>
                          <linearGradient id="gradCaixaGastos" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="hsl(340 50% 55%)" stopOpacity={0.3} />
                            <stop offset="100%" stopColor="hsl(340 50% 55%)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid strokeDasharray="3 3" stroke="hsla(0 0% 100% / 0.04)" />
                        <XAxis dataKey="diaLabel" tick={{ fill: "hsla(0 0% 100% / 0.45)", fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: "hsla(0 0% 100% / 0.45)", fontSize: 10 }} axisLine={false} tickLine={false} width={44} />
                        <Tooltip formatter={(val: number) => formatCurrency(val)} />
                        <Area type="monotone" dataKey="entradas" name="Entrou" stroke="hsl(142 71% 45%)" fill="url(#gradCaixaEntradas)" strokeWidth={2} />
                        <Area type="monotone" dataKey="gastos" name="Saiu" stroke="hsl(340 50% 55%)" fill="url(#gradCaixaGastos)" strokeWidth={2} />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex items-center justify-center gap-5 mt-2">
                    <span className="flex items-center gap-1.5 font-body text-[11px] text-primary-foreground/70">
                      <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" /> Entrou
                    </span>
                    <span className="flex items-center gap-1.5 font-body text-[11px] text-primary-foreground/70">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose" /> Saiu (Gastos)
                    </span>
                  </div>
                </>
              ) : (
                <div className="h-[150px] flex items-center justify-center">
                  <p className="font-body text-[12px] text-primary-foreground/55">Sem movimentações neste mês</p>
                </div>
              )}
            </div>

            <div className="rounded-3xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.025] p-5">
              <p className="font-body text-[12px] font-semibold text-primary-foreground/75 mb-3">
                Situação dos atendimentos do mês
              </p>
              {paymentStatusChart.length > 0 ? (
                <>
                  <div className="h-[180px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={paymentStatusChart}
                          cx="50%"
                          cy="50%"
                          innerRadius={45}
                          outerRadius={70}
                          paddingAngle={4}
                          dataKey="value"
                          stroke="none"
                        >
                          {paymentStatusChart.map((d, i) => (
                            <Cell key={i} fill={d.color} />
                          ))}
                        </Pie>
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex items-center justify-center gap-4 mt-2">
                    {paymentStatusChart.map((d) => (
                      <span key={d.name} className="flex items-center gap-1.5 font-body text-[11px] text-primary-foreground/75">
                        <span className="w-2.5 h-2.5 rounded-full" style={{ background: d.color }} /> {d.name} ({d.value})
                      </span>
                    ))}
                  </div>
                </>
              ) : (
                <div className="h-[150px] flex items-center justify-center">
                  <p className="font-body text-[12px] text-primary-foreground/55">Sem atendimentos neste mês</p>
                </div>
              )}
            </div>
          </div>

          {/* Ranking de serviços */}
          <div className="rounded-3xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.025] p-5 space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
              <div>
                <p className="font-body text-[12.5px] font-semibold text-primary-foreground flex items-center gap-1.5">
                  <Sparkles className="w-3.5 h-3.5 text-gold" /> Serviços mais procurados no mês
                </p>
                <p className="font-body text-[11px] text-primary-foreground/55">
                  {serviceRankingData.reduce((s, x) => s + x.count, 0)} atendimentos ·{" "}
                  {formatCurrency(serviceRankingData.reduce((s, x) => s + x.total, 0))}
                </p>
              </div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary-foreground/45" />
                <input
                  type="text"
                  placeholder="Buscar serviço..."
                  value={serviceSearch}
                  onChange={(e) => setServiceSearch(e.target.value)}
                  className="w-full sm:w-48 pl-9 pr-3 py-1.5 bg-[#252423] border border-primary-foreground/[0.1] rounded-xl font-body text-[12px] text-primary-foreground placeholder:text-primary-foreground/45 focus:outline-none focus:border-gold"
                />
              </div>
            </div>

            {serviceRankingData.length > 0 ? (
              <div className="space-y-3">
                {serviceRankingData.map((s, i) => {
                  const maxTotal = Math.max(1, serviceRankingData[0].total);
                  const pctBar = (s.total / maxTotal) * 100;
                  return (
                    <div key={s.name} className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-body text-[13px] font-medium text-primary-foreground truncate">
                          {i + 1}. {s.name}
                        </span>
                        <div className="text-right shrink-0">
                          <span className="font-heading text-[13px] font-bold text-primary-foreground tabular-nums">
                            {formatCurrency(s.total)}
                          </span>
                          <span className="font-body text-[10.5px] text-primary-foreground/55 ml-2">({s.count}x)</span>
                        </div>
                      </div>
                      <div className="h-1.5 rounded-full bg-primary-foreground/[0.06] overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all duration-500"
                          style={{ width: `${pctBar}%`, backgroundColor: SERVICE_COLORS[i % SERVICE_COLORS.length] }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <p className="text-center py-6 font-body text-[12px] text-primary-foreground/55">
                Nenhum serviço no mês selecionado
              </p>
            )}
          </div>
        </div>
      )}

      {/* ═══════════ MODAL: DETALHE POR FORMA DE PAGAMENTO ═══════════ */}
      <Dialog open={showPaymentMethodModal} onOpenChange={setShowPaymentMethodModal}>
        <DialogContent
          aria-describedby={undefined}
          className="w-[calc(100vw-1rem)] max-w-md max-h-[85dvh] flex flex-col overflow-hidden bg-charcoal border border-primary-foreground/[0.12] rounded-3xl p-0 shadow-2xl"
        >
          <DialogHeader className="shrink-0 px-5 pt-5 pb-3.5 border-b border-primary-foreground/[0.08]">
            <DialogTitle className="font-heading text-[18px] font-semibold text-primary-foreground">
              Entradas por Forma de Pagamento
            </DialogTitle>
            <p className="font-body text-[11.5px] text-primary-foreground/55">{mesSelecionado.label}</p>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto custom-scrollbar px-5 py-4 space-y-4">
            <div className="grid grid-cols-3 gap-2">
              {([
                { key: "pix", label: "PIX", textColor: "text-emerald-400", bg: "bg-emerald-500/10 border-emerald-500/25" },
                { key: "cartao", label: "Cartão", textColor: "text-sky-400", bg: "bg-sky-500/10 border-sky-500/25" },
                { key: "dinheiro", label: "Dinheiro", textColor: "text-gold", bg: "bg-gold/10 border-gold/25" },
              ] as const).map((item) => (
                <div key={item.key} className={`rounded-2xl border ${item.bg} p-3 text-center`}>
                  <p className="font-body text-[10.5px] text-primary-foreground/65">{item.label}</p>
                  <p className={`font-heading text-[14px] font-bold tabular-nums mt-1 ${item.textColor}`}>
                    {formatCurrency(paymentMethodStats.totals[item.key])}
                  </p>
                  <p className="font-body text-[10px] text-primary-foreground/45 mt-0.5">
                    {paymentMethodStats.counts[item.key]} pag.
                  </p>
                </div>
              ))}
            </div>

            {([
              { key: "pix", label: "PIX", textColor: "text-emerald-400" },
              { key: "cartao", label: "Cartão", textColor: "text-sky-400" },
              { key: "dinheiro", label: "Dinheiro", textColor: "text-gold" },
            ] as const).map(({ key, label, textColor }) => {
              const list = paymentMethodStats.items[key];
              if (!list || list.length === 0) return null;
              return (
                <div key={key} className="rounded-2xl border border-primary-foreground/[0.08] bg-[#252423] overflow-hidden">
                  <div className="px-3.5 py-2 border-b border-primary-foreground/[0.06] flex items-center justify-between">
                    <span className="font-body text-[11px] font-semibold text-primary-foreground">{label}</span>
                    <span className={`font-heading text-[12px] font-bold tabular-nums ${textColor}`}>
                      {formatCurrency(paymentMethodStats.totals[key])}
                    </span>
                  </div>
                  <div className="divide-y divide-primary-foreground/[0.05] max-h-40 overflow-y-auto custom-scrollbar">
                    {list.map((a: any) => (
                      <div key={a._movimentoId} className="px-3.5 py-2 flex items-center justify-between gap-2">
                        <div className="min-w-0">
                          <p className="font-body text-[12px] font-medium text-primary-foreground truncate">
                            {getClientName(a.user_id, a.cliente_nome)}
                          </p>
                          <p className="font-body text-[10px] text-primary-foreground/50 truncate">
                            {formatDateShort(a.data_fatura)} · {a.servico}
                          </p>
                        </div>
                        <span className={`font-heading text-[12px] font-bold tabular-nums shrink-0 ${textColor}`}>
                          {formatCurrency(Number(a.valor_pago || 0))}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            {paymentMethodStats.grandTotal === 0 && (
              <p className="text-center py-8 font-body text-[12.5px] text-primary-foreground/50">
                Nenhum pagamento registrado neste mês
              </p>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal rápido de Nova Entrada ou Nova Saída */}
      <NovaTransacaoModal
        open={modalConfig.open}
        onOpenChange={(open) => setModalConfig((prev) => ({ ...prev, open }))}
        initialTab={modalConfig.tab}
        onSuccess={() => {
          setRefreshTick((t) => t + 1);
          onUpdate?.();
        }}
      />

      {/* Modal: Configurações do Caixa (Comissão e Dia de Fechamento) */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md rounded-[24px] border border-gold/25 bg-charcoal p-5 shadow-2xl">
          <DialogHeader className="mb-1">
            <DialogTitle className="font-heading text-[20px] font-semibold text-primary-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gold/15 border border-gold/30 flex items-center justify-center">
                <Settings className="w-4 h-4 text-gold" />
              </div>
              <span>Configurações do Caixa</span>
            </DialogTitle>
            <p className="font-body text-[11.5px] text-primary-foreground/55 text-left">
              Defina a comissão e o dia em que seu mês financeiro vira
            </p>
          </DialogHeader>

          <div className="space-y-4 pt-2">
            {/* Comissão */}
            <div className="space-y-2 rounded-2xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.02] p-3.5">
              <label className="font-body text-[10.5px] uppercase tracking-wider text-primary-foreground/65 font-semibold block">
                Comissão (%)
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={tempComissaoPct}
                  onChange={(e) => setTempComissaoPct(e.target.value)}
                  className="w-24 px-3 py-2 rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.1] text-primary-foreground font-heading text-[16px] font-bold tabular-nums focus:outline-none focus:border-gold/45"
                />
                <span className="font-body text-[13px] text-primary-foreground/60">%</span>
                <div className="flex flex-wrap gap-1 ml-auto">
                  {[0, 30, 40, 50, 60].map((pct) => (
                    <button
                      key={pct}
                      type="button"
                      onClick={() => setTempComissaoPct(String(pct))}
                      className={`px-2 py-1 rounded-lg border font-body text-[11px] transition-all ${
                        Number(tempComissaoPct) === pct
                          ? "bg-gold/20 border-gold/45 text-gold font-semibold"
                          : "bg-primary-foreground/[0.03] border-primary-foreground/[0.08] text-primary-foreground/60 hover:text-primary-foreground"
                      }`}
                    >
                      {pct}%
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-1.5 pt-1">
                <button
                  type="button"
                  onClick={() => setComissaoEscopo("ciclo")}
                  className={`py-1.5 px-2.5 rounded-lg border font-body text-[11px] font-medium transition-all ${
                    comissaoEscopo === "ciclo"
                      ? "bg-gold/15 border-gold/40 text-gold"
                      : "bg-primary-foreground/[0.03] border-primary-foreground/[0.08] text-primary-foreground/55"
                  }`}
                >
                  Neste ciclo inteiro
                </button>
                <button
                  type="button"
                  onClick={() => setComissaoEscopo("hoje")}
                  className={`py-1.5 px-2.5 rounded-lg border font-body text-[11px] font-medium transition-all ${
                    comissaoEscopo === "hoje"
                      ? "bg-gold/15 border-gold/40 text-gold"
                      : "bg-primary-foreground/[0.03] border-primary-foreground/[0.08] text-primary-foreground/55"
                  }`}
                >
                  Só a partir de hoje
                </button>
              </div>
              <p className="font-body text-[10.5px] text-primary-foreground/45 leading-snug">
                {comissaoEscopo === "hoje"
                  ? "Pagamentos anteriores a hoje mantêm a taxa antiga; de hoje em diante usam a nova."
                  : "Aplica essa porcentagem em todo o ciclo atual."}
              </p>
            </div>

            {/* Dia de fechamento */}
            <div className="space-y-2 rounded-2xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.02] p-3.5">
              <label className="font-body text-[10.5px] uppercase tracking-wider text-primary-foreground/65 font-semibold block">
                Dia de fechamento do mês (1 a 28)
              </label>
              <div className="flex items-center gap-2">
                <span className="font-body text-[12px] text-primary-foreground/60">Todo dia</span>
                <input
                  type="number"
                  min={1}
                  max={28}
                  value={tempDiaFechamento}
                  onChange={(e) => setTempDiaFechamento(e.target.value)}
                  className="w-20 px-3 py-2 rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.1] text-primary-foreground font-heading text-[16px] font-bold tabular-nums focus:outline-none focus:border-gold/45"
                />
                <div className="flex flex-wrap gap-1 ml-auto">
                  {[1, 5, 10, 15, 20].map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setTempDiaFechamento(String(d))}
                      className={`px-2 py-1 rounded-lg border font-body text-[11px] transition-all ${
                        Number(tempDiaFechamento) === d
                          ? "bg-gold/20 border-gold/45 text-gold font-semibold"
                          : "bg-primary-foreground/[0.03] border-primary-foreground/[0.08] text-primary-foreground/60 hover:text-primary-foreground"
                      }`}
                    >
                      Dia {d}
                    </button>
                  ))}
                </div>
              </div>
              <p className="font-body text-[11px] text-gold/80">
                Ciclo atual fica: {calcCycleForOffset(Math.max(1, Math.min(28, parseInt(tempDiaFechamento, 10) || 1)), monthOffset).rangeLabel}
              </p>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setConfigOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-primary-foreground/[0.05] text-primary-foreground/75 font-body text-[12.5px] font-medium hover:bg-primary-foreground/[0.1] transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                onClick={handleSaveConfig}
                className="flex-[1.4] py-2.5 rounded-xl bg-gradient-to-br from-gold to-nude text-charcoal font-body text-[13px] font-bold hover:brightness-105 transition-all"
              >
                Salvar Configurações
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal: Retirar Comissão */}
      <Dialog open={retiradaOpen} onOpenChange={setRetiradaOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md rounded-[24px] border border-emerald-500/25 bg-charcoal p-5 shadow-2xl">
          <DialogHeader className="mb-1">
            <DialogTitle className="font-heading text-[20px] font-semibold text-primary-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-emerald-500/15 border border-emerald-500/30 flex items-center justify-center">
                <Banknote className="w-4 h-4 text-emerald-400" />
              </div>
              <span>Retirar Comissão</span>
            </DialogTitle>
            <p className="font-body text-[11.5px] text-primary-foreground/55 text-left">
              Registra a saída da sua comissão e abate automaticamente do Saldo em Caixa
            </p>
          </DialogHeader>

          <div className="space-y-3.5 pt-2">
            <div className="grid grid-cols-3 gap-2 rounded-2xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.025] p-3 text-center">
              <div>
                <p className="font-body text-[9.5px] uppercase tracking-wider text-primary-foreground/50">
                  Gerada ({comissaoPct}%)
                </p>
                <p className="font-heading text-[13.5px] font-bold text-gold tabular-nums mt-0.5">
                  {formatCurrency(resumoMes.comissaoTotal)}
                </p>
              </div>
              <div>
                <p className="font-body text-[9.5px] uppercase tracking-wider text-primary-foreground/50">
                  Já retirada
                </p>
                <p className="font-heading text-[13.5px] font-bold text-rose tabular-nums mt-0.5">
                  {formatCurrency(resumoMes.comissaoRetirada)}
                </p>
              </div>
              <div>
                <p className="font-body text-[9.5px] uppercase tracking-wider text-emerald-400/80">
                  Disponível
                </p>
                <p className="font-heading text-[13.5px] font-bold text-emerald-400 tabular-nums mt-0.5">
                  {formatCurrency(resumoMes.comissaoDisponivel)}
                </p>
              </div>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="font-body text-[10.5px] uppercase tracking-wider text-primary-foreground/65 font-semibold">
                  Valor da retirada *
                </label>
                {resumoMes.comissaoDisponivel > 0 && (
                  <button
                    type="button"
                    onClick={() => setRetiradaValor(formatCurrencyValue(resumoMes.comissaoDisponivel))}
                    className="font-body text-[11px] font-medium text-emerald-400 hover:underline"
                  >
                    Usar disponível ({formatCurrency(resumoMes.comissaoDisponivel)})
                  </button>
                )}
              </div>
              <div className="relative">
                <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-body text-[12.5px] font-semibold text-emerald-400">
                  R$
                </span>
                <input
                  type="text"
                  inputMode="numeric"
                  value={retiradaValor}
                  onChange={(e) => setRetiradaValor(formatCurrencyMask(e.target.value))}
                  placeholder="0,00"
                  autoFocus
                  className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.1] text-primary-foreground font-heading text-[16px] font-bold tabular-nums focus:outline-none focus:border-emerald-400/50"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-body text-[10.5px] uppercase tracking-wider text-primary-foreground/65 font-semibold block">
                  Descrição
                </label>
                <input
                  type="text"
                  value={retiradaDesc}
                  onChange={(e) => setRetiradaDesc(e.target.value)}
                  placeholder="Retirada de Comissão"
                  className="w-full px-3.5 py-2 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.1] text-primary-foreground font-body text-[12.5px] focus:outline-none focus:border-gold/45"
                />
              </div>
              <div className="space-y-1.5">
                <label className="font-body text-[10.5px] uppercase tracking-wider text-primary-foreground/65 font-semibold block">
                  Data
                </label>
                <input
                  type="date"
                  value={retiradaData}
                  onChange={(e) => setRetiradaData(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.1] text-primary-foreground font-body text-[12.5px] focus:outline-none focus:border-gold/45 [color-scheme:dark]"
                />
              </div>
            </div>

            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setRetiradaOpen(false)}
                className="flex-1 py-2.5 rounded-xl bg-primary-foreground/[0.05] text-primary-foreground/75 font-body text-[12.5px] font-medium hover:bg-primary-foreground/[0.1] transition-all"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={retiradaSaving}
                onClick={async () => {
                  const val = parseCurrencyStr(retiradaValor);
                  if (!Number.isFinite(val) || val <= 0) {
                    toast.error("Informe um valor válido maior que zero");
                    return;
                  }
                  setRetiradaSaving(true);
                  try {
                    const payload = {
                      descricao: retiradaDesc.trim() || "Retirada de Comissão",
                      observacao: "Retirada de comissão pelo Caixa",
                      valor: val,
                      categoria: "Comissão",
                      tipo: "comissao",
                      data_vencimento: retiradaData,
                      data_pagamento: retiradaData,
                      pago: true,
                    };

                    if (!isSupabaseConfigured) {
                      const localRow: DespesaRow = {
                        ...payload,
                        id: globalThis.crypto?.randomUUID?.() || `com-${Date.now()}`,
                      };
                      const next = [localRow, ...despesas];
                      setDespesas(next);
                      localStorage.setItem("studio_caixa_retiradas_preview", JSON.stringify(next));
                    } else {
                      const { error } = await (supabase.from as any)("despesas").insert([payload]);
                      if (error) throw error;
                      setRefreshTick((t) => t + 1);
                    }

                    toast.success(`Retirada de ${formatCurrency(val)} registrada no Caixa!`);
                    setRetiradaOpen(false);
                    onUpdate?.();
                  } catch (err: any) {
                    toast.error("Erro ao registrar retirada: " + (err?.message || ""));
                  } finally {
                    setRetiradaSaving(false);
                  }
                }}
                className="flex-[1.5] py-2.5 rounded-xl bg-emerald-500 text-charcoal font-body text-[13px] font-bold hover:bg-emerald-400 transition-all disabled:opacity-50"
              >
                {retiradaSaving ? "Registrando..." : "Confirmar Retirada"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default CaixaTab;
