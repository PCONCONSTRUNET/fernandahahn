import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import {
  Sparkles,
  Plus,
  Search,
  X,
  Edit2,
  Trash2,
  Clock,
  Folder,
  ChevronUp,
  ChevronDown,
  Save,
  Eye,
  EyeOff,
} from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import { formatCurrencyMask, formatCurrencyValue, parseCurrencyStr } from "@/lib/utils";
import { useConfirm } from "@/contexts/ConfirmContext";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export interface ServicoItem {
  id: string;
  name: string;
  price: number;
  category: string;
  active: boolean;
  duration: number;
  descricao: string;
}

interface ServicosTabProps {
  tableName?: "servicos_app";
  storageKey?: string;
}

const DURACAO_PRESETS = [
  { label: "30m", value: 30 },
  { label: "1h", value: 60 },
  { label: "1h30", value: 90 },
  { label: "2h", value: 120 },
  { label: "3h", value: 180 },
];

const formatDurationLabel = (mins: number) => {
  if (!mins) return "1h";
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h > 0 && m > 0) return `${h}h${String(m).padStart(2, "0")}`;
  if (h > 0) return `${h}h`;
  return `${m} min`;
};

const formatBRL = (val: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);

/**
 * Aba Serviços simplificada: gestão direta de procedimentos, categorias, preços e duração.
 */
