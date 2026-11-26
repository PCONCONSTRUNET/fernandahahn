import { useState, useEffect, useMemo, useCallback } from "react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { parseCurrencyStr, formatCurrencyMask } from "@/lib/utils";
import { useConfirm } from "@/contexts/ConfirmContext";
import { LoadMoreButton } from "@/components/ui/load-more-button";
import {
  Search,
  X,
  Check,
  AlertTriangle,
  Clock,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  Repeat,
  BarChart3,
  PieChart as PieChartIcon,
  Pencil,
  Save,
  Building2,
  User,
  Wallet,
  Calendar,
  Table2,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
} from "recharts";
import PlusButton from "@/components/ui/plus-button";
import BinButton from "@/components/ui/bin-button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { notifyCaixaUpdated } from "@/lib/caixa";

type EscopoGasto = "estudio" | "pessoal";

interface GastoRecord {
  id: string;
  descricao: string;
  valor: number;
  data_vencimento: string;
  pago: boolean;
  data_pagamento: string | null;
  categoria: string;
  tipo: string;
  observacao: string | null;
  fixa?: boolean;
  recorrencia_id?: string | null;
  created_at: string;
}

const CATEGORIAS_ESTUDIO = [
  "Material / Insumos",
  "Aluguel",
  "Conta de Luz",
  "Conta de Água",
  "Internet",
  "Marketing",
  "Equipamentos",
  "Manutenção",
  "Limpeza",
  "Impostos / Taxas",
  "Outros",
];

const CATEGORIAS_PESSOAL = [
  "Mercado",
  "Alimentação",
  "Transporte / Gasolina",
  "Farmácia / Saúde",
  "Compras",
  "Lazer",
  "Casa",
  "Outros",
];

const ATALHOS_ESTUDIO = ["Agulhas / Tintas", "Aluguel", "Energia", "Internet", "Material", "Limpeza"];
const ATALHOS_PESSOAL = ["Mercado", "Almoço / Café", "Gasolina", "Farmácia", "Compras"];

const PALETTE = [
  "#eab308",
  "#ec4899",
  "#3b82f6",
  "#10b981",
  "#f97316",
  "#8b5cf6",
  "#06b6d4",
  "#f43f5e",
  "#84cc16",
  "#94a3b8",
];

const MONTHS_FULL = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

const getTodayLocalISO = () =>
  new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split("T")[0];

const getYesterdayLocalISO = () => {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];
};

const formatCurrency = (v: number) =>
  v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });

const formatDateShort = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });

const getEffectiveDate = (g: GastoRecord) =>
  (g.pago && g.data_pagamento) ? g.data_pagamento : g.data_vencimento;

const normalizeTipo = (tipo?: string | null): EscopoGasto =>
  tipo === "pessoal" ? "pessoal" : "estudio";