const ServicosTab = ({
  tableName = "servicos_app",
  storageKey = "admin_custom_categorias_servicos_app",
}: ServicosTabProps = {}) => {
  const { confirm } = useConfirm();
  const SERVICES_PREVIEW_KEY = `admin_servicos_preview_${tableName}`;

  const [services, setServices] = useState<ServicoItem[]>([]);
  const [extraCategorias, setExtraCategorias] = useState<string[]>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      return raw ? JSON.parse(raw) : [];
    } catch {
      return [];
    }
  });
  const [loading, setLoading] = useState(true);
  const [filtroCat, setFiltroCat] = useState<string>("todas");
  const [busca, setBusca] = useState("");
  const [ordemCategorias, setOrdemCategorias] = useState<string[]>([]);

  // Modal unificado (Criar / Editar serviço)
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<ServicoItem | null>(null);
  const [formName, setFormName] = useState("");
  const [formPrice, setFormPrice] = useState("");
  const [formDuration, setFormDuration] = useState("60");
  const [formCategory, setFormCategory] = useState("");
  const [formNewCategory, setFormNewCategory] = useState("");
  const [creatingCatInline, setCreatingCatInline] = useState(false);
  const [formDescricao, setFormDescricao] = useState("");
  const [saving, setSaving] = useState(false);

  // Modal compacto de gerenciar categorias
  const [manageCatsOpen, setManageCatsOpen] = useState(false);
  const [novaCatInput, setNovaCatInput] = useState("");
  const [renomeandoCat, setRenomeandoCat] = useState<string | null>(null);
  const [renomeCatValor, setRenomeCatValor] = useState("");

  const persistExtras = (lista: string[]) => {
    setExtraCategorias(lista);
    try {
      localStorage.setItem(storageKey, JSON.stringify(lista));
    } catch {
      /* ignore */
    }
  };

  const persistPreviewServices = (lista: ServicoItem[]) => {
    try {
      localStorage.setItem(SERVICES_PREVIEW_KEY, JSON.stringify(lista));
    } catch {
      /* ignore */
    }
  };

  const reloadOrdemCategorias = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    try {
      const { data } = await supabase
        .from("categorias_ordem")
        .select("nome, ordem")
        .eq("scope", tableName)
        .order("ordem");
      if (data) setOrdemCategorias(data.map((r: any) => r.nome));
    } catch {
      /* ignore */
    }
  }, [tableName]);

  const reloadServicos = useCallback(async () => {
    if (!isSupabaseConfigured) {
      try {
        const raw = localStorage.getItem(SERVICES_PREVIEW_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed)) setServices(parsed);
        }
      } catch {
        /* ignore */
      } finally {
        setLoading(false);
      }
      return;
    }

    try {
      const { data } = await supabase.from(tableName).select("*").order("ordem");
      if (data) {
        setServices(
          data.map((s: any) => ({
            id: s.id,
            name: s.nome,
            price: Number(s.preco),
            category: s.categoria,
            active: s.ativo,
            duration: s.duracao_minutos || 60,
            descricao: s.descricao || "",
          }))
        );
      }
    } catch (err) {
      console.error("Erro ao carregar serviços:", err);
    } finally {
      setLoading(false);
    }
  }, [tableName, SERVICES_PREVIEW_KEY]);

  useEffect(() => {
    reloadOrdemCategorias();
    reloadServicos();
  }, [reloadOrdemCategorias, reloadServicos]);

  const reloadDebounceRef = useRef<number | null>(null);
  useEffect(() => {
    if (!isSupabaseConfigured) return;
    const channel = supabase
      .channel(`${tableName}-realtime-admin`)
      .on("postgres_changes", { event: "*", schema: "public", table: tableName }, () => {
        if (reloadDebounceRef.current) window.clearTimeout(reloadDebounceRef.current);
        reloadDebounceRef.current = window.setTimeout(() => reloadServicos(), 250);
      })
      .subscribe();
    return () => {
      if (reloadDebounceRef.current) window.clearTimeout(reloadDebounceRef.current);
      supabase.removeChannel(channel);
    };
  }, [reloadServicos, tableName]);

  const categorias = useMemo(() => {
    const set = new Set<string>();
    services.forEach((s) => {
      if (s.category) set.add(s.category);
    });
    extraCategorias.forEach((c) => set.add(c));
    const todas = Array.from(set);
    const ordenadas = ordemCategorias.filter((c) => set.has(c));
    const restantes = todas
      .filter((c) => !ordenadas.includes(c))
      .sort((a, b) => a.localeCompare(b, "pt-BR"));
    return [...ordenadas, ...restantes];
  }, [services, extraCategorias, ordemCategorias]);

  const servicosFiltrados = useMemo(() => {
    const catIndex = new Map<string, number>();
    categorias.forEach((c, i) => catIndex.set(c, i));
    const q = busca.trim().toLowerCase();

    return services
      .filter((s) => {
        if (filtroCat !== "todas" && (s.category || "Outros") !== filtroCat) return false;
        if (q && !s.name.toLowerCase().includes(q) && !(s.category || "").toLowerCase().includes(q)) {
          return false;
        }
        return true;
      })
      .slice()
      .sort((a, b) => {
        const ca = catIndex.get(a.category) ?? 999;
        const cb = catIndex.get(b.category) ?? 999;
        if (ca !== cb) return ca - cb;
        return services.indexOf(a) - services.indexOf(b);
      });
  }, [services, filtroCat, busca, categorias]);

  const openCreateModal = () => {
    setEditingItem(null);
    setFormName("");
    setFormPrice("");
    setFormDuration("60");
    setFormCategory(filtroCat !== "todas" ? filtroCat : categorias[0] || "");
    setFormNewCategory("");
    setCreatingCatInline(false);
    setFormDescricao("");
    setModalOpen(true);
  };

  const openEditModal = (s: ServicoItem) => {
    setEditingItem(s);
    setFormName(s.name);
    setFormPrice(formatCurrencyValue(s.price));
    setFormDuration(String(s.duration || 60));
    setFormCategory(s.category || "");
    setFormNewCategory("");
    setCreatingCatInline(false);
    setFormDescricao(s.descricao || "");
    setModalOpen(true);
  };

  const handleSaveService = async () => {
    const cleanName = formName.trim();
    const priceNum = parseCurrencyStr(formPrice);
    const durationNum = Math.max(5, parseInt(formDuration, 10) || 60);
    const chosenCat = creatingCatInline
      ? formNewCategory.trim() || "Outros"
      : formCategory.trim() || "Outros";

    if (cleanName.length < 2) {
      toast.error("Digite o nome do serviço");
      return;
    }
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      toast.error("Informe um preço válido maior que zero");
      return;
    }

    setSaving(true);
    try {
      if (editingItem) {
        if (isSupabaseConfigured) {
          const { error } = await supabase
            .from(tableName)
            .update({
              nome: cleanName,
              preco: priceNum,
              duracao_minutos: durationNum,
              categoria: chosenCat,
              descricao: formDescricao.trim(),
              updated_at: new Date().toISOString(),
            })
            .eq("id", editingItem.id);
          if (error) throw error;
        }
        const next = services.map((s) =>
          s.id === editingItem.id
            ? {
                ...s,
                name: cleanName,
                price: priceNum,
                duration: durationNum,
                category: chosenCat,
                descricao: formDescricao.trim(),
              }
            : s
        );
        setServices(next);
        if (!isSupabaseConfigured) persistPreviewServices(next);
        toast.success("Serviço atualizado!");
      } else {
        if (!isSupabaseConfigured) {
          const localItem: ServicoItem = {
            id: globalThis.crypto?.randomUUID?.() || `srv-${Date.now()}`,
            name: cleanName,
            price: priceNum,
            category: chosenCat,
            active: true,
            duration: durationNum,
            descricao: formDescricao.trim(),
          };
          const next = [...services, localItem];
          setServices(next);
          persistPreviewServices(next);
          if (extraCategorias.includes(chosenCat)) {
            persistExtras(extraCategorias.filter((c) => c !== chosenCat));
          }
          toast.success("Serviço criado!");
        } else {
          const { data, error } = await supabase
            .from(tableName)
            .insert({
              nome: cleanName,
              preco: priceNum,
              categoria: chosenCat,
              ativo: true,
              ordem: services.length + 1,
              duracao_minutos: durationNum,
              descricao: formDescricao.trim(),
            })
            .select()
            .single();
          if (error) throw error;
          if (data) {
            setServices((prev) => [
              ...prev,
              {
                id: data.id,
                name: data.nome,
                price: Number(data.preco),
                category: data.categoria,
                active: data.ativo,
                duration: data.duracao_minutos || 60,
                descricao: (data as any).descricao || "",
              },
            ]);
            if (extraCategorias.includes(chosenCat)) {
              persistExtras(extraCategorias.filter((c) => c !== chosenCat));
            }
            toast.success("Serviço criado!");
          }
        }
      }
      setModalOpen(false);
    } catch (err: any) {
      toast.error("Erro ao salvar serviço: " + (err?.message || ""));
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (s: ServicoItem) => {
    const novoAtivo = !s.active;
    if (isSupabaseConfigured) {
      const { error } = await supabase
        .from(tableName)
        .update({ ativo: novoAtivo, updated_at: new Date().toISOString() })
        .eq("id", s.id);
      if (error) {
        toast.error("Erro ao alterar status");
        return;
      }
    }
    const next = services.map((item) => (item.id === s.id ? { ...item, active: novoAtivo } : item));
    setServices(next);
    if (!isSupabaseConfigured) persistPreviewServices(next);
  };

  const handleRemoveService = (s: ServicoItem) => {
    confirm({
      title: "Excluir Serviço",
      description: `Deseja remover "${s.name}" (${formatBRL(s.price)}) do catálogo?`,
      variant: "destructive",
      confirmText: "Excluir",
      onConfirm: async () => {
        if (isSupabaseConfigured) {
          const { error } = await supabase.from(tableName).delete().eq("id", s.id);
          if (error) {
            toast.error("Erro ao excluir serviço");
            return;
          }
        }
        const next = services.filter((item) => item.id !== s.id);
        setServices(next);
        if (!isSupabaseConfigured) persistPreviewServices(next);
        toast.success("Serviço excluído");
      },
    });
  };

  const moverServico = async (id: string, dir: -1 | 1) => {
    const atual = services.find((s) => s.id === id);
    if (!atual) return;
    const mesmaCat = services.filter((s) => (s.category || "Outros") === (atual.category || "Outros"));
    const i = mesmaCat.findIndex((s) => s.id === id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= mesmaCat.length) return;
    const a = mesmaCat[i];
    const b = mesmaCat[j];

    if (!isSupabaseConfigured) {
      const next = [...services];
      const ia = next.findIndex((x) => x.id === a.id);
      const ib = next.findIndex((x) => x.id === b.id);
      [next[ia], next[ib]] = [next[ib], next[ia]];
      setServices(next);
      persistPreviewServices(next);
      return;
    }

    const { data: rows } = await supabase.from(tableName).select("id, ordem").in("id", [a.id, b.id]);
    if (!rows || rows.length < 2) return;
    const ordemA = rows.find((r: any) => r.id === a.id)?.ordem ?? 0;
    const ordemB = rows.find((r: any) => r.id === b.id)?.ordem ?? 0;
    const novoA = ordemA === ordemB ? ordemB + dir : ordemB;
    const novoB = ordemA;

    await Promise.all([
      supabase.from(tableName).update({ ordem: novoA, updated_at: new Date().toISOString() }).eq("id", a.id),
      supabase.from(tableName).update({ ordem: novoB, updated_at: new Date().toISOString() }).eq("id", b.id),
    ]);
    await reloadServicos();
  };

  const salvarOrdemCategorias = async (nova: string[]) => {
    setOrdemCategorias(nova);
    if (!isSupabaseConfigured) return;
    await supabase.from("categorias_ordem").delete().eq("scope", tableName);
    if (nova.length > 0) {
      await supabase
        .from("categorias_ordem")
        .insert(nova.map((nome, idx) => ({ scope: tableName, nome, ordem: idx })));
    }
  };

  const adicionarCategoria = () => {
    const nome = novaCatInput.trim();
    if (!nome) return;
    if (categorias.some((c) => c.toLowerCase() === nome.toLowerCase())) {
      toast.error("Essa categoria já existe");
      return;
    }
    persistExtras([...extraCategorias, nome]);
    setNovaCatInput("");
    toast.success("Categoria criada");
  };

  const salvarRenomeCat = async () => {
    const novo = renomeCatValor.trim();
    const antigo = renomeandoCat;
    if (!antigo || !novo || novo === antigo) {
      setRenomeandoCat(null);
      return;
    }
    if (categorias.some((c) => c.toLowerCase() === novo.toLowerCase() && c !== antigo)) {
      toast.error("Já existe uma categoria com esse nome");
      return;
    }

    const idsAfetados = services.filter((s) => s.category === antigo).map((s) => s.id);
    if (idsAfetados.length > 0 && isSupabaseConfigured) {
      const { error } = await supabase
        .from(tableName)
        .update({ categoria: novo, updated_at: new Date().toISOString() })
        .in("id", idsAfetados);
      if (error) {
        toast.error("Erro ao renomear: " + error.message);
        return;
      }
    }
    if (idsAfetados.length > 0) {
      const next = services.map((s) => (s.category === antigo ? { ...s, category: novo } : s));
      setServices(next);
      if (!isSupabaseConfigured) persistPreviewServices(next);
    }
    if (extraCategorias.includes(antigo)) {
      persistExtras(extraCategorias.map((c) => (c === antigo ? novo : c)));
    }
    if (ordemCategorias.includes(antigo)) {
      await salvarOrdemCategorias(ordemCategorias.map((c) => (c === antigo ? novo : c)));
    }
    if (filtroCat === antigo) setFiltroCat(novo);
    setRenomeandoCat(null);
    toast.success("Categoria renomeada");
  };

  const removerCategoriaVazia = (cat: string) => {
    if (services.some((s) => s.category === cat)) {
      toast.error("Mova ou exclua os serviços desta categoria antes de removê-la");
      return;
    }
    persistExtras(extraCategorias.filter((c) => c !== cat));
    if (filtroCat === cat) setFiltroCat("todas");
    toast.success("Categoria removida");
  };

  const activeCount = services.filter((s) => s.active).length;

  if (loading) {
    return (
      <p className="font-body text-[13px] text-primary-foreground/40 text-center py-8">
        Carregando serviços...
      </p>
    );
  }

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Cabeçalho simples e objetivo */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-xl font-semibold text-primary-foreground">Serviços</h2>
            <span className="px-2 py-0.5 rounded-full bg-gold/15 border border-gold/25 font-body text-[11px] font-semibold text-gold tabular-nums">
              {activeCount} ativo{activeCount !== 1 ? "s" : ""}
            </span>
          </div>
          <p className="font-body text-[11.5px] text-primary-foreground/55 mt-0.5">
            Cadastre procedimentos, preços e duração exibidos na agenda e para clientes
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setManageCatsOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.08] text-primary-foreground/75 font-body text-[12px] font-medium hover:bg-primary-foreground/[0.08] transition-all"
          >
            <Folder className="w-3.5 h-3.5 text-gold/80" />
            Categorias ({categorias.length})
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-br from-gold to-nude text-charcoal font-body text-[12.5px] font-bold shadow-[0_6px_22px_-6px_hsl(23_52%_52%/0.5)] hover:brightness-105 active:scale-[0.98] transition-all"
          >
            <Plus className="w-4 h-4" />
            Novo Serviço
          </button>
        </div>
      </div>

      {/* Busca e Filtro por categoria em um só lugar */}
      <div className="space-y-2.5 rounded-2xl border border-primary-foreground/[0.07] bg-primary-foreground/[0.02] p-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-primary-foreground/45" />
          <input
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar serviço ou categoria..."
            className="w-full pl-9 pr-9 py-2.5 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.09] text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/40 focus:outline-none focus:border-gold/45"
          />
          {busca && (
            <button
              type="button"
              onClick={() => setBusca("")}
              aria-label="Limpar busca"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-primary-foreground/50 hover:text-primary-foreground"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {categorias.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setFiltroCat("todas")}
              className={`px-2.5 py-1 rounded-full border font-body text-[11px] font-medium transition-all ${
                filtroCat === "todas"
                  ? "bg-gold/20 border-gold/45 text-gold"
                  : "bg-primary-foreground/[0.03] border-primary-foreground/[0.08] text-primary-foreground/60 hover:text-primary-foreground"
              }`}
            >
              Todos ({services.length})
            </button>
            {categorias.map((cat) => {
              const count = services.filter((s) => (s.category || "Outros") === cat).length;
              const active = filtroCat === cat;
              return (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setFiltroCat(cat)}
                  className={`px-2.5 py-1 rounded-full border font-body text-[11px] font-medium transition-all ${
                    active
                      ? "bg-gold/20 border-gold/45 text-gold"
                      : "bg-primary-foreground/[0.03] border-primary-foreground/[0.08] text-primary-foreground/60 hover:text-primary-foreground"
                  }`}
                >
                  {cat} ({count})
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Lista ou Empty State */}
      {servicosFiltrados.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-primary-foreground/[0.12] bg-[#191819] py-10 px-6 text-center space-y-3">
          <div className="mx-auto w-12 h-12 rounded-2xl bg-gold/15 border border-gold/25 flex items-center justify-center">
            <Sparkles className="w-6 h-6 text-gold" />
          </div>
          <div className="space-y-1 max-w-md mx-auto">
            <h3 className="font-heading text-[16px] font-semibold text-primary-foreground">
              {services.length === 0
                ? "Nenhum serviço cadastrado ainda"
                : "Nenhum serviço encontrado"}
            </h3>
            <p className="font-body text-[12px] text-primary-foreground/55">
              {services.length === 0
                ? "Adicione seu primeiro serviço com preço e duração para já liberar na agenda."
                : "Tente buscar outro nome ou trocar o filtro acima."}
            </p>
          </div>
          <div className="pt-1 flex flex-wrap items-center justify-center gap-2">
            {(busca || filtroCat !== "todas") && (
              <button
                type="button"
                onClick={() => {
                  setBusca("");
                  setFiltroCat("todas");
                }}
                className="px-4 py-2 rounded-xl bg-primary-foreground/[0.06] border border-primary-foreground/[0.1] text-primary-foreground/80 font-body text-[12px] font-medium hover:bg-primary-foreground/[0.1]"
              >
                Limpar filtros
              </button>
            )}
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-br from-gold to-nude text-charcoal font-body text-[12.5px] font-bold hover:brightness-105 transition-all"
            >
              <Plus className="w-4 h-4" />
              Cadastrar primeiro serviço
            </button>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {servicosFiltrados.map((s) => {
            const mesmaCat = services.filter(
              (x) => (x.category || "Outros") === (s.category || "Outros")
            );
            const idxCat = mesmaCat.findIndex((x) => x.id === s.id);
            const isFirst = idxCat === 0;
            const isLast = idxCat === mesmaCat.length - 1;

            return (
              <div
                key={s.id}
                className={`rounded-2xl border p-4 transition-all flex flex-col justify-between gap-3 ${
                  s.active
                    ? "bg-[#1b1a1b] border-primary-foreground/[0.09] hover:border-gold/30"
                    : "bg-[#161516] border-primary-foreground/[0.05] opacity-65"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1 min-w-0">
                    <p className="font-body text-[15px] font-semibold text-primary-foreground truncate">
                      {s.name}
                    </p>
                    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-gold/10 border border-gold/25 font-body text-[10.5px] font-medium text-gold">
                        {s.category || "Outros"}
                      </span>
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary-foreground/[0.05] border border-primary-foreground/[0.08] font-body text-[10.5px] text-primary-foreground/65">
                        <Clock className="w-3 h-3" />
                        {formatDurationLabel(s.duration)}
                      </span>
                    </div>
                    {s.descricao && (
                      <p className="mt-2 font-body text-[12px] text-primary-foreground/55 line-clamp-2">
                        {s.descricao}
                      </p>
                    )}
                  </div>

                  <div className="text-right shrink-0">
                    <p className="font-heading text-[18px] font-bold text-gold tabular-nums">
                      {formatBRL(s.price)}
                    </p>
                    <span
                      className={`font-body text-[10px] font-medium ${
                        s.active ? "text-emerald-400" : "text-primary-foreground/45"
                      }`}
                    >
                      {s.active ? "Visível" : "Oculto"}
                    </span>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-2.5 border-t border-primary-foreground/[0.06]">
                  <button
                    type="button"
                    onClick={() => toggleActive(s)}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg font-body text-[11px] font-medium transition-all ${
                      s.active
                        ? "bg-emerald-500/10 border border-emerald-500/20 text-emerald-300 hover:bg-emerald-500/20"
                        : "bg-primary-foreground/[0.05] border border-primary-foreground/[0.08] text-primary-foreground/60 hover:text-primary-foreground"
                    }`}
                  >
                    {s.active ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
                    {s.active ? "Ativo" : "Oculto"}
                  </button>

                  <div className="flex items-center gap-1">
                    {mesmaCat.length > 1 && (
                      <>
                        <button
                          type="button"
                          onClick={() => moverServico(s.id, -1)}
                          disabled={isFirst}
                          title="Subir na lista"
                          className="p-1.5 rounded-lg text-primary-foreground/45 hover:text-gold hover:bg-gold/10 disabled:opacity-20"
                        >
                          <ChevronUp className="w-4 h-4" />
                        </button>
                        <button
                          type="button"
                          onClick={() => moverServico(s.id, 1)}
                          disabled={isLast}
                          title="Descer na lista"
                          className="p-1.5 rounded-lg text-primary-foreground/45 hover:text-gold hover:bg-gold/10 disabled:opacity-20"
                        >
                          <ChevronDown className="w-4 h-4" />
                        </button>
                      </>
                    )}
                    <button
                      type="button"
                      onClick={() => openEditModal(s)}
                      title="Editar serviço"
                      className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary-foreground/[0.05] text-primary-foreground/80 hover:text-gold font-body text-[11px] font-medium transition-all"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                      Editar
                    </button>
                    <button
                      type="button"
                      onClick={() => handleRemoveService(s)}
                      title="Excluir serviço"
                      className="p-1.5 rounded-lg text-primary-foreground/45 hover:text-rose hover:bg-rose/10 transition-all"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Modal: Criar / Editar Serviço */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md max-h-[90dvh] overflow-y-auto overflow-x-hidden rounded-[24px] border border-gold/25 bg-charcoal p-5 shadow-2xl custom-scrollbar">
          <DialogHeader className="mb-1">
            <DialogTitle className="font-heading text-[20px] font-semibold text-primary-foreground flex items-center gap-2">
              <div className="w-8 h-8 rounded-xl bg-gold/15 border border-gold/30 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-gold" />
              </div>
              <span>{editingItem ? "Editar Serviço" : "Novo Serviço"}</span>
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3.5 pt-2">
            <div className="space-y-1.5">
              <label className="font-body text-[10.5px] uppercase tracking-wider text-primary-foreground/65 font-semibold block">
                Nome do serviço *
              </label>
              <input
                type="text"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                placeholder="Ex: Micropigmentação Fio a Fio"
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.1] text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/30 focus:outline-none focus:border-gold/45"
              />
            </div>

            <div className="space-y-1.5">
              <label className="font-body text-[10.5px] uppercase tracking-wider text-primary-foreground/65 font-semibold block">
                Categoria
              </label>
              {creatingCatInline ? (
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={formNewCategory}
                    onChange={(e) => setFormNewCategory(e.target.value)}
                    placeholder="Ex: Sobrancelhas, Tattoo, Lábios..."
                    autoFocus
                    className="flex-1 px-3.5 py-2.5 rounded-xl bg-primary-foreground/[0.04] border border-gold/40 text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/30 focus:outline-none"
                  />
                  {categorias.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setCreatingCatInline(false);
                        setFormNewCategory("");
                      }}
                      className="px-3 rounded-xl bg-primary-foreground/[0.06] text-primary-foreground/65 font-body text-[12px]"
                    >
                      Voltar
                    </button>
                  )}
                </div>
              ) : (
                <div className="flex gap-2">
                  <select
                    value={formCategory}
                    onChange={(e) => {
                      if (e.target.value === "__new__") {
                        setCreatingCatInline(true);
                      } else {
                        setFormCategory(e.target.value);
                      }
                    }}
                    className="flex-1 px-3.5 py-2.5 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.1] text-primary-foreground font-body text-[13px] focus:outline-none focus:border-gold/45 [color-scheme:dark]"
                  >
                    <option value="" className="bg-[#1c1c1e]">Outros</option>
                    {categorias.map((c) => (
                      <option key={c} value={c} className="bg-[#1c1c1e]">
                        {c}
                      </option>
                    ))}
                    <option value="__new__" className="bg-[#1c1c1e]">
                      + Nova categoria...
                    </option>
                  </select>
                  <button
                    type="button"
                    onClick={() => setCreatingCatInline(true)}
                    className="px-3 rounded-xl bg-gold/10 border border-gold/25 text-gold font-body text-[12px] font-medium hover:bg-gold/20"
                  >
                    + Nova
                  </button>
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="font-body text-[10.5px] uppercase tracking-wider text-primary-foreground/65 font-semibold block">
                  Preço *
                </label>
                <div className="relative">
                  <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-body text-[12.5px] text-gold/80 font-semibold">
                    R$
                  </span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={formPrice}
                    onChange={(e) => setFormPrice(formatCurrencyMask(e.target.value))}
                    placeholder="0,00"
                    className="w-full pl-10 pr-3.5 py-2.5 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.1] text-primary-foreground font-body text-[13.5px] font-semibold focus:outline-none focus:border-gold/45 tabular-nums"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="font-body text-[10.5px] uppercase tracking-wider text-primary-foreground/65 font-semibold block">
                  Duração (minutos)
                </label>
                <input
                  type="number"
                  min={5}
                  step={5}
                  value={formDuration}
                  onChange={(e) => setFormDuration(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.1] text-primary-foreground font-body text-[13px] focus:outline-none focus:border-gold/45 tabular-nums"
                />
              </div>
            </div>

            {/* Atalhos rápidos de duração */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-body text-[10.5px] text-primary-foreground/45 mr-1">
                Atalhos:
              </span>
              {DURACAO_PRESETS.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  onClick={() => setFormDuration(String(p.value))}
                  className={`px-2.5 py-1 rounded-lg border font-body text-[11px] transition-all ${
                    Number(formDuration) === p.value
                      ? "bg-gold/20 border-gold/45 text-gold font-semibold"
                      : "bg-primary-foreground/[0.03] border-primary-foreground/[0.08] text-primary-foreground/60 hover:text-primary-foreground"
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="space-y-1.5">
              <label className="font-body text-[10.5px] uppercase tracking-wider text-primary-foreground/65 font-semibold block">
                Descrição{" "}
                <span className="normal-case font-normal text-primary-foreground/40">
                  (opcional — aparece para clientes)
                </span>
              </label>
              <textarea
                rows={3}
                value={formDescricao}
                onChange={(e) => setFormDescricao(e.target.value)}
                placeholder="Ex: Inclui design personalizado, pigmentos importados e retoque..."
                className="w-full px-3.5 py-2.5 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.1] text-primary-foreground font-body text-[12.5px] placeholder:text-primary-foreground/30 focus:outline-none focus:border-gold/45 resize-none"
              />
            </div>

            <div className="flex items-center gap-2 pt-2">
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
                onClick={handleSaveService}
                className="flex-[1.5] py-2.5 rounded-xl bg-gradient-to-br from-gold to-nude text-charcoal font-body text-[13px] font-bold flex items-center justify-center gap-1.5 hover:brightness-105 transition-all disabled:opacity-50"
              >
                <Save className="w-4 h-4" />
                {saving ? "Salvando..." : editingItem ? "Salvar Alterações" : "Criar Serviço"}
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Modal compacto de Categorias */}
      <Dialog open={manageCatsOpen} onOpenChange={setManageCatsOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md max-h-[85dvh] overflow-y-auto rounded-[24px] border border-gold/25 bg-charcoal p-5 shadow-2xl custom-scrollbar">
          <DialogHeader className="mb-2">
            <DialogTitle className="font-heading text-[18px] font-semibold text-primary-foreground flex items-center gap-2">
              <Folder className="w-4 h-4 text-gold" />
              Gerenciar Categorias
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <div className="flex gap-2">
              <input
                value={novaCatInput}
                onChange={(e) => setNovaCatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") adicionarCategoria();
                }}
                placeholder="Nova categoria..."
                className="flex-1 px-3 py-2 rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.1] text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/30 focus:outline-none focus:border-gold/45"
              />
              <button
                type="button"
                onClick={adicionarCategoria}
                className="px-3.5 py-2 rounded-xl bg-gradient-to-br from-gold to-nude text-charcoal font-body text-[12px] font-bold"
              >
                Criar
              </button>
            </div>

            {categorias.length === 0 ? (
              <p className="font-body text-[12px] text-primary-foreground/45 text-center py-4">
                Nenhuma categoria criada ainda. Você também pode criar direto ao cadastrar um serviço.
              </p>
            ) : (
              <div className="space-y-1.5">
                {categorias.map((cat) => {
                  const count = services.filter((s) => (s.category || "Outros") === cat).length;
                  const editingThis = renomeandoCat === cat;
                  return (
                    <div
                      key={cat}
                      className="flex items-center justify-between gap-2 px-3 py-2 rounded-xl bg-primary-foreground/[0.03] border border-primary-foreground/[0.07]"
                    >
                      {editingThis ? (
                        <div className="flex items-center gap-1.5 flex-1">
                          <input
                            autoFocus
                            value={renomeCatValor}
                            onChange={(e) => setRenomeCatValor(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") salvarRenomeCat();
                              if (e.key === "Escape") setRenomeandoCat(null);
                            }}
                            className="flex-1 px-2 py-1 rounded-lg bg-primary-foreground/[0.06] border border-gold/30 text-primary-foreground font-body text-[12.5px]"
                          />
                          <button
                            type="button"
                            onClick={salvarRenomeCat}
                            className="px-2 py-1 rounded-lg bg-gold/20 text-gold font-body text-[11px] font-semibold"
                          >
                            Salvar
                          </button>
                        </div>
                      ) : (
                        <>
                          <div className="min-w-0">
                            <p className="font-body text-[13px] font-medium text-primary-foreground truncate">
                              {cat}
                            </p>
                            <p className="font-body text-[10.5px] text-primary-foreground/45">
                              {count} {count === 1 ? "serviço" : "serviços"}
                            </p>
                          </div>
                          <div className="flex items-center gap-1">
                            <button
                              type="button"
                              onClick={() => {
                                setRenomeandoCat(cat);
                                setRenomeCatValor(cat);
                              }}
                              title="Renomear"
                              className="p-1.5 rounded-lg text-primary-foreground/50 hover:text-gold"
                            >
                              <Edit2 className="w-3.5 h-3.5" />
                            </button>
                            {count === 0 && (
                              <button
                                type="button"
                                onClick={() => removerCategoriaVazia(cat)}
                                title="Excluir categoria vazia"
                                className="p-1.5 rounded-lg text-primary-foreground/50 hover:text-rose"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default ServicosTab;