const GastosTab = () => {
  const { confirm } = useConfirm();
  const today = getTodayLocalISO();
  const yesterday = getYesterdayLocalISO();

  const [registros, setRegistros] = useState<GastoRecord[]>([]);
  const [loading, setLoading] = useState(true);

  // Navegação e filtros
  const [monthOffset, setMonthOffset] = useState(0);
  const [escopoFilter, setEscopoFilter] = useState<"todos" | EscopoGasto>("todos");
  const [statusFilter, setStatusFilter] = useState<"todos" | "pagos" | "pendentes">("todos");
  const [categoriaFilter, setCategoriaFilter] = useState<string>("Todas");
  const [search, setSearch] = useState("");
  const [visibleCount, setVisibleCount] = useState(15);

  useEffect(() => {
    setVisibleCount(15);
  }, [monthOffset, escopoFilter, statusFilter, categoriaFilter, search]);

  // Gráficos
  const [chartsOpen, setChartsOpen] = useState(true);
  const [chartView, setChartView] = useState<"diario" | "categoria">("diario");

  // Modal Criar / Editar
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<GastoRecord | null>(null);
  const [formTipo, setFormTipo] = useState<EscopoGasto>("estudio");
  const [formNome, setFormNome] = useState("");
  const [formValor, setFormValor] = useState("");
  const [formData, setFormData] = useState(today);
  const [formCategoria, setFormCategoria] = useState("Material / Insumos");
  const [formCatCustom, setFormCatCustom] = useState("");
  const [formPago, setFormPago] = useState(true);
  const [formObs, setFormObs] = useState("");
  const [formFixa, setFormFixa] = useState(false);
  const [showObsField, setShowObsField] = useState(false);
  const [saving, setSaving] = useState(false);

  const loadGastos = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setLoading(false);
      return;
    }
    try {
      const { data, error } = await (supabase.from as any)("despesas")
        .select("*")
        .neq("tipo", "comissao")
        .order("data_vencimento", { ascending: false })
        .limit(1500);

      if (error) {
        console.error("Erro ao carregar gastos:", error);
        toast.error("Não foi possível carregar os gastos");
      } else if (data) {
        setRegistros(data as GastoRecord[]);
      }
    } catch (err) {
      console.error("Erro ao carregar gastos:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadGastos();
    if (!isSupabaseConfigured) return;
    const channel = supabase
      .channel("gastos-despesas-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "despesas" }, () => {
        loadGastos();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [loadGastos]);

  // Mês selecionado
  const targetMonth = useMemo(() => {
    const d = new Date();
    d.setHours(12, 0, 0, 0);
    d.setDate(1);
    d.setMonth(d.getMonth() + monthOffset);
    return d;
  }, [monthOffset]);

  const targetYM = useMemo(() => {
    const y = targetMonth.getFullYear();
    const m = String(targetMonth.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }, [targetMonth]);

  // Registros do mês selecionado (usa data do pagamento quando pago, ou vencimento quando pendente)
  const registrosMes = useMemo(() => {
    return registros.filter((g) => getEffectiveDate(g)?.startsWith(targetYM));
  }, [registros, targetYM]);

  // Resumo geral do mês (KPIs)
  const resumoMes = useMemo(() => {
    let totalPago = 0;
    let totalEstudio = 0;
    let totalPessoal = 0;
    let totalPendente = 0;
    let countPendente = 0;
    let countAtrasada = 0;

    registrosMes.forEach((g) => {
      const val = Number(g.valor || 0);
      const tipo = normalizeTipo(g.tipo);
      if (g.pago) {
        totalPago += val;
        if (tipo === "estudio") totalEstudio += val;
        else totalPessoal += val;
      } else {
        totalPendente += val;
        countPendente++;
        if (g.data_vencimento < today) countAtrasada++;
      }
    });

    const totalGeral = totalPago + totalPendente;
    const pctEstudio = totalPago > 0 ? Math.round((totalEstudio / totalPago) * 100) : 0;
    const pctPessoal = totalPago > 0 ? 100 - pctEstudio : 0;

    return {
      totalGeral,
      totalPago,
      totalEstudio,
      totalPessoal,
      totalPendente,
      countPendente,
      countAtrasada,
      pctEstudio,
      pctPessoal,
    };
  }, [registrosMes, today]);

  // Contas atrasadas/pendentes globais até o fim do mês selecionado para destaque rápido
  const pendenciasAlerta = useMemo(() => {
    return registros
      .filter((g) => !g.pago && g.data_vencimento <= `${targetYM}-31`)
      .sort((a, b) => a.data_vencimento.localeCompare(b.data_vencimento));
  }, [registros, targetYM]);

  // Lista filtrada pelos controles
  const registrosFiltrados = useMemo(() => {
    const q = search.trim().toLowerCase();
    return registrosMes.filter((g) => {
      const tipo = normalizeTipo(g.tipo);
      if (escopoFilter !== "todos" && tipo !== escopoFilter) return false;
      if (statusFilter === "pagos" && !g.pago) return false;
      if (statusFilter === "pendentes" && g.pago) return false;
      if (categoriaFilter !== "Todas" && (g.categoria || "Outros") !== categoriaFilter) return false;
      if (q) {
        const matchDesc = (g.descricao || "").toLowerCase().includes(q);
        const matchCat = (g.categoria || "").toLowerCase().includes(q);
        const matchObs = (g.observacao || "").toLowerCase().includes(q);
        if (!matchDesc && !matchCat && !matchObs) return false;
      }
      return true;
    });
  }, [registrosMes, escopoFilter, statusFilter, categoriaFilter, search]);

  // Dados dos gráficos (refletem busca/escopo/status filtrados do mês)
  const chartDiario = useMemo(() => {
    const map = new Map<string, { dia: string; diaLabel: string; estudio: number; pessoal: number }>();
    registrosFiltrados.forEach((g) => {
      const dateStr = getEffectiveDate(g);
      if (!dateStr) return;
      const entry = map.get(dateStr) || {
        dia: dateStr,
        diaLabel: dateStr.slice(8, 10),
        estudio: 0,
        pessoal: 0,
      };
      if (normalizeTipo(g.tipo) === "estudio") entry.estudio += Number(g.valor || 0);
      else entry.pessoal += Number(g.valor || 0);
      map.set(dateStr, entry);
    });
    return Array.from(map.values()).sort((a, b) => a.dia.localeCompare(b.dia));
  }, [registrosFiltrados]);

  const chartCategorias = useMemo(() => {
    const map = new Map<string, number>();
    let soma = 0;
    registrosFiltrados.forEach((g) => {
      const cat = g.categoria || "Outros";
      const val = Number(g.valor || 0);
      map.set(cat, (map.get(cat) || 0) + val);
      soma += val;
    });
    return Array.from(map.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], idx) => ({
        name,
        value,
        fill: PALETTE[idx % PALETTE.length],
        pct: soma > 0 ? Math.round((value / soma) * 100) : 0,
      }));
  }, [registrosFiltrados]);

  // Ordenação e fatia progressiva (15 itens iniciais + "Ver mais")
  const registrosOrdenados = useMemo(
    () =>
      [...registrosFiltrados].sort(
        (a, b) =>
          getEffectiveDate(b).localeCompare(getEffectiveDate(a)) ||
          (b.created_at || "").localeCompare(a.created_at || "")
      ),
    [registrosFiltrados]
  );

  // Agrupamento por data para lista limpa
  const gruposPorDia = useMemo(() => {
    const map = new Map<string, GastoRecord[]>();
    const sorted = registrosOrdenados.slice(0, visibleCount);

    sorted.forEach((g) => {
      const dateKey = getEffectiveDate(g);
      const list = map.get(dateKey) || [];
      list.push(g);
      map.set(dateKey, list);
    });

    return Array.from(map.entries()).map(([data, itens]) => {
      let label = formatDateShort(data);
      if (data === today) label = `Hoje · ${label}`;
      else if (data === yesterday) label = `Ontem · ${label}`;
      return {
        data,
        label,
        totalDia: itens.reduce((s, it) => s + Number(it.valor || 0), 0),
        itens,
      };
    });
  }, [registrosOrdenados, visibleCount, today, yesterday]);

  const categoriasUsadas = useMemo(() => {
    const set = new Set<string>();
    registrosMes.forEach((g) => {
      if (g.categoria) set.add(g.categoria);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b, "pt-BR"));
  }, [registrosMes]);

  // Abrir modal para novo gasto
  const openCreateModal = (tipoInicial: EscopoGasto = "estudio") => {
    setEditingItem(null);
    setFormTipo(tipoInicial);
    setFormNome("");
    setFormValor("");
    setFormData(today);
    setFormCategoria(tipoInicial === "estudio" ? CATEGORIAS_ESTUDIO[0] : CATEGORIAS_PESSOAL[0]);
    setFormCatCustom("");
    setFormPago(true);
    setFormObs("");
    setFormFixa(false);
    setShowObsField(false);
    setModalOpen(true);
  };

  // Abrir modal para editar gasto existente
  const openEditModal = (g: GastoRecord) => {
    const tipo = normalizeTipo(g.tipo);
    const knownList = tipo === "estudio" ? CATEGORIAS_ESTUDIO : CATEGORIAS_PESSOAL;
    const isKnown = knownList.includes(g.categoria);
    setEditingItem(g);
    setFormTipo(tipo);
    setFormNome(g.descricao || "");
    setFormValor(
      Number(g.valor || 0).toLocaleString("pt-BR", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    );
    setFormData(getEffectiveDate(g) || today);
    setFormCategoria(isKnown ? g.categoria : "__custom__");
    setFormCatCustom(isKnown ? "" : g.categoria || "");
    setFormPago(Boolean(g.pago));
    setFormObs(g.observacao || "");
    setFormFixa(Boolean(g.fixa));
    setShowObsField(Boolean(g.observacao && g.observacao.trim()));
    setModalOpen(true);
  };

  const handleTipoChange = (novoTipo: EscopoGasto) => {
    setFormTipo(novoTipo);
    if (!editingItem && formCategoria !== "__custom__") {
      setFormCategoria(novoTipo === "estudio" ? CATEGORIAS_ESTUDIO[0] : CATEGORIAS_PESSOAL[0]);
    }
  };

  const handleSave = async () => {
    if (!formNome.trim()) {
      toast.error("Digite o nome do gasto");
      return;
    }
    const valorNum = parseCurrencyStr(formValor);
    if (!Number.isFinite(valorNum) || valorNum <= 0) {
      toast.error("Informe um valor válido maior que zero");
      return;
    }
    if (!formData) {
      toast.error("Selecione a data");
      return;
    }

    const finalCat =
      formCategoria === "__custom__"
        ? formCatCustom.trim() || "Outros"
        : formCategoria || "Outros";

    setSaving(true);
    try {
      if (editingItem) {
        const updatePayload = {
          descricao: formNome.trim(),
          valor: valorNum,
          categoria: finalCat,
          tipo: formTipo,
          data_vencimento: formData,
          pago: formPago,
          data_pagamento: formPago ? formData : null,
          observacao: formObs.trim() || null,
          updated_at: new Date().toISOString(),
        };

        if (!isSupabaseConfigured) {
          setRegistros((prev) =>
            prev.map((it) => (it.id === editingItem.id ? { ...it, ...updatePayload } : it))
          );
          toast.success(
            formPago
              ? "Gasto atualizado e contabilizado no Caixa!"
              : "Gasto atualizado (a pagar)"
          );
          setModalOpen(false);
          return;
        }

        const { error } = await (supabase.from as any)("despesas")
          .update(updatePayload)
          .eq("id", editingItem.id);
        if (error) throw error;

        toast.success(
          formPago
            ? "Gasto atualizado e contabilizado no Caixa!"
            : "Gasto atualizado (a pagar)"
        );
      } else {
        const RECORRENCIA_MENSAL_MESES = 12;
        const isRecorrente = formFixa;
        const totalParcelas = isRecorrente ? RECORRENCIA_MENSAL_MESES : 1;
        const recorrenciaId = isRecorrente
          ? crypto.randomUUID?.() || `${Date.now()}-${Math.random()}`
          : null;
        const [yy, mm, dd] = formData.split("-").map(Number);

        const rows = Array.from({ length: totalParcelas }, (_, i) => {
          const base = new Date(yy, mm - 1 + i, 1);
          const ultimoDia = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
          const dia = Math.min(dd, ultimoDia);
          const dateISO = `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
          const isPaid = i === 0 ? formPago : false;

          return {
            descricao: formNome.trim(),
            valor: valorNum,
            categoria: finalCat,
            tipo: formTipo,
            data_vencimento: dateISO,
            pago: isPaid,
            data_pagamento: isPaid ? dateISO : null,
            observacao: formObs.trim() || null,
            fixa: isRecorrente,
            recorrencia_id: recorrenciaId,
          };
        });

        if (!isSupabaseConfigured) {
          const nowIso = new Date().toISOString();
          const localRows: GastoRecord[] = rows.map((row, idx) => ({
            ...row,
            id: crypto.randomUUID?.() || `local-${Date.now()}-${idx}`,
            created_at: nowIso,
          }));
          setRegistros((prev) => [...localRows, ...prev]);
          if (isRecorrente) {
            toast.success("Conta fixa registrada! Ela se repetirá automaticamente todo mês.");
          } else if (formPago) {
            toast.success(
              `Gasto (${formTipo === "estudio" ? "Estúdio" : "Pessoal"}) salvo!`
            );
          } else {
            toast.success("Conta agendada em A Pagar!");
          }
          setModalOpen(false);
          return;
        }

        const { error } = await (supabase.from as any)("despesas").insert(rows);
        if (error) throw error;

        if (isRecorrente) {
          toast.success(
            formPago
              ? "Conta fixa paga este mês e agendada automaticamente para os próximos meses!"
              : "Conta fixa registrada! Ela se repetirá automaticamente todo mês."
          );
        } else if (formPago) {
          toast.success(
            `Gasto (${formTipo === "estudio" ? "Estúdio" : "Pessoal"}) salvo e contabilizado no Caixa!`
          );
        } else {
          toast.success("Conta agendada em A Pagar!");
        }
      }

      setModalOpen(false);
      notifyCaixaUpdated();
      await loadGastos();
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao salvar gasto: " + (err.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const togglePago = async (g: GastoRecord) => {
    const novoPago = !g.pago;
    const novaDataPag = novoPago ? today : null;
    if (isSupabaseConfigured) {
      const { error } = await (supabase.from as any)("despesas")
        .update({ pago: novoPago, data_pagamento: novaDataPag, updated_at: new Date().toISOString() })
        .eq("id", g.id);

      if (error) {
        toast.error("Erro ao atualizar pagamento");
        return;
      }
    }

    setRegistros((prev) =>
      prev.map((item) =>
        item.id === g.id ? { ...item, pago: novoPago, data_pagamento: novaDataPag } : item
      )
    );
    notifyCaixaUpdated();
    toast.success(
      novoPago ? "Pago! Valor já contabilizado no Caixa." : "Marcado como A Pagar."
    );
  };

  const handleDelete = (g: GastoRecord) => {
    const temSerie = Boolean(g.recorrencia_id);
    confirm({
      title: "Remover Gasto",
      description: temSerie
        ? `Deseja excluir "${g.descricao}" (${formatCurrency(Number(g.valor))})? Essa ação também remove o impacto no Caixa.`
        : `Tem certeza que deseja excluir "${g.descricao}" (${formatCurrency(Number(g.valor))})?`,
      variant: "destructive",
      confirmText: "Remover este",
      onConfirm: async () => {
        if (isSupabaseConfigured) {
          const { error } = await (supabase.from as any)("despesas").delete().eq("id", g.id);
          if (error) {
            toast.error("Erro ao remover gasto");
            return;
          }
        }
        setRegistros((prev) => prev.filter((item) => item.id !== g.id));
        notifyCaixaUpdated();
        toast.success("Gasto removido");
      },
    });
  };

  const handleDeleteSerie = (recorrenciaId: string) => {
    confirm({
      title: "Excluir toda a recorrência?",
      description: "Isso removerá todas as parcelas mensais vinculadas a esta conta.",
      variant: "destructive",
      confirmText: "Excluir todas",
      onConfirm: async () => {
        if (isSupabaseConfigured) {
          const { error } = await (supabase.from as any)("despesas")
            .delete()
            .eq("recorrencia_id", recorrenciaId);
          if (error) {
            toast.error("Erro ao remover recorrência");
            return;
          }
        }
        setRegistros((prev) => prev.filter((item) => item.recorrencia_id !== recorrenciaId));
        notifyCaixaUpdated();
        toast.success("Parcelas removidas");
      },
    });
  };

  const exportCSV = () => {
    const header = "Data,Nome do Gasto,Tipo,Categoria,Valor,Status,Observacao\n";
    const rows = registrosFiltrados
      .map((g) => {
        const tipoLabel = normalizeTipo(g.tipo) === "estudio" ? "Estúdio" : "Pessoal";
        const statusLabel = g.pago ? "Pago (No Caixa)" : "A Pagar";
        return `${getEffectiveDate(g)},"${(g.descricao || "").replace(/"/g, '""')}","${tipoLabel}","${g.categoria || "Outros"}",${Number(g.valor).toFixed(2)},"${statusLabel}","${(g.observacao || "").replace(/"/g, '""')}"`;
      })
      .join("\n");
    const blob = new Blob(["\uFEFF" + header + rows], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `gastos_${targetYM}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const monthLabel = `${MONTHS_FULL[targetMonth.getMonth()]} ${targetMonth.getFullYear()}`;
  const categoriasDoForm = formTipo === "estudio" ? CATEGORIAS_ESTUDIO : CATEGORIAS_PESSOAL;
  const atalhosDoForm = formTipo === "estudio" ? ATALHOS_ESTUDIO : ATALHOS_PESSOAL;

  if (loading) {
    return (
      <div className="py-12 text-center font-body text-[13px] text-primary-foreground/45">
        Carregando gastos...
      </div>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Cabeçalho */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2.5">
            <h2 className="font-heading text-xl font-semibold text-primary-foreground">Gastos</h2>
            <PlusButton size={28} title="Registrar novo gasto" onClick={() => openCreateModal("estudio")} />
          </div>
          <p className="font-body text-[11px] text-primary-foreground/55 mt-0.5">
            Registre gastos do Estúdio ou Pessoais · contabiliza direto no Caixa
          </p>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {registrosFiltrados.length > 0 && (
            <button
              type="button"
              onClick={exportCSV}
              title="Exportar planilha do mês"
              className="w-9 h-9 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.08] text-primary-foreground/70 hover:text-green-400 hover:border-green-500/30 flex items-center justify-center transition-all"
            >
              <Table2 className="w-4 h-4" />
            </button>
          )}
          <button
            type="button"
            onClick={() => openCreateModal("estudio")}
            className="px-3.5 py-2 rounded-xl bg-gradient-to-br from-rose to-rose/80 text-primary-foreground font-body text-[12px] font-semibold shadow-[0_4px_18px_-4px_hsl(340_40%_50%/0.5)] hover:brightness-110 transition-all"
          >
            + Novo Gasto
          </button>
        </div>
      </div>

      {/* Navegador de mês */}
      <div className="flex items-center justify-between gap-2 p-2 rounded-2xl bg-primary-foreground/[0.03] border border-primary-foreground/[0.07]">
        <button
          type="button"
          onClick={() => setMonthOffset((m) => m - 1)}
          aria-label="Mês anterior"
          className="w-9 h-9 rounded-xl hover:bg-primary-foreground/[0.06] flex items-center justify-center text-primary-foreground/80 transition-all"
        >
          <ChevronLeft className="w-4 h-4" />
        </button>

        <div className="flex items-center gap-2">
          <Calendar className="w-3.5 h-3.5 text-gold/80" />
          <span className="font-heading text-[15px] font-semibold text-primary-foreground capitalize">
            {monthLabel}
          </span>
          {monthOffset !== 0 && (
            <button
              type="button"
              onClick={() => setMonthOffset(0)}
              className="px-2 py-0.5 rounded-full bg-gold/15 text-gold border border-gold/25 font-body text-[10px] font-semibold hover:bg-gold/25 transition-all"
            >
              Mês atual
            </button>
          )}
        </div>

        <button
          type="button"
          onClick={() => setMonthOffset((m) => m + 1)}
          aria-label="Próximo mês"
          className="w-9 h-9 rounded-xl hover:bg-primary-foreground/[0.06] flex items-center justify-center text-primary-foreground/80 transition-all"
        >
          <ChevronRight className="w-4 h-4" />
        </button>
      </div>

      {/* Card Principal + KPIs */}
      <div className="relative overflow-hidden rounded-3xl border border-gold/20 bg-gradient-to-br from-charcoal via-charcoal to-[hsl(340_18%_13%)] p-5 shadow-xl space-y-4">
        <div className="pointer-events-none absolute -top-20 -right-16 w-48 h-48 rounded-full bg-rose/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-16 w-44 h-44 rounded-full bg-gold/10 blur-3xl" />

        <div className="relative flex items-center justify-between gap-4">
          <div>
            <p className="font-body text-[10px] uppercase tracking-[0.22em] text-primary-foreground/65 flex items-center gap-1.5">
              <Wallet className="w-3 h-3 text-rose" /> Total Pago (Contabilizado no Caixa)
            </p>
            <p className="font-heading text-3xl sm:text-4xl font-bold text-primary-foreground tabular-nums mt-1">
              {formatCurrency(resumoMes.totalPago)}
            </p>
            {resumoMes.totalPendente > 0 && (
              <p className="font-body text-[11px] text-amber-300/90 mt-0.5">
                + {formatCurrency(resumoMes.totalPendente)} em aberto para pagar
              </p>
            )}
          </div>

          <button
            type="button"
            onClick={() => setChartsOpen((v) => !v)}
            className="px-3 py-2 rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.08] hover:border-gold/30 text-primary-foreground/85 font-body text-[11px] font-medium flex items-center gap-1.5 transition-all shrink-0"
          >
            <BarChart3 className="w-3.5 h-3.5 text-gold" />
            Gráficos
            {chartsOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>

        {/* Barra comparativa Estúdio vs Pessoal */}
        {resumoMes.totalPago > 0 && (
          <div className="relative space-y-1.5">
            <div className="flex items-center justify-between font-body text-[10px] text-primary-foreground/75">
              <span className="flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                Estúdio ({resumoMes.pctEstudio}%)
              </span>
              <span className="flex items-center gap-1.5">
                Pessoal ({resumoMes.pctPessoal}%)
                <span className="w-2 h-2 rounded-full bg-pink-400" />
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-primary-foreground/[0.08] overflow-hidden flex gap-0.5">
              {resumoMes.pctEstudio > 0 && (
                <div
                  className="h-full bg-gradient-to-r from-amber-400 to-gold transition-all duration-700"
                  style={{ width: `${resumoMes.pctEstudio}%` }}
                />
              )}
              {resumoMes.pctPessoal > 0 && (
                <div
                  className="h-full bg-gradient-to-r from-pink-500 to-rose transition-all duration-700"
                  style={{ width: `${resumoMes.pctPessoal}%` }}
                />
              )}
            </div>
          </div>
        )}

        {/* 3 Sub-cards */}
        <div className="relative grid grid-cols-3 gap-2">
          <button
            type="button"
            onClick={() => setEscopoFilter(escopoFilter === "estudio" ? "todos" : "estudio")}
            className={`text-left p-3 rounded-2xl border transition-all ${
              escopoFilter === "estudio"
                ? "bg-amber-500/15 border-amber-400/45"
                : "bg-amber-500/[0.06] border-amber-500/15 hover:border-amber-400/30"
            }`}
          >
            <p className="font-body text-[9px] uppercase tracking-wider text-amber-300/80 flex items-center gap-1">
              <Building2 className="w-3 h-3" /> Estúdio
            </p>
            <p className="font-heading text-[15px] font-bold text-amber-300 tabular-nums mt-1">
              {formatCurrency(resumoMes.totalEstudio)}
            </p>
            <p className="font-body text-[9px] text-primary-foreground/55 mt-0.5">abate lucro</p>
          </button>

          <button
            type="button"
            onClick={() => setEscopoFilter(escopoFilter === "pessoal" ? "todos" : "pessoal")}
            className={`text-left p-3 rounded-2xl border transition-all ${
              escopoFilter === "pessoal"
                ? "bg-pink-500/15 border-pink-400/45"
                : "bg-pink-500/[0.06] border-pink-500/15 hover:border-pink-400/30"
            }`}
          >
            <p className="font-body text-[9px] uppercase tracking-wider text-pink-300/80 flex items-center gap-1">
              <User className="w-3 h-3" /> Pessoal
            </p>
            <p className="font-heading text-[15px] font-bold text-pink-300 tabular-nums mt-1">
              {formatCurrency(resumoMes.totalPessoal)}
            </p>
            <p className="font-body text-[9px] text-primary-foreground/55 mt-0.5">sai do caixa</p>
          </button>

          <button
            type="button"
            onClick={() => setStatusFilter(statusFilter === "pendentes" ? "todos" : "pendentes")}
            className={`text-left p-3 rounded-2xl border transition-all ${
              statusFilter === "pendentes"
                ? "bg-orange-500/15 border-orange-400/45"
                : "bg-primary-foreground/[0.03] border-primary-foreground/[0.08] hover:border-orange-400/30"
            }`}
          >
            <p className="font-body text-[9px] uppercase tracking-wider text-orange-300/80 flex items-center gap-1">
              <Clock className="w-3 h-3" /> A Pagar
            </p>
            <p className="font-heading text-[15px] font-bold text-orange-300 tabular-nums mt-1">
              {formatCurrency(resumoMes.totalPendente)}
            </p>
            <p className="font-body text-[9px] text-primary-foreground/55 mt-0.5">
              {resumoMes.countAtrasada > 0
                ? `${resumoMes.countAtrasada} atrasada(s)`
                : `${resumoMes.countPendente} pendente(s)`}
            </p>
          </button>
        </div>
      </div>

      {/* Seção de Gráficos */}
      {chartsOpen && (
        <div className="rounded-3xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.025] p-4 sm:p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-gold" />
              <p className="font-body text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-foreground/80">
                Visão Gráfica do Mês
              </p>
            </div>
            <div className="flex p-0.5 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.07]">
              <button
                type="button"
                onClick={() => setChartView("diario")}
                className={`px-3 py-1.5 rounded-lg font-body text-[11px] font-medium flex items-center gap-1.5 transition-all ${
                  chartView === "diario"
                    ? "bg-gold/15 text-gold border border-gold/25"
                    : "text-primary-foreground/60 hover:text-primary-foreground"
                }`}
              >
                <BarChart3 className="w-3.5 h-3.5" /> Por Dia
              </button>
              <button
                type="button"
                onClick={() => setChartView("categoria")}
                className={`px-3 py-1.5 rounded-lg font-body text-[11px] font-medium flex items-center gap-1.5 transition-all ${
                  chartView === "categoria"
                    ? "bg-gold/15 text-gold border border-gold/25"
                    : "text-primary-foreground/60 hover:text-primary-foreground"
                }`}
              >
                <PieChartIcon className="w-3.5 h-3.5" /> Por Categoria
              </button>
            </div>
          </div>

          {registrosFiltrados.length === 0 ? (
            <div className="py-8 text-center rounded-2xl border border-dashed border-primary-foreground/[0.08]">
              <p className="font-body text-[12px] text-primary-foreground/50">
                Sem gastos neste filtro para gerar o gráfico
              </p>
            </div>
          ) : chartView === "diario" ? (
            <div className="space-y-2">
              <div className="h-[210px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartDiario} margin={{ top: 8, right: 6, left: -12, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="hsla(0 0% 100% / 0.05)" vertical={false} />
                    <XAxis
                      dataKey="diaLabel"
                      tick={{ fill: "hsla(0 0% 100% / 0.55)", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                    />
                    <YAxis
                      tick={{ fill: "hsla(0 0% 100% / 0.5)", fontSize: 10 }}
                      axisLine={false}
                      tickLine={false}
                      tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`)}
                    />
                    <Tooltip
                      cursor={{ fill: "hsla(0 0% 100% / 0.04)" }}
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const row = payload[0].payload;
                        return (
                          <div className="rounded-xl border border-gold/25 bg-charcoal/95 px-3 py-2 shadow-xl text-[11px] font-body space-y-1">
                            <p className="font-semibold text-primary-foreground">Dia {formatDateShort(row.dia)}</p>
                            {row.estudio > 0 && (
                              <p className="text-amber-300">Estúdio: {formatCurrency(row.estudio)}</p>
                            )}
                            {row.pessoal > 0 && (
                              <p className="text-pink-300">Pessoal: {formatCurrency(row.pessoal)}</p>
                            )}
                          </div>
                        );
                      }}
                    />
                    <Bar dataKey="estudio" name="Estúdio" stackId="a" fill="#eab308" radius={[0, 0, 4, 4]} />
                    <Bar dataKey="pessoal" name="Pessoal" stackId="a" fill="#ec4899" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-center gap-5 pt-1">
                <span className="flex items-center gap-1.5 font-body text-[11px] text-primary-foreground/75">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#eab308]" /> Do Estúdio
                </span>
                <span className="flex items-center gap-1.5 font-body text-[11px] text-primary-foreground/75">
                  <span className="w-2.5 h-2.5 rounded-sm bg-[#ec4899]" /> Pessoal
                </span>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div className="h-[190px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={chartCategorias}
                      cx="50%"
                      cy="50%"
                      innerRadius={48}
                      outerRadius={76}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                    >
                      {chartCategorias.map((entry) => (
                        <Cell key={entry.name} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload || payload.length === 0) return null;
                        const item = payload[0].payload;
                        return (
                          <div className="rounded-xl border border-gold/25 bg-charcoal/95 px-3 py-2 shadow-xl text-[11px] font-body">
                            <p className="font-semibold text-primary-foreground">{item.name}</p>
                            <p className="text-gold">{formatCurrency(item.value)} ({item.pct}%)</p>
                          </div>
                        );
                      }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="space-y-2 max-h-[190px] overflow-y-auto pr-1">
                {chartCategorias.map((cat) => (
                  <div key={cat.name} className="space-y-1">
                    <div className="flex items-center justify-between text-[11px] font-body">
                      <span className="flex items-center gap-1.5 text-primary-foreground/90 truncate">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: cat.fill }} />
                        <span className="truncate">{cat.name}</span>
                      </span>
                      <span className="font-heading font-semibold text-primary-foreground tabular-nums shrink-0 ml-2">
                        {formatCurrency(cat.value)} <span className="text-primary-foreground/50 text-[10px]">({cat.pct}%)</span>
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-primary-foreground/[0.06] overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all duration-500"
                        style={{ width: `${cat.pct}%`, backgroundColor: cat.fill }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Alerta rápido de Contas A Pagar / Atrasadas */}
      {pendenciasAlerta.length > 0 && statusFilter !== "pagos" && (
        <div className="rounded-2xl border border-orange-500/25 bg-orange-500/[0.06] p-3.5 space-y-2.5">
          <div className="flex items-center justify-between">
            <p className="font-body text-[11px] font-semibold uppercase tracking-wider text-orange-300 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5" /> Contas em aberto ({pendenciasAlerta.length})
            </p>
            <span className="font-heading text-[12px] font-bold text-orange-300 tabular-nums">
              {formatCurrency(pendenciasAlerta.reduce((s, p) => s + Number(p.valor || 0), 0))}
            </span>
          </div>
          <div className="space-y-1.5 max-h-[200px] overflow-y-auto pr-1">
            {pendenciasAlerta.map((p) => {
              const atrasada = p.data_vencimento < today;
              const venceHoje = p.data_vencimento === today;
              const isEstudio = normalizeTipo(p.tipo) === "estudio";
              return (
                <div
                  key={p.id}
                  className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-charcoal/70 border border-primary-foreground/[0.08]"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[9px] font-bold uppercase ${
                          isEstudio ? "bg-amber-500/20 text-amber-300" : "bg-pink-500/20 text-pink-300"
                        }`}
                      >
                        {isEstudio ? "Estúdio" : "Pessoal"}
                      </span>
                      <p className="font-body text-[12.5px] font-semibold text-primary-foreground truncate">
                        {p.descricao}
                      </p>
                    </div>
                    <p className={`font-body text-[10px] mt-0.5 ${atrasada ? "text-red-400 font-semibold" : venceHoje ? "text-amber-300" : "text-primary-foreground/55"}`}>
                      {atrasada ? "Atrasada · " : venceHoje ? "Vence hoje · " : "Vence em "}
                      {formatDateShort(p.data_vencimento)} · {p.categoria}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <span className="font-heading text-[12.5px] font-bold text-orange-300 tabular-nums">
                      {formatCurrency(Number(p.valor))}
                    </span>
                    <button
                      type="button"
                      onClick={() => togglePago(p)}
                      className="px-2.5 py-1.5 rounded-lg bg-green-500/20 hover:bg-green-500/30 border border-green-500/35 text-green-300 font-body text-[10px] font-semibold flex items-center gap-1 transition-all"
                    >
                      <Check className="w-3 h-3" /> Pagar
                    </button>
                    <button
                      type="button"
                      onClick={() => openEditModal(p)}
                      aria-label="Editar conta"
                      className="w-7 h-7 rounded-lg bg-primary-foreground/[0.05] hover:bg-gold/15 text-primary-foreground/70 hover:text-gold flex items-center justify-center transition-all"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Filtros & Busca */}
      <div className="space-y-2.5">
        <div className="relative">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-primary-foreground/45" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar gasto pelo nome ou categoria..."
            className="w-full pl-10 pr-9 py-2.5 rounded-2xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.08] text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/35 focus:outline-none focus:border-gold/40"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-primary-foreground/50 hover:text-primary-foreground"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: "todos", label: "Todos" },
              { id: "estudio", label: "Estúdio" },
              { id: "pessoal", label: "Pessoal" },
            ] as const
          ).map((f) => (
            <button
              key={f.id}
              type="button"
              onClick={() => setEscopoFilter(f.id)}
              className={`px-3 py-1.5 rounded-full font-body text-[11px] font-medium border transition-all ${
                escopoFilter === f.id
                  ? "bg-gold/15 text-gold border-gold/35"
                  : "bg-primary-foreground/[0.03] text-primary-foreground/60 border-primary-foreground/[0.07] hover:text-primary-foreground"
              }`}
            >
              {f.label}
            </button>
          ))}

          <span className="h-4 w-px bg-primary-foreground/10 mx-1" />

          {(
            [
              { id: "todos", label: "Todos status" },
              { id: "pagos", label: "Pagos (Caixa)" },
              { id: "pendentes", label: "A Pagar" },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setStatusFilter(s.id)}
              className={`px-3 py-1.5 rounded-full font-body text-[11px] font-medium border transition-all ${
                statusFilter === s.id
                  ? "bg-green-500/15 text-green-300 border-green-500/35"
                  : "bg-primary-foreground/[0.03] text-primary-foreground/60 border-primary-foreground/[0.07] hover:text-primary-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}

          {categoriasUsadas.length > 0 && (
            <select
              value={categoriaFilter}
              onChange={(e) => setCategoriaFilter(e.target.value)}
              className="ml-auto px-3 py-1.5 rounded-full bg-primary-foreground/[0.04] border border-primary-foreground/[0.08] font-body text-[11px] text-primary-foreground/80 focus:outline-none [&>option]:bg-charcoal"
            >
              <option value="Todas">Todas categorias</option>
              {categoriasUsadas.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>

      {/* Lista de Gastos agrupada por dia */}
      {gruposPorDia.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-primary-foreground/[0.1] bg-primary-foreground/[0.02] py-12 px-4 text-center space-y-3">
          <p className="font-body text-[13px] text-primary-foreground/65">
            Nenhum gasto encontrado em {monthLabel}.
          </p>
          <button
            type="button"
            onClick={() => openCreateModal("estudio")}
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gold/15 border border-gold/30 text-gold font-body text-[12px] font-semibold hover:bg-gold/25 transition-all"
          >
            + Registrar primeiro gasto
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {gruposPorDia.map((grupo) => (
            <div key={grupo.data} className="space-y-1.5">
              <div className="flex items-center justify-between px-1">
                <p className="font-body text-[11px] font-semibold uppercase tracking-[0.16em] text-primary-foreground/55">
                  {grupo.label}
                </p>
                <span className="font-heading text-[12px] font-bold text-primary-foreground/75 tabular-nums">
                  {formatCurrency(grupo.totalDia)}
                </span>
              </div>

              <div className="space-y-1.5">
                {grupo.itens.map((g) => {
                  const isEstudio = normalizeTipo(g.tipo) === "estudio";
                  const atrasada = !g.pago && g.data_vencimento < today;
                  return (
                    <div
                      key={g.id}
                      className="flex items-center justify-between gap-2.5 p-3 rounded-2xl bg-primary-foreground/[0.03] border border-primary-foreground/[0.07] hover:border-gold/25 transition-all"
                    >
                      <button
                        type="button"
                        onClick={() => togglePago(g)}
                        title={g.pago ? "Clique para marcar como A Pagar" : "Clique para pagar e lançar no Caixa"}
                        className={`w-7 h-7 rounded-xl border flex items-center justify-center shrink-0 transition-all ${
                          g.pago
                            ? "bg-green-500/20 border-green-500/40 text-green-400"
                            : "bg-primary-foreground/[0.04] border-primary-foreground/20 text-primary-foreground/40 hover:border-green-400/50 hover:text-green-300"
                        }`}
                      >
                        {g.pago ? <Check className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                      </button>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span
                            className={`px-1.5 py-0.5 rounded-md text-[9px] font-bold uppercase tracking-wider ${
                              isEstudio
                                ? "bg-amber-500/15 text-amber-300 border border-amber-500/25"
                                : "bg-pink-500/15 text-pink-300 border border-pink-500/25"
                            }`}
                          >
                            {isEstudio ? "Estúdio" : "Pessoal"}
                          </span>
                          <p className="font-body text-[13.5px] font-semibold text-primary-foreground truncate">
                            {g.descricao}
                          </p>
                          {g.fixa && (
                            <span title="Gasto fixo mensal" className="text-gold/70">
                              <Repeat className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                        <p className="font-body text-[10.5px] text-primary-foreground/55 truncate mt-0.5">
                          {g.categoria || "Outros"} ·{" "}
                          {g.pago ? (
                            <span className="text-green-400/85">Contabilizado no Caixa</span>
                          ) : atrasada ? (
                            <span className="text-red-400 font-medium">Atrasada</span>
                          ) : (
                            <span className="text-orange-300/85">A pagar</span>
                          )}
                          {g.observacao ? ` · ${g.observacao}` : ""}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <p
                          className={`font-heading text-[14px] font-bold tabular-nums mr-1 ${
                            g.pago ? "text-rose" : "text-orange-300"
                          }`}
                        >
                          - {formatCurrency(Number(g.valor))}
                        </p>

                        <button
                          type="button"
                          onClick={() => openEditModal(g)}
                          title="Editar gasto"
                          aria-label="Editar gasto"
                          className="w-8 h-8 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.08] text-primary-foreground/65 hover:text-gold hover:border-gold/30 flex items-center justify-center transition-all"
                        >
                          <Pencil className="w-3.5 h-3.5" />
                        </button>

                        <BinButton size="sm" onClick={() => handleDelete(g)} />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

          <LoadMoreButton
            visibleCount={visibleCount}
            totalCount={registrosOrdenados.length}
            step={15}
            onLoadMore={() => setVisibleCount((c) => c + 15)}
            itemLabel="gastos"
          />
        </div>
      )}

      {/* Modal Criar / Editar Gasto */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-[400px] w-[calc(100vw-1.5rem)] max-h-[88dvh] flex flex-col gap-0 rounded-3xl bg-charcoal border-primary-foreground/[0.12] p-0 overflow-hidden shadow-2xl">
          <DialogHeader className="shrink-0 px-4 pt-4 pb-2.5 border-b border-primary-foreground/[0.08] text-left">
            <DialogTitle className="font-heading text-[16px] font-semibold text-primary-foreground">
              {editingItem ? "Editar Gasto" : "Novo Gasto"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 px-4 py-3 space-y-2.5 overflow-y-auto scrollbar-hide">
            {/* 1. Pessoal ou Estúdio */}
            <div className="space-y-1">
              <label className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/60 font-semibold block">
                Esse gasto é:
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => handleTipoChange("estudio")}
                  className={`py-2 px-2.5 rounded-xl border text-left transition-all ${
                    formTipo === "estudio"
                      ? "bg-amber-500/15 border-amber-400/50 text-amber-200 shadow-[0_0_16px_-8px_rgba(245,158,11,0.45)]"
                      : "bg-primary-foreground/[0.03] border-primary-foreground/[0.08] text-primary-foreground/65 hover:text-primary-foreground"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-body text-[12.5px] font-semibold leading-none">
                    <Building2 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>Do Estúdio</span>
                  </div>
                  <p className="font-body text-[10px] opacity-75 mt-1 leading-none truncate">
                    Abate lucro do estúdio
                  </p>
                </button>

                <button
                  type="button"
                  onClick={() => handleTipoChange("pessoal")}
                  className={`py-2 px-2.5 rounded-xl border text-left transition-all ${
                    formTipo === "pessoal"
                      ? "bg-pink-500/15 border-pink-400/50 text-pink-200 shadow-[0_0_16px_-8px_rgba(236,72,153,0.45)]"
                      : "bg-primary-foreground/[0.03] border-primary-foreground/[0.08] text-primary-foreground/65 hover:text-primary-foreground"
                  }`}
                >
                  <div className="flex items-center gap-1.5 font-body text-[12.5px] font-semibold leading-none">
                    <User className="w-3.5 h-3.5 text-pink-400 shrink-0" />
                    <span>Pessoal</span>
                  </div>
                  <p className="font-body text-[10px] opacity-75 mt-1 leading-none truncate">
                    Sai apenas no Caixa
                  </p>
                </button>
              </div>
            </div>

            {/* 2. Nome do gasto + atalhos em linha única deslizável */}
            <div className="space-y-1">
              <label className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/60 font-semibold block">
                Nome do gasto *
              </label>
              <input
                type="text"
                value={formNome}
                onChange={(e) => setFormNome(e.target.value)}
                placeholder={
                  formTipo === "estudio"
                    ? "Ex: Agulhas, Tintas, Aluguel, Luz..."
                    : "Ex: Mercado, Almoço, Gasolina..."
                }
                autoFocus
                className="w-full px-3 py-2 rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.1] text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/35 focus:outline-none focus:border-gold/50"
              />
              {!editingItem && (
                <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-hide pt-0.5">
                  {atalhosDoForm.map((atalho) => (
                    <button
                      key={atalho}
                      type="button"
                      onClick={() => setFormNome(atalho)}
                      className="px-2 py-0.5 rounded-full bg-primary-foreground/[0.04] hover:bg-gold/15 border border-primary-foreground/[0.08] text-[10.5px] font-body text-primary-foreground/70 hover:text-gold whitespace-nowrap shrink-0 transition-all"
                    >
                      + {atalho}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* 3. Valor e Data */}
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <label className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/60 font-semibold block">
                  Valor (R$) *
                </label>
                <div className="relative">
                  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 font-heading text-[12.5px] text-primary-foreground/50">
                    R$
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formValor}
                    onChange={(e) => setFormValor(formatCurrencyMask(e.target.value))}
                    placeholder="0,00"
                    className="w-full pl-8 pr-2.5 py-2 rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.1] text-primary-foreground font-heading text-[14.5px] font-bold tabular-nums focus:outline-none focus:border-gold/50"
                  />
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/60 font-semibold block">
                  Data *
                </label>
                <input
                  type="date"
                  value={formData}
                  onChange={(e) => setFormData(e.target.value)}
                  className="w-full px-2.5 py-2 rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.1] text-primary-foreground font-body text-[12.5px] [color-scheme:dark] focus:outline-none focus:border-gold/50"
                />
              </div>
            </div>

            {/* 4. Categoria */}
            <div className="space-y-1">
              <label className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/60 font-semibold block">
                Categoria
              </label>
              <select
                value={formCategoria}
                onChange={(e) => setFormCategoria(e.target.value)}
                className="w-full px-3 py-2 rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.1] text-primary-foreground font-body text-[12.5px] focus:outline-none focus:border-gold/50 [&>option]:bg-charcoal"
              >
                {categoriasDoForm.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
                <option value="__custom__">Outra categoria (digitar)...</option>
              </select>
              {formCategoria === "__custom__" && (
                <input
                  type="text"
                  value={formCatCustom}
                  onChange={(e) => setFormCatCustom(e.target.value)}
                  placeholder="Digite o nome da categoria"
                  className="w-full mt-1 px-3 py-2 rounded-xl bg-primary-foreground/[0.05] border border-gold/30 text-primary-foreground font-body text-[12.5px] focus:outline-none"
                />
              )}
            </div>

            {/* 5. Situação + Conta fixa */}
            <div className="space-y-2">
              <label className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/60 font-semibold block">
                Situação do pagamento
              </label>
              <div className="grid grid-cols-2 gap-1.5">
                <button
                  type="button"
                  onClick={() => setFormPago(true)}
                  className={`py-2 px-2.5 rounded-xl border font-body text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-all ${
                    formPago
                      ? "bg-green-500/15 border-green-500/40 text-green-300"
                      : "bg-primary-foreground/[0.03] border-primary-foreground/[0.08] text-primary-foreground/60"
                  }`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> Já foi pago
                </button>
                <button
                  type="button"
                  onClick={() => setFormPago(false)}
                  className={`py-2 px-2.5 rounded-xl border font-body text-[12px] font-semibold flex items-center justify-center gap-1.5 transition-all ${
                    !formPago
                      ? "bg-orange-500/15 border-orange-500/40 text-orange-300"
                      : "bg-primary-foreground/[0.03] border-primary-foreground/[0.08] text-primary-foreground/60"
                  }`}
                >
                  <Clock className="w-3.5 h-3.5 shrink-0" /> Pagar depois
                </button>
              </div>

              {!editingItem && (
                <div className="rounded-xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.025] px-3 py-2 space-y-1">
                  <button
                    type="button"
                    role="switch"
                    aria-checked={formFixa}
                    onClick={() => setFormFixa((v) => !v)}
                    className="w-full flex items-center justify-between gap-2 text-left"
                  >
                    <span className="font-body text-[12px] text-primary-foreground/85 flex items-center gap-1.5">
                      <Repeat className="w-3.5 h-3.5 text-gold shrink-0" /> Conta fixa todo mês
                    </span>
                    <span
                      className={`w-9 h-5 rounded-full p-0.5 transition-colors flex items-center shrink-0 ${
                        formFixa ? "bg-gold justify-end" : "bg-primary-foreground/15 justify-start"
                      }`}
                    >
                      <span className="w-4 h-4 rounded-full bg-charcoal shadow-sm" />
                    </span>
                  </button>
                  {formFixa && (
                    <p className="font-body text-[10px] text-gold/80 leading-snug">
                      {formPago
                        ? "Pago este mês e agendado automaticamente para os próximos 11 meses."
                        : "Agendado automaticamente para os próximos 12 meses."}
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* 6. Observação opcional (expansível sob demanda para economizar espaço no mobile) */}
            {showObsField || formObs.trim() ? (
              <div className="space-y-1">
                <label className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/60 font-semibold block">
                  Observação <span className="normal-case font-normal text-primary-foreground/40">(opcional)</span>
                </label>
                <input
                  type="text"
                  value={formObs}
                  onChange={(e) => setFormObs(e.target.value)}
                  placeholder="Ex: Pago no PIX, fornecedor..."
                  className="w-full px-3 py-2 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.08] text-primary-foreground font-body text-[12.5px] placeholder:text-primary-foreground/30 focus:outline-none focus:border-gold/40"
                />
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowObsField(true)}
                className="font-body text-[11px] font-medium text-primary-foreground/55 hover:text-gold transition-colors py-0.5"
              >
                + Adicionar observação (opcional)
              </button>
            )}
          </div>

          {/* Rodapé fixo e compacto */}
          <div className="shrink-0 px-4 py-3 border-t border-primary-foreground/[0.08] bg-charcoal flex items-center gap-2">
            {editingItem?.recorrencia_id && (
              <button
                type="button"
                onClick={() => {
                  setModalOpen(false);
                  handleDeleteSerie(editingItem.recorrencia_id!);
                }}
                className="px-3 py-2.5 rounded-xl bg-rose/10 border border-rose/25 text-rose font-body text-[11px] font-semibold hover:bg-rose/20 transition-all"
              >
                Excluir série
              </button>
            )}
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="flex-1 py-2.5 rounded-xl bg-primary-foreground/[0.05] text-primary-foreground/75 font-body text-[12.5px] font-medium hover:bg-primary-foreground/[0.1] transition-all"
            >
              Cancelar
            </button>
            <button
              type="button"
              disabled={saving}
              onClick={handleSave}
              className="flex-[1.5] py-2.5 rounded-xl bg-gradient-to-br from-gold to-nude text-charcoal font-body text-[13px] font-bold flex items-center justify-center gap-1.5 hover:brightness-105 transition-all disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {saving ? "Salvando..." : editingItem ? "Salvar Alterações" : "Registrar Gasto"}
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default GastosTab;
