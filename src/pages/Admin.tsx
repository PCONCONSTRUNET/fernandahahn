import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { parseCurrencyStr, formatCurrencyMask, formatCurrencyValue, formatWhatsappMask } from "@/lib/utils";
import { motion, useAnimation } from "framer-motion";
import { toast } from "sonner";
import { supabase, isSupabaseConfigured, SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from "@/integrations/supabase/client";
import { notifyAgendamentoConfirmadoById, notifyLembreteById, normalizeWhatsappNumber } from "@/lib/notify-webhook";
import { persistAppointmentPayment } from "@/lib/caixa";
import { sendPush } from "@/lib/push-notify";
import {
  BarChart3, Calendar, Users, Clock, LogOut, Search,
  X, Edit2, Trash2, Plus, Minus, Save, CheckCircle, Bell, MessageSquare,
  UserX, DollarSign, CreditCard, ChevronLeft, ChevronRight, Receipt, ClipboardList, Wallet, Timer, PlusCircle, Menu,
  Sparkles, Folder, Filter, TrendingUp, Power, Eye, EyeOff, ChevronUp, ChevronDown, Loader2
} from "lucide-react";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger, SheetDescription
} from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import PlusButton from "@/components/ui/plus-button";
import { Button } from "@/components/ui/button";
import WhatsAppIcon from "@/components/icons/WhatsAppIcon";
import logo from "@/assets/logo.png";
import { Calendar as DatePickerCalendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ptBR } from "date-fns/locale";
import CaixaTab from "@/components/CaixaTab";
import GastosTab from "@/components/GastosTab";
import ClientesTab from "@/components/ClientesTab";
import HorariosTab from "@/components/HorariosTab";
import ServicosTab from "@/components/ServicosTab";
import PedidosTab from "@/components/PedidosTab";
import BinButton from "@/components/ui/bin-button";
import GatewayTab from "@/components/GatewayTab";
import PagamentosTab from "@/components/PagamentosTab";
import AvaliacoesTab from "@/components/AvaliacoesTab";
import { Star } from "lucide-react";
import AdminDashboard from "@/components/AdminDashboard";
import { useAdminNotifications } from "@/hooks/use-admin-notifications";
import { unlockNotificationAudio } from "@/lib/notification-sound";
import { Switch } from "@/components/ui/switch";
import { useConfirm } from "@/contexts/ConfirmContext";
import { AnimatedSearch } from "@/components/AnimatedSearch";

// ─── Types ───
interface Agendamento {
  id: string; servico: string; variacao: string | null; data_agendamento: string;
  horario: string; valor: number; valor_pago: number | null; status: string;
  valor_troco?: number | null; valor_gorjeta?: number | null; valor_credito?: number | null;
  created_at: string; user_id: string; duracao_minutos: number; forma_pagamento: string | null;
  cliente_nome: string | null;
  origem?: string | null;
  observacao?: string | null;
}
interface Profile { id: string; nome: string; whatsapp: string; cpf?: string | null; created_at: string; credito_saldo?: number | null; }
interface LembreteConfig { id: string; tipo: string; ativo: boolean; mensagem: string; horas_antes: number; }

type Tab = "dashboard" | "agendamentos" | "pedidos" | "clientes" | "horarios" | "servicos_app" | "caixa" | "pagamentos" | "gastos" | "gateway" | "avaliacoes";

const ADMIN_PASSWORD = "fernandaadmin";
const ADMIN_EMAIL = "fernanda@fernandahahn.com.br";

const getDateKey = (date: Date) => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatCurrency = (val: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(val);

const parseDateKey = (dateKey?: string | null) => {
  if (!dateKey || typeof dateKey !== "string" || !dateKey.includes("-")) {
    return new Date();
  }
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day, 12, 0, 0);
};

const shiftDate = (dateKey: string, days: number) => {
  const d = parseDateKey(dateKey);
  d.setDate(d.getDate() + days);
  return getDateKey(d);
};

// ─── Lembretes Hub (Sheet lateral) ───
const LembretesHub = () => {
  const [configs, setConfigs] = useState<LembreteConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editMsg, setEditMsg] = useState("");
  const [editHoras, setEditHoras] = useState("");

  const tipoLabels: Record<string, { label: string; icon: string; desc: string }> = {
    confirmacao: { label: "Confirmação", icon: "✅", desc: "Enviado ao confirmar agendamento" },
    lembrete: { label: "Lembrete", icon: "⏰", desc: "Enviado antes do atendimento" },
    cancelamento: { label: "Cancelamento", icon: "❌", desc: "Enviado ao cancelar agendamento" },
    comparecimento: { label: "Comparecimento", icon: "💖", desc: "Enviado após o atendimento" },
    pos_atendimento: { label: "Pós-Atendimento", icon: "⭐", desc: "Feedback após atendimento" },
  };

  useEffect(() => {
    (supabase as any)
      .from("configuracoes_lembretes")
      .select("*")
      .order("created_at")
      .then(({ data }: any) => {
        if (data) setConfigs(data.map((d: any) => ({ id: d.id, tipo: d.tipo, ativo: d.ativo, mensagem: d.mensagem, horas_antes: d.horas_antes })));
      })
      .catch((err: any) => console.error("Erro ao carregar lembretes:", err))
      .finally(() => setLoading(false));
  }, []);

  const toggleAtivo = async (id: string) => {
    const c = configs.find(c => c.id === id);
    if (!c) return;
    await (supabase as any).from("configuracoes_lembretes").update({ ativo: !c.ativo, updated_at: new Date().toISOString() }).eq("id", id);
    setConfigs(prev => prev.map(c => c.id === id ? { ...c, ativo: !c.ativo } : c));
  };

  const startEdit = (c: LembreteConfig) => {
    setEditingId(c.id);
    setEditMsg(c.mensagem);
    setEditHoras(c.horas_antes.toString());
  };

  const saveEdit = async () => {
    if (!editingId) return;
    setSaving(true);
    await (supabase as any).from("configuracoes_lembretes").update({
      mensagem: editMsg, horas_antes: Number(editHoras), updated_at: new Date().toISOString(),
    }).eq("id", editingId);
    setConfigs(prev => prev.map(c => c.id === editingId ? { ...c, mensagem: editMsg, horas_antes: Number(editHoras) } : c));
    setEditingId(null);
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (loading) return <p className="font-body text-[13px] text-primary-foreground/30 text-center py-12">Carregando...</p>;

  return (
    <div className="flex flex-col h-full">
      <SheetHeader className="px-5 pt-5 pb-4 border-b border-primary-foreground/[0.06]">
        <SheetTitle className="font-heading text-[16px] font-semibold text-primary-foreground flex items-center gap-2">
          <Bell className="w-4 h-4 text-gold" />
          Configurações de Lembretes
        </SheetTitle>
        <SheetDescription className="font-body text-[11px] text-primary-foreground/35">
          Configure mensagens automáticas para cada etapa do agendamento
        </SheetDescription>
      </SheetHeader>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {configs.map(c => {
          const info = tipoLabels[c.tipo] || { label: c.tipo, icon: "📌", desc: "" };
          return (
            <div key={c.id} className={`rounded-2xl border transition-all ${c.ativo ? "bg-primary-foreground/[0.03] border-primary-foreground/[0.08]" : "bg-primary-foreground/[0.01] border-primary-foreground/[0.04] opacity-60"}`}>
              <div className="p-4">
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[16px]">{info.icon}</span>
                    <span className="font-body text-[13px] font-medium text-primary-foreground">{info.label}</span>
                  </div>
                  <button
                    onClick={() => toggleAtivo(c.id)}
                    className={`w-10 h-6 rounded-full relative transition-all duration-200 ${c.ativo ? "bg-gold" : "bg-primary-foreground/10"}`}
                  >
                    <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${c.ativo ? "left-4" : "left-0.5"}`} />
                  </button>
                </div>
                <p className="font-body text-[10px] text-primary-foreground/30 mb-2">{info.desc}</p>

                {editingId === c.id ? (
                  <div className="space-y-2 mt-2">
                    <textarea
                      value={editMsg}
                      onChange={e => setEditMsg(e.target.value)}
                      rows={3}
                      className="w-full px-3 py-2 rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.08] text-primary-foreground font-body text-[12px] placeholder:text-primary-foreground/20 focus:outline-none focus:ring-2 focus:ring-gold/20 resize-none"
                    />
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <label className="font-body text-[10px] text-primary-foreground/30 mb-1 block">Horas antes</label>
                        <input
                          type="number"
                          value={editHoras}
                          onChange={e => setEditHoras(e.target.value)}
                          min="0"
                          className="w-full px-3 py-2 rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.08] text-primary-foreground font-body text-[12px] focus:outline-none focus:ring-2 focus:ring-gold/20"
                        />
                      </div>
                      <div className="flex gap-1 pt-4">
                        <button onClick={saveEdit} disabled={saving} className="p-2 rounded-xl bg-gold/10 text-gold hover:bg-gold/20 transition-all">
                          <Save className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setEditingId(null)} className="p-2 rounded-xl bg-primary-foreground/[0.05] text-primary-foreground/30 hover:text-primary-foreground/50 transition-all">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="mt-2">
                    <div className="flex items-start gap-2 p-2.5 rounded-xl bg-primary-foreground/[0.02] border border-primary-foreground/[0.04]">
                      <MessageSquare className="w-3 h-3 text-primary-foreground/20 mt-0.5 shrink-0" />
                      <p className="font-body text-[11px] text-primary-foreground/50 leading-relaxed">{c.mensagem}</p>
                    </div>
                    <div className="flex items-center justify-between mt-2">
                      {c.horas_antes > 0 ? (
                        <span className="font-body text-[10px] text-gold/60">{c.horas_antes}h antes</span>
                      ) : (
                        <span className="font-body text-[10px] text-primary-foreground/25">Imediato</span>
                      )}
                      <button onClick={() => startEdit(c)} className="p-1.5 rounded-lg hover:bg-primary-foreground/[0.06] text-primary-foreground/25 hover:text-primary-foreground/50 transition-all">
                        <Edit2 className="w-3 h-3" />
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {saved && (
        <div className="px-4 py-3 border-t border-primary-foreground/[0.06]">
          <p className="font-body text-[11px] text-green-500 text-center">✓ Configuração salva com sucesso</p>
        </div>
      )}

      <div className="px-4 py-3 border-t border-primary-foreground/[0.06]">
        <p className="font-body text-[10px] text-primary-foreground/25 leading-relaxed text-center">
          💡 Os lembretes serão enviados via WhatsApp automaticamente conforme a configuração.
        </p>
      </div>
    </div>
  );
};

// ─── Password Gate ───
const ADMIN_AUTH_KEY = "fernanda_admin_authenticated";

const SwipeableTimelineCard = ({
  a,
  idx,
  isCancelado,
  barColor,
  duracao,
  endTimeString,
  clientName,
  clientWhatsapp,
  onClick,
  onEdit,
  onDelete,
}: any) => {
  const controls = useAnimation();
  const { confirm } = useConfirm();
  const isDraggingRef = useRef(false);
  const [swipedOpen, setSwipedOpen] = useState(false);

  const valorEfetivo = Math.max(0, Number(a.valor || 0) - Number(a.valor_desconto_credito || 0));
  const valorPago = Number(a.valor_pago || 0);
  const valorFalta = Math.max(0, valorEfetivo - valorPago);

  const statusMeta: Record<string, { label: string; pill: string; dot: string }> = {
    confirmado: {
      label: "Confirmado",
      pill: "bg-gold/15 text-gold border-gold/30",
      dot: "bg-gold",
    },
    concluido: {
      label: "Concluído",
      pill: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
      dot: "bg-emerald-400",
    },
    falta: {
      label: "Falta",
      pill: "bg-amber-500/15 text-amber-300 border-amber-500/30",
      dot: "bg-amber-400",
    },
    cancelado: {
      label: "Cancelado",
      pill: "bg-rose/15 text-rose border-rose/30",
      dot: "bg-rose",
    },
  };
  const st = statusMeta[a.status] || statusMeta.confirmado;

  const closeSwipe = () => {
    setSwipedOpen(false);
    controls.start({ x: 0 });
  };

  const handleDragEnd = (_event: any, info: any) => {
    if (info.offset.x < -48 || (swipedOpen && info.offset.x < 24)) {
      setSwipedOpen(true);
      controls.start({ x: -124 });
    } else {
      closeSwipe();
    }
    window.setTimeout(() => {
      isDraggingRef.current = false;
    }, 120);
  };

  return (
    <div
      style={{ zIndex: 10 + idx }}
      className="relative overflow-hidden rounded-2xl w-full select-none"
    >
      {/* Ações iOS reveladas ao arrastar para a esquerda */}
      <div className="absolute inset-y-0 right-0 flex items-center gap-2 pl-2 pr-0.5 z-0">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            closeSwipe();
            onEdit?.(a);
          }}
          aria-label="Editar agendamento"
          className="h-full w-[54px] rounded-2xl bg-sky-600 hover:bg-sky-500 flex flex-col items-center justify-center gap-1 text-white transition-colors shadow-sm"
        >
          <Edit2 className="h-4 w-4" />
          <span className="font-body text-[9px] font-semibold">Editar</span>
        </button>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            confirm({
              title: "Excluir Agendamento?",
              description: "Deseja realmente excluir este agendamento?",
              confirmText: "Sim, Excluir",
              cancelText: "Cancelar",
              variant: "destructive",
              onConfirm: () => {
                onDelete(a.id);
              },
            });
          }}
          aria-label="Excluir agendamento"
          className="h-full w-[54px] rounded-2xl bg-rose hover:bg-rose/90 flex flex-col items-center justify-center gap-1 text-white transition-colors shadow-sm"
        >
          <Trash2 className="h-4 w-4" />
          <span className="font-body text-[9px] font-semibold">Excluir</span>
        </button>
      </div>

      {/* Card principal alinhado ao tema Fernanda Hahn */}
      <motion.div
        drag="x"
        dragConstraints={{ left: -124, right: 0 }}
        dragElastic={0.08}
        onDragStart={() => {
          isDraggingRef.current = true;
        }}
        onDragEnd={handleDragEnd}
        animate={controls}
        transition={{ type: "spring", stiffness: 380, damping: 32 }}
        className="relative z-10 w-full"
      >
        <article
          onClick={(e: any) => {
            if (isDraggingRef.current) return;
            const target = e.target as HTMLElement;
            if (target.closest("button, input, a, select, textarea")) return;
            if (swipedOpen) {
              closeSwipe();
              return;
            }
            onClick(a);
          }}
          className={`w-full relative overflow-hidden rounded-2xl bg-[#252423] border border-primary-foreground/[0.09] hover:border-gold/30 transition-colors cursor-pointer flex shadow-sm ${
            isCancelado ? "opacity-65" : ""
          }`}
        >
          <div className={`w-1.5 rounded-full my-2.5 ml-2 shrink-0 ${barColor}`} />

          <div className="flex-1 min-w-0 px-3 py-3 flex flex-col gap-1">
            {/* Linha 1: horário + duração + status + indicador */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 min-w-0">
                <span className="font-heading text-[13px] font-bold text-primary-foreground tabular-nums tracking-tight">
                  {a.horario} – {endTimeString}
                </span>
                <span className="px-2 py-0.5 rounded-md text-[10px] font-body font-medium bg-primary-foreground/[0.06] text-primary-foreground/60 tabular-nums">
                  {duracao}min
                </span>
              </div>

              <div className="flex items-center gap-1.5 shrink-0">
                <span className={`px-2 py-0.5 rounded-full border text-[9.5px] font-body font-semibold ${st.pill}`}>
                  {st.label}
                </span>
                <span className={`w-2 h-2 rounded-full ${st.dot}`} />
                <span className="w-1 h-5 rounded-full bg-primary-foreground/15 ml-0.5" title="Arraste para a esquerda" />
              </div>
            </div>

            {/* Linha 2: Nome do cliente + WhatsApp */}
            <div className="flex items-center gap-2 min-w-0 mt-0.5">
              <p className="font-heading text-[15px] font-semibold text-primary-foreground truncate">
                {clientName}
              </p>
              {clientWhatsapp && (
                <a
                  href={`https://wa.me/${normalizeWhatsappNumber(clientWhatsapp)}`}
                  target="_blank"
                  rel="noreferrer"
                  onClick={(e) => e.stopPropagation()}
                  title="Chamar no WhatsApp"
                  className="shrink-0 text-[#25d366] hover:scale-110 transition-transform"
                >
                  <WhatsAppIcon className="h-3.5 w-3.5" />
                </a>
              )}
            </div>

            {/* Linha 3: Serviço */}
            <p className="font-body text-[12px] text-primary-foreground/55 truncate">
              {a.servico}{a.variacao ? ` · ${a.variacao}` : ""}
            </p>

            {/* Linha 4: Pagamento */}
            <div className="flex items-center justify-between gap-2 pt-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                {valorEfetivo === 0 ? (
                  <span className="font-heading text-[12px] font-bold text-sky-400 uppercase tracking-wide">
                    Cortesia
                  </span>
                ) : valorFalta <= 0.01 ? (
                  <span className="font-heading text-[12.5px] font-bold text-emerald-400 tabular-nums">
                    Pago · R$ {valorEfetivo.toFixed(2).replace(".", ",")}
                  </span>
                ) : valorPago > 0 ? (
                  <>
                    <span className="font-heading text-[12.5px] font-bold text-gold tabular-nums">
                      Sinal R$ {valorPago.toFixed(2).replace(".", ",")}
                    </span>
                    <span className="font-body text-[11px] text-primary-foreground/45 tabular-nums">
                      · Falta R$ {valorFalta.toFixed(2).replace(".", ",")}
                    </span>
                  </>
                ) : (
                  <span className="font-heading text-[12.5px] font-bold text-rose tabular-nums">
                    R$ {valorEfetivo.toFixed(2).replace(".", ",")} <span className="text-primary-foreground/45 font-normal text-[11px]">(a receber)</span>
                  </span>
                )}
              </div>
            </div>
          </div>
        </article>
      </motion.div>
    </div>
  );
};

const Admin = () => {
  const [authenticated, setAuthenticated] = useState(() => {
    try {
      return localStorage.getItem(ADMIN_AUTH_KEY) === "true";
    } catch {
      return false;
    }
  });
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  const handleLogin = () => {
    if (password !== ADMIN_PASSWORD) {
      setError("Senha incorreta");
      return;
    }
    try { localStorage.setItem(ADMIN_AUTH_KEY, "true"); } catch {}
    setAuthenticated(true);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    try { localStorage.removeItem(ADMIN_AUTH_KEY); } catch {}
    setAuthenticated(false);
  };

  useEffect(() => {
    document.documentElement.classList.add("admin-mobile-page");
    document.body.classList.add("admin-mobile-page");
    const previousTitle = document.title;
    document.title = "Fernanda Hahn Admin";

    return () => {
      document.documentElement.classList.remove("admin-mobile-page");
      document.body.classList.remove("admin-mobile-page");
      document.title = previousTitle;
    };
  }, []);

  if (!authenticated) {
    return (
      <div className="admin-mobile-shell relative min-h-dvh w-screen max-w-full overflow-hidden bg-charcoal px-4">
        {/* Glow decorativo */}
        <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-gold/10 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-24 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-rose/10 blur-3xl" />

        <div className="relative mx-auto flex min-h-dvh w-full max-w-sm items-center justify-center py-6">
          <div className="w-full rounded-3xl border border-gold/15 bg-charcoal/80 p-8 shadow-[0_25px_60px_-12px_rgba(0,0,0,0.7)] backdrop-blur-2xl space-y-7">
            {/* Logo + identidade */}
            <div className="text-center space-y-4">
              <div className="relative mx-auto h-20 w-40">
                <img src={logo} alt="Fernanda Hahn" className="h-full w-full object-contain" />
              </div>

              <div className="space-y-1">
                <p className="font-body text-[10px] tracking-[0.25em] uppercase text-gold/80 font-medium">
                  Fernanda Hahn
                </p>
                <h1 className="font-heading text-2xl font-semibold text-primary-foreground">
                  Painel Admin
                </h1>
                <p className="font-body text-[12px] text-primary-foreground/40">
                  Acesso restrito · Área administrativa
                </p>
              </div>
            </div>

            {/* Form */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                handleLogin();
              }}
              className="space-y-3"
            >
              <div>
                <label className="font-body text-[10px] uppercase tracking-widest text-primary-foreground/40 font-medium block mb-2">
                  Senha
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); if (error) setError(""); }}
                  placeholder="Digite sua senha"
                  autoFocus
                  className="w-full rounded-2xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.08] px-4 py-3.5 text-primary-foreground font-body text-[15px] placeholder:text-primary-foreground/25 focus:outline-none focus:border-gold/40 focus:ring-2 focus:ring-gold/20 transition-all"
                />
              </div>

              {error && (
                <div className="rounded-xl border border-rose/25 bg-rose/10 px-3 py-2">
                  <p className="font-body text-[12px] text-rose text-center">{error}</p>
                </div>
              )}

              <button
                type="submit"
                className="btn-entrar-admin"
              >
                Entrar no painel
              </button>
            </form>

            <p className="text-center font-body text-[10px] text-primary-foreground/25">
              🔒 Conexão segura · v1.0
            </p>
          </div>
        </div>
      </div>
    );
  }

  return <AdminPanel onLogout={handleLogout} />;
};

// ─── Admin Panel (Mobile First) ───
const AdminPanel = ({ onLogout }: { onLogout: () => void }) => {
  const { confirm } = useConfirm();
  const [tab, setTab] = useState<Tab>(() => {
    try {
      const saved = localStorage.getItem("admin_active_tab");
      if (!saved) return "dashboard";
      if (saved === "financeiro" || saved === "relatorios") return "caixa";
      if (saved === "despesas" || saved === "saidas") return "gastos";
      if (saved === "servicos") return "servicos_app";
      if (saved === "dividas" || saved === "chatbot" || saved === "produtos" || saved === "anamnese") return "dashboard";
      return saved as Tab;
    } catch {
      return "dashboard";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("admin_active_tab", tab);
    } catch {}
  }, [tab]);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [agendamentos, setAgendamentos] = useState<Agendamento[]>([]);
  const [clientes, setClientes] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("todos");
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [searchAgendamentos, setSearchAgendamentos] = useState<Agendamento[]>([]);
  const [searchClientes, setSearchClientes] = useState<Profile[]>([]);
  const [isSearching, setIsSearching] = useState(false);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedSearch(searchTerm);
    }, 450);
    return () => clearTimeout(handler);
  }, [searchTerm]);

  useEffect(() => {
    if (!debouncedSearch.trim() || !isSupabaseConfigured) {
      setSearchAgendamentos([]);
      setSearchClientes([]);
      return;
    }

    const performSearch = async () => {
      setIsSearching(true);
      try {
        // 1. Search profiles
        const { data: matchedProfiles } = await supabase
          .from("profiles")
          .select("id, nome, whatsapp, cpf, created_at, credito_saldo")
          .or(`nome.ilike.%${debouncedSearch}%,whatsapp.ilike.%${debouncedSearch}%`)
          .order("created_at", { ascending: false })
          .limit(200);

        if (matchedProfiles) {
          setSearchClientes(matchedProfiles as Profile[]);
        }

        // 2. Search agendamentos
        let query = supabase.from("agendamentos").select("*").neq("status", "aguardando_pagamento");
        
        const isDate = /^\d{4}-\d{2}-\d{2}$/.test(debouncedSearch);
        if (isDate) {
          query = query.eq("data_agendamento", debouncedSearch);
        } else {
          const profileIds = (matchedProfiles || []).map(p => p.id);
          if (profileIds.length > 0) {
            // Note: Since Postgres IN clause with empty or sparse values can be fast, we build it properly:
            const escapedIds = profileIds.join(",");
            query = query.or(`servico.ilike.%${debouncedSearch}%,cliente_nome.ilike.%${debouncedSearch}%,user_id.in.(${escapedIds})`);
          } else {
            query = query.or(`servico.ilike.%${debouncedSearch}%,cliente_nome.ilike.%${debouncedSearch}%`);
          }
        }

        const { data: searchAgs } = await query.order("data_agendamento", { ascending: false }).limit(200);
        if (searchAgs) {
          setSearchAgendamentos(searchAgs as Agendamento[]);
        }
      } catch (err) {
        console.error("Erro na busca remota:", err);
      } finally {
        setIsSearching(false);
      }
    };

    performSearch();
  }, [debouncedSearch]);

  const activeAgendamentos = searchTerm.trim() && isSupabaseConfigured ? searchAgendamentos : agendamentos;

  const [selectedClient, setSelectedClient] = useState<string | null>(null);
  const [selectedAgendaDate, setSelectedAgendaDate] = useState(() => getDateKey(new Date()));
  const [agendaDismissed, setAgendaDismissed] = useState<Set<string>>(() => {
    const saved = localStorage.getItem("agenda_dismissed");
    return saved ? new Set(JSON.parse(saved)) : new Set();
  });

  // Manual registration state
  const [showManualRegister, setShowManualRegister] = useState(false);
  const [detalheAgendamento, setDetalheAgendamento] = useState<Agendamento | null>(null);
  const [sendingConfirmacaoId, setSendingConfirmacaoId] = useState<string | null>(null);
  const [manualServicos, setManualServicos] = useState<{ id: string; nome: string; preco: number; duracao_minutos: number; categoria: string }[]>([]);

  // Load services for manual registration
  const loadManualServicos = async () => {
    if (!isSupabaseConfigured) {
      try {
        const raw = localStorage.getItem("admin_servicos_preview_servicos_app");
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed)) {
          setManualServicos(
            parsed
              .filter((s: any) => s.active !== false)
              .map((s: any) => ({
                id: s.id,
                nome: s.name ?? s.nome,
                preco: Number(s.price ?? s.preco ?? 0),
                duracao_minutos: Number(s.duration ?? s.duracao_minutos ?? 60),
                categoria: s.category ?? s.categoria ?? "Outros",
              }))
          );
          return;
        }
      } catch {
        /* ignore */
      }
    }
    const { data: servs } = await supabase.from("servicos_app").select("*").eq("ativo", true).order("ordem");
    if (servs) setManualServicos(servs.map(s => ({ id: s.id, nome: s.nome, preco: Number(s.preco), duracao_minutos: s.duracao_minutos, categoria: s.categoria })));
  };
  type ManualItem = { id: string; nome: string; valor: number; duracao: number };
  const [manualItens, setManualItens] = useState<ManualItem[]>([]);
  const [manualCliente, setManualCliente] = useState("");
  const [manualClienteNome, setManualClienteNome] = useState("");
  const [manualClienteTelefone, setManualClienteTelefone] = useState("");
  const [manualData, setManualData] = useState(() => getDateKey(new Date()));
  const [manualHorario, setManualHorario] = useState("09:00");
  const [manualHorarioFim, setManualHorarioFim] = useState("10:00");
  const [manualFormaPagamento, setManualFormaPagamento] = useState("pix");
  const [manualPaymentMode, setManualPaymentMode] = useState<"pendente" | "sinal" | "pago">("pendente");
  const [manualPago, setManualPago] = useState(false);
  const [manualValorPago, setManualValorPago] = useState<string>("");
  const [manualTroco, setManualTroco] = useState(0);
  const [manualGorjeta, setManualGorjeta] = useState(0);
  const [manualCredito, setManualCredito] = useState(0);
  const [manualShowExtras, setManualShowExtras] = useState(false);
  const [manualClientTab, setManualClientTab] = useState<"buscar" | "cadastrar">("buscar");
  const [quickRegisterLoading, setQuickRegisterLoading] = useState(false);
  // Credit discount: auto-calculated from client's wallet, debited on save
  const [manualDescontoCredito, setManualDescontoCredito] = useState(0);

  const [manualConcluido, setManualConcluido] = useState(false);
  const [manualSaving, setManualSaving] = useState(false);

  // Extend appointment state
  const [showExtendDialog, setShowExtendDialog] = useState(false);
  const [extendingId, setExtendingId] = useState<string | null>(null);
  const [extendMinutes, setExtendMinutes] = useState("30");
  const [extendSaving, setExtendSaving] = useState(false);

  // Search terms for manual register dropdowns
  const [manualServicoSearch, setManualServicoSearch] = useState("");
  const [manualClienteSearch, setManualClienteSearch] = useState("");
  const [manualServicoOpen, setManualServicoOpen] = useState(false);
  const [manualClienteOpen, setManualClienteOpen] = useState(false);

  // Edit client name state
  const [editingClientId, setEditingClientId] = useState<string | null>(null);
  const [editClientName, setEditClientName] = useState("");

  // Edit Agendamento state
  const [showEditAgendamento, setShowEditAgendamento] = useState(false);
  const [editingAg, setEditingAg] = useState<Agendamento | null>(null);
  const [editAgData, setEditAgData] = useState("");
  const [editAgHorario, setEditAgHorario] = useState("");
  const [editAgServico, setEditAgServico] = useState("");
  const [editAgServicoSearch, setEditAgServicoSearch] = useState("");
  const [editAgServicoOpen, setEditAgServicoOpen] = useState(false);
  const [editAgValor, setEditAgValor] = useState<string | number>(0);
  const [editAgValorPago, setEditAgValorPago] = useState<string | number>(0);
  const [editAgDuracao, setEditAgDuracao] = useState(60);
  const [editAgFormaPagamento, setEditAgFormaPagamento] = useState("");
  const [editAgSaving, setEditAgSaving] = useState(false);

  const openEditAgendamento = (ag: Agendamento & { _faturaId?: string, valor_fatura?: number }) => {
    loadManualServicos();
    setEditingAg(ag as any);
    setEditAgData(ag.data_agendamento);
    setEditAgHorario(ag.horario);
    setEditAgServico(ag.servico);
    setEditAgValor(ag.valor);
    setEditAgValorPago(Number(ag.valor_pago || 0));
    setEditAgDuracao(ag.duracao_minutos || 60);
    setEditAgFormaPagamento((ag.forma_pagamento && ag.forma_pagamento.includes("|")) ? "" : (ag.forma_pagamento || ""));
    setShowEditAgendamento(true);
    setDetalheAgendamento(null);
  };

  // Sinal / Partial payment state
  const [pagamentoAg, setPagamentoAg] = useState<Agendamento | null>(null);
  const [pagamentoInput, setPagamentoInput] = useState<string>("");
  const [pagamentoForma, setPagamentoForma] = useState<string>("pix");
  const [pagamentoObs, setPagamentoObs] = useState<string>("");

  const abrirRegistroPagamento = (a: Agendamento) => {
    const valorTotal = Number(a.valor);
    const pagoAtual = Number(a.valor_pago || 0);
    const restante = Math.max(0, valorTotal - pagoAtual - Number(a.valor_desconto_credito || 0));
    const sugestaoValor = pagoAtual > 0 ? restante : Math.round(valorTotal * 0.5 * 100) / 100;
    setPagamentoAg(a);
    setPagamentoInput(sugestaoValor.toFixed(2).replace(".", ","));
    setPagamentoForma(a.forma_pagamento || "pix");
    setPagamentoObs("");
  };

  const confirmarRegistroPagamento = async () => {
    if (!pagamentoAg) return;
    const valorDigitado = parseCurrencyStr(pagamentoInput);
    if (!Number.isFinite(valorDigitado) || valorDigitado <= 0) {
      toast.error("Informe um valor válido");
      return;
    }
    const a = pagamentoAg;
    const valorTotal = Number(a.valor);
    const pagoAnterior = Number(a.valor_pago || 0);
    const descontoCredito = Number(a.valor_desconto_credito || 0);
    const restanteAntes = Math.max(0, valorTotal - pagoAnterior - descontoCredito);
    const valorAbatido = restanteAntes > 0 ? Math.min(valorDigitado, restanteAntes) : valorDigitado;

    try {
      const res = await persistAppointmentPayment({
        agendamento: {
          id: a.id,
          servico: a.servico,
          variacao: a.variacao,
          valor: valorTotal,
          valor_pago: pagoAnterior,
          valor_desconto_credito: descontoCredito,
          data_agendamento: a.data_agendamento,
          forma_pagamento: a.forma_pagamento,
          cliente_nome: a.cliente_nome,
          status: a.status,
          observacao: a.observacao,
        },
        valorAdicional: valorAbatido,
        formaPagamento: pagamentoForma || "pix",
        observacao: pagamentoObs.trim(),
        origem: "agenda_admin",
      });

      setAgendamentos((prev) =>
        prev.map((item) =>
          item.id === a.id
            ? { ...item, valor_pago: res.novoValorPago, forma_pagamento: pagamentoForma || "pix", paid_at: res.paidAt }
            : item
        )
      );
      setPagamentoAg(null);
      setPagamentoInput("");
      setPagamentoObs("");

      if (res.quitada) {
        toast.success("Pagamento quitado e lançado no Caixa ✅");
      } else {
        toast.success(`Parcela lançada no Caixa · falta R$ ${res.restante.toFixed(2).replace(".", ",")}`);
      }
    } catch (err: any) {
      toast.error(err?.message || "Erro ao registrar pagamento");
    }
  };

  const handleSaveEditAgendamento = async () => {
    if (!editingAg) return;
    const finalValor = Number(editAgValor);
    const finalValorPago = Number(editAgValorPago);
    if (!editAgData || !editAgHorario || !editAgServico || finalValor < 0 || finalValorPago < 0 || editAgDuracao <= 0) {
      toast.error("Preencha todos os campos corretamente");
      return;
    }
    setEditAgSaving(true);
    try {
      let newForma = editAgFormaPagamento;
      if (editingAg._faturaId && (editingAg as any).valor_fatura) {
        const faturaValor = Number((editingAg as any).valor_fatura);
        const oldForma = editingAg.forma_pagamento || "Outro";
        if (!oldForma.includes("|") && oldForma !== editAgFormaPagamento) {
           const remainingVal = Math.max(0, finalValorPago - faturaValor);
           if (remainingVal > 0) {
              newForma = `${oldForma}:${remainingVal}|${editAgFormaPagamento}:${faturaValor}`;
           }
        }
      }

      const paymentChanged = finalValorPago !== Number(editingAg.valor_pago || 0);
      const { error } = await supabase.from("agendamentos").update({
        data_agendamento: editAgData,
        horario: editAgHorario,
        servico: editAgServico,
        valor: finalValor,
        valor_pago: finalValorPago,
        duracao_minutos: editAgDuracao,
        forma_pagamento: newForma,
        ...(paymentChanged ? { paid_at: new Date().toISOString() } : {}),
      } as any).eq("id", editingAg.id);

      if (error) throw error;

      try {
        const statusFromValor = (p: number, t: number) => {
          if (p >= t) return "quitado";
          if (p > 0) return "sinal";
          return "pendente";
        };
        const { data: userRes } = await supabase.auth.getUser();
        await supabase.from("pagamento_historico").insert({
          agendamento_id: editingAg.id,
          status_anterior: statusFromValor(Number(editingAg.valor_pago || 0), Number(editingAg.valor)),
          status_novo: statusFromValor(finalValorPago, finalValor),
          valor_anterior: Number(editingAg.valor_pago || 0),
          valor_novo: finalValorPago,
          valor_delta: finalValorPago - Number(editingAg.valor_pago || 0),
          total: finalValor,
          acao: "ajuste_admin",
          autor_id: userRes?.user?.id || null,
          autor_nome: (userRes?.user?.user_metadata as any)?.nome || userRes?.user?.email || "Admin",
        });
      } catch (err) {}

      setAgendamentos(prev => prev.map(a => a.id === editingAg.id ? {
        ...a,
        data_agendamento: editAgData,
        horario: editAgHorario,
        servico: editAgServico,
        valor: finalValor,
        valor_pago: finalValorPago,
        duracao_minutos: editAgDuracao,
        forma_pagamento: newForma
      } : a));
      toast.success("Agendamento atualizado!");
      setShowEditAgendamento(false);
    } catch (e: any) {
      toast.error("Erro ao atualizar agendamento");
    } finally {
      setEditAgSaving(false);
    }
  };

  const handleSaveClientName = async (agId: string) => {
    const name = editClientName.trim();
    const { error } = await supabase.from("agendamentos").update({ cliente_nome: name || null } as any).eq("id", agId);
    if (error) { toast.error("Erro ao salvar nome"); return; }
    setAgendamentos(prev => prev.map(a => a.id === agId ? { ...a, cliente_nome: name || null } : a));
    setEditingClientId(null);
    toast.success("Nome do cliente atualizado");
  };

  const handleNewAgendamento = useCallback((newAg: any) => {
    // Insere otimisticamente no estado local sem recarregar tudo
    setAgendamentos((prev) => {
      if (prev.find(a => a.id === newAg.id)) return prev;
      return [newAg, ...prev];
    });
  }, []);

  const handleAgendamentoChange = useCallback(() => {
    // Reload completo como fallback de segurança
    supabase
      .from("agendamentos")
      .select("*")
      .neq("status", "aguardando_pagamento")
      .order("data_agendamento", { ascending: false })
      .limit(1000)
      .then(({ data }) => {
        if (data) setAgendamentos(data as Agendamento[]);
      });
  }, []);

  // Atualização pontual via realtime — zero queries ao banco
  // Chamado em todo UPDATE de agendamento, substituindo o reload completo
  const handleAgendamentoPontualUpdate = useCallback((updated: Agendamento) => {
    setAgendamentos((prev) =>
      prev.map((a) => (a.id === updated.id ? { ...a, ...updated } : a))
    );
  }, []);

  // Remoção pontual via realtime — zero queries ao banco
  // Chamado em todo DELETE de agendamento, eliminando o reload massivo de 1500 registros
  const handleAgendamentoPontualDelete = useCallback((deletedId: string) => {
    setAgendamentos((prev) => prev.filter((a) => a.id !== deletedId));
  }, []);

  const {
    notificationsEnabled,
    toggleNotifications,
  } = useAdminNotifications(
    true,
    handleNewAgendamento,
    handleAgendamentoChange,
    handleAgendamentoPontualUpdate,
    handleAgendamentoPontualDelete,
    agendamentos
  );

  useEffect(() => {
    loadData();
  }, []);
  // Desbloqueia o áudio de notificação no primeiro toque/clique (iOS/Safari)
  useEffect(() => {
    const unlock = () => {
      unlockNotificationAudio();
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [agRes, clRes] = await Promise.all([
        // FIX: SELECT de colunas necessárias em vez de wildcard para otimizar transferência e memória no Nano
        supabase.from("agendamentos")
          .select("id,servico,variacao,data_agendamento,horario,valor,valor_pago,valor_troco,valor_gorjeta,valor_credito,valor_desconto_credito,status,forma_pagamento,cliente_nome,user_id,origem,created_at,observacao,duracao_minutos,paid_at,payment_id,payer_name,receipt_url")
          .neq("status", "aguardando_pagamento")
          .order("data_agendamento", { ascending: false })
          .limit(1500),
        // Profiles: seleciona só as colunas necessárias para reduzir I/O
        supabase.from("profiles").select("id, nome, whatsapp, cpf, created_at, credito_saldo").order("created_at", { ascending: false }).limit(1000),
      ]);
      if (agRes.error) throw agRes.error;
      if (clRes.error) throw clRes.error;
      if (agRes.data) setAgendamentos(agRes.data as Agendamento[]);
      if (clRes.data) setClientes(clRes.data as Profile[]);
    } catch (e: any) {
      console.error("Erro ao carregar dados:", e);
      toast.error("Falha ao carregar dados. O banco de dados pode estar offline ou pausado.");
    } finally {
      setLoading(false);
    }
  };

  const updateStatus = async (id: string, status: string) => {
    await supabase.from("agendamentos").update({ status }).eq("id", id);
    setAgendamentos((prev) => prev.map((a) => (a.id === id ? { ...a, status } : a)));
    setDetalheAgendamento((prev) => (prev && prev.id === id ? { ...prev, status } : prev));
    const ag = agendamentos.find((a) => a.id === id);
    if (status === "confirmado") {
      toast.success("Agendamento marcado como confirmado");
      void notifyAgendamentoConfirmadoById(id).then((res) => {
        if (res && !res.ok && !res.skipped) {
          toast.error(`Falha ao enviar confirmação via WhatsApp: ${res.error || "tente reenviar nos detalhes"}`);
        }
      });
      if (ag?.user_id) {
        sendPush({
          role: "cliente",
          user_id: ag.user_id,
          title: "✅ Agendamento confirmado!",
          message: `Seu ${ag.servico} de ${ag.data_agendamento} às ${ag.horario} foi confirmado.`,
          url: "/",
        });
      }
    } else if (status === "cancelado") {
      toast.success("Agendamento cancelado");
      notifyLembreteById(id, "cancelamento");
      // Push cliente
      if (ag?.user_id) {
        sendPush({
          role: "cliente",
          user_id: ag.user_id,
          title: "Agendamento cancelado",
          message: `Seu ${ag.servico} de ${ag.data_agendamento} às ${ag.horario} foi cancelado.`,
        });
      }
    } else if (status === "concluido") {
      toast.success("Atendimento concluído!");
      notifyLembreteById(id, "comparecimento");
      notifyLembreteById(id, "pos_atendimento");
    } else if (status === "falta") {
      toast.success("Marcado como falta");
    }
  };

  const deleteAgendamento = async (id: string) => {
    await supabase.from("agendamentos").delete().eq("id", id);
    setAgendamentos((prev) => prev.filter((a) => a.id !== id));
    setDetalheAgendamento((prev) => (prev && prev.id === id ? null : prev));
    toast.success("Agendamento excluído");
  };

  const tabs: { id: Tab; label: string; icon: React.ComponentType<any>; anim: string; color: string }[] = [
    { id: "dashboard", label: "Início", icon: BarChart3, anim: "tab-icon-dashboard", color: "#22d3ee" },
    { id: "agendamentos", label: "Agenda", icon: Calendar, anim: "tab-icon-calendar", color: "#f59e0b" },
    { id: "pedidos", label: "Pedidos", icon: ClipboardList, anim: "tab-icon-bounce", color: "#facc15" },
    { id: "caixa", label: "Caixa", icon: Wallet, anim: "tab-icon-spin", color: "#14b8a6" },
    { id: "pagamentos", label: "Pagamentos", icon: CreditCard, anim: "tab-icon-swipe", color: "#3b82f6" },
    { id: "gastos", label: "Gastos", icon: Receipt, anim: "tab-icon-shake", color: "#ef4444" },
    { id: "clientes", label: "Clientes", icon: Users, anim: "tab-icon-wave", color: "#a855f7" },
    { id: "avaliacoes", label: "Avaliações", icon: Star, anim: "tab-icon-bounce", color: "#fbbf24" },
    { id: "gateway", label: "Gateway", icon: Wallet, anim: "tab-icon-spin", color: "#84cc16" },
    { id: "horarios", label: "Horários", icon: Clock, anim: "tab-icon-tick", color: "#60a5fa" },
    { id: "servicos_app", label: "Serviços", icon: Sparkles, anim: "tab-icon-cog", color: "#eab308" },
  ];

  const total = agendamentos.length;
  const confirmados = agendamentos.filter((a) => a.status === "confirmado").length;
  const cancelados = agendamentos.filter((a) => a.status === "cancelado").length;
  const concluidos = agendamentos.filter((a) => a.status === "concluido").length;
  const faltas = agendamentos.filter((a) => a.status === "falta").length;
  const faturamento = agendamentos
    .filter((a) => a.status !== "cancelado" && a.status !== "falta")
    .reduce((sum, a) => sum + (a.valor_pago || 0), 0);

  const getClientName = (userId: string, clienteNome?: string | null) => {
    if (clienteNome) return clienteNome;
    return clientes.find((c) => c.id === userId)?.nome || "Presencial";
  };
  const formatDate = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" });
  const formatWhatsapp = (w: string) => {
    if (!w) return "—";
    let d = w.replace(/\D/g, "");
    if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
    if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
    if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
    return w;
  };

  const filteredAgendamentos = activeAgendamentos.filter((a) => {
    if (a.servico === "Adição de Crédito" || a.servico === "Entrada Manual" || (a.servico && a.servico.startsWith("Pagamento de Dívida"))) return false;
    if (statusFilter !== "todos" && a.status !== statusFilter) return false;
    if (searchTerm) {
      const name = getClientName(a.user_id, (a as any).cliente_nome).toLowerCase();
      return name.includes(searchTerm.toLowerCase()) || a.servico.toLowerCase().includes(searchTerm.toLowerCase());
    }
    return true;
  });

  const statusBadge = (s: string) => {
    const map: Record<string, string> = {
      confirmado: "bg-gold/10 text-gold border-gold/20",
      cancelado: "bg-rose/10 text-rose border-rose/20",
      concluido: "bg-green-500/10 text-green-500 border-green-500/20",
      falta: "bg-orange-500/10 text-orange-500 border-orange-500/20",
    };
    const labels: Record<string, string> = { confirmado: "Confirmado", cancelado: "Cancelado", concluido: "Concluído", falta: "Não veio" };
    return <span className={`px-2 py-0.5 rounded-full text-[10px] font-body font-medium border ${map[s] || "bg-secondary text-muted-foreground border-border"}`}>{labels[s] || s}</span>;
  };

  const formatFormaPagamento = (f: string | null | undefined) => {
    if (!f) return "—";
    const map: Record<string, string> = {
      pix: "PIX",
      pix_mp: "PIX (online)",

      cartao: "Cartão",
      boleto: "Boleto",
      dinheiro: "Dinheiro",
      pendente: "A combinar",
    };
    return map[f.toLowerCase()] || f.charAt(0).toUpperCase() + f.slice(1);
  };

  const pagamentoBadge = (a: Agendamento) => {

    const pago = Number(a.valor_pago || 0);
    const totalValor = Number(a.valor);
    if (pago >= totalValor) return <span className="px-2 py-0.5 rounded-full text-[10px] font-body font-medium border bg-green-500/10 text-green-500 border-green-500/20">Pago</span>;
    if (pago > 0) return <span className="px-2 py-0.5 rounded-full text-[10px] font-body font-medium border bg-gold/10 text-gold border-gold/20">Sinal pago</span>;
    return <span className="px-2 py-0.5 rounded-full text-[10px] font-body font-medium border bg-amber-500/10 text-amber-400 border-amber-500/30">Não pago</span>;
  };


  const updatePayment = async (id: string, type: "sinal" | "completo") => {
    const a = agendamentos.find((item) => item.id === id);
    if (!a) return;
    const valor = Number(a.valor);

    let newPago = type === "completo" ? valor : valor * 0.5;
    let creditoUsado = 0;
    let novoDescontoCredito = Number(a.valor_desconto_credito || 0);

    if (type === "completo" && a.user_id) {
      const { data: profile } = await supabase.from("profiles").select("credito_saldo").eq("id", a.user_id).single();
      const saldo = Number(profile?.credito_saldo || 0);
      if (saldo > 0) {
        const valorFaltante = Math.max(0, valor - Number(a.valor_pago || 0) - novoDescontoCredito);
        creditoUsado = Math.min(saldo, valorFaltante);
        if (creditoUsado > 0) {
          await supabase.from("profiles").update({ credito_saldo: saldo - creditoUsado }).eq("id", a.user_id);
          novoDescontoCredito += creditoUsado;
          toast.success(`Crédito de R$ ${creditoUsado.toFixed(2)} utilizado automaticamente!`);
        }
      }
      newPago = Math.max(0, valor - novoDescontoCredito);
    }

    await supabase.from("agendamentos").update({
      valor_pago: newPago,
      valor_desconto_credito: novoDescontoCredito,
      paid_at: new Date().toISOString(),
    }).eq("id", id);
    setAgendamentos((prev) => prev.map((item) => (item.id === id ? { ...item, valor_pago: newPago, valor_desconto_credito: novoDescontoCredito } : item)));
  };



  // Helpers para converter horário <-> minutos
  const timeToMinutes = (t: string): number => {
    const [h, m] = t.split(":").map(Number);
    return (h || 0) * 60 + (m || 0);
  };
  const minutesToTime = (mins: number): string => {
    const total = ((mins % 1440) + 1440) % 1440;
    const h = Math.floor(total / 60);
    const m = total % 60;
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
  };
  const calcFim = (inicio: string, duracao: string | number): string => {
    return minutesToTime(timeToMinutes(inicio) + (Number(duracao) || 0));
  };
  const calcDuracao = (inicio: string, fim: string): number => {
    let diff = timeToMinutes(fim) - timeToMinutes(inicio);
    if (diff <= 0) diff += 1440; // passa da meia-noite
    return diff;
  };

  const manualDuracaoTotal = manualItens.reduce((s, it) => s + (Number(it.duracao) || 0), 0);
  const manualValorTotal = manualItens.reduce((s, it) => s + (Number(it.valor) || 0), 0);

  const handleManualHorarioChange = (novoInicio: string) => {
    const durAtual = manualDuracaoTotal > 0 ? manualDuracaoTotal : (calcDuracao(manualHorario, manualHorarioFim) || 60);
    setManualHorario(novoInicio);
    if (novoInicio) {
      setManualHorarioFim(calcFim(novoInicio, durAtual));
    }
  };
  const handleManualHorarioFimChange = (novoFim: string) => {
    setManualHorarioFim(novoFim);
    const nova = calcDuracao(manualHorario, novoFim);
    if (manualItens.length >= 1) {
      setManualItens(prev => prev.map((it, i) => i === 0 ? { ...it, duracao: nova } : it));
    }
  };

  // Recalcula horário fim sempre que a duração dos serviços mudar
  useEffect(() => {
    if (manualDuracaoTotal > 0) {
      setManualHorarioFim(calcFim(manualHorario, manualDuracaoTotal));
    }
  }, [manualDuracaoTotal, manualHorario]);

  const addManualItem = (itemName: string) => {
    const svc = manualServicos.find(s => s.nome === itemName);
    const novo: ManualItem = {
      id: (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`),
      nome: itemName,
      valor: svc ? Number(svc.preco) : 0,
      duracao: svc ? Number(svc.duracao_minutos) : 60,
    };
    setManualItens(prev => [...prev, novo]);
  };
  const updateManualItem = (id: string, patch: Partial<ManualItem>) => {
    setManualItens(prev => prev.map(it => it.id === id ? { ...it, ...patch } : it));
  };
  const removeManualItem = (id: string) => {
    setManualItens(prev => prev.filter(it => it.id !== id));
  };

  const openManualRegister = (initialTime?: string) => {
    loadManualServicos();
    setManualItens([]);
    setManualCliente("");
    setManualClienteNome(""); setManualClienteTelefone("");
    setManualData(selectedAgendaDate);
    setManualHorario(initialTime || "09:00");
    setManualHorarioFim(initialTime ? calcFim(initialTime, 60) : "10:00");
    setManualFormaPagamento("pix");
    setManualPaymentMode("pendente");
    setManualPago(false);
    setManualValorPago("");
    setManualConcluido(false);
    setManualTroco(0);
    setManualGorjeta(0);
    setManualCredito(0);
    setManualDescontoCredito(0);
    setManualShowExtras(false);
    setManualClientTab("buscar");
    setQuickRegisterLoading(false);
    setManualServicoSearch("");
    setManualClienteSearch("");
    setManualServicoOpen(false);
    setManualClienteOpen(false);
    setShowManualRegister(true);
  };

  const openManualRegisterForClient = (cliente: Profile) => {
    openManualRegister();
    setManualCliente(cliente.id);
    setManualClienteNome(cliente.nome);
    setManualClienteTelefone(cliente.whatsapp || "");
    setTab("agendamentos");
  };

  // Cadastra cliente no sistema (reutilizado no botão "+ Cadastrar nova", na aba Clientes e no envio do formulário)
  const ensureClientRegistered = async (
    nome: string,
    telefone: string,
    opts?: { cpf?: string; creditoInicial?: number }
  ) => {
    const cleanNome = nome.trim();
    const cleanPhone = telefone.replace(/\D/g, "");
    const cleanCpf = (opts?.cpf || "").replace(/\D/g, "");
    const creditoInicial = Math.max(0, Number(opts?.creditoInicial || 0));
    if (!cleanNome) throw new Error("Informe o nome da cliente");

    if (cleanPhone) {
      const normalized = normalizeWhatsappNumber(cleanPhone);
      const existing = clientes.find((c) => {
        const cClean = (c.whatsapp || "").replace(/\D/g, "");
        if (!cClean) return false;
        return cClean === cleanPhone || normalizeWhatsappNumber(cClean) === normalized;
      });
      if (existing) {
        return { id: existing.id, nome: existing.nome, whatsapp: existing.whatsapp || cleanPhone, existing: true };
      }
    }

    if (!isSupabaseConfigured) {
      const localId = globalThis.crypto?.randomUUID?.() || `local-${Date.now()}`;
      const novoPerfil: Profile = {
        id: localId,
        nome: cleanNome,
        whatsapp: cleanPhone,
        cpf: cleanCpf || null,
        created_at: new Date().toISOString(),
        credito_saldo: creditoInicial,
      };
      setClientes((prev) => [novoPerfil, ...prev]);
      return { id: localId, nome: cleanNome, whatsapp: cleanPhone, existing: false };
    }

    const fakeEmail = `manual_${globalThis.crypto?.randomUUID?.() || Date.now()}@fernandahahn.app`;
    const authResponse = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
      method: "POST",
      headers: {
        apikey: SUPABASE_PUBLISHABLE_KEY,
        Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: fakeEmail,
        password: `Manual@${Date.now()}!XyZ`,
        data: {
          nome: cleanNome,
          whatsapp: cleanPhone,
          ...(cleanCpf ? { cpf: cleanCpf } : {}),
        },
      }),
    });

    if (!authResponse.ok) {
      const errText = await authResponse.text();
      throw new Error(errText || "Falha ao cadastrar cliente no sistema");
    }

    const result = await authResponse.json();
    const newId = result.id || result.user?.id;
    if (!newId) {
      throw new Error("Resposta inválida ao cadastrar cliente");
    }

    if (creditoInicial > 0) {
      await (supabase as any)
        .rpc("admin_set_credito_saldo", {
          p_user_id: newId,
          p_novo_saldo: creditoInicial,
        })
        .catch(() => {});
    }

    const novoPerfil: Profile = {
      id: newId,
      nome: cleanNome,
      whatsapp: cleanPhone,
      cpf: cleanCpf || null,
      created_at: new Date().toISOString(),
      credito_saldo: creditoInicial,
    };
    setClientes((prev) => (prev.some((c) => c.id === newId) ? prev : [novoPerfil, ...prev]));
    return { id: newId, nome: cleanNome, whatsapp: cleanPhone, existing: false };
  };

  const handleQuickClientSignup = async () => {
    const cleanNome = manualClienteNome.trim();
    const cleanPhone = manualClienteTelefone.replace(/\D/g, "");
    if (cleanNome.length < 2) {
      toast.error("Informe o nome completo da cliente");
      return;
    }
    if (cleanPhone.length < 10) {
      toast.error("Informe um telefone/WhatsApp válido com DDD");
      return;
    }

    setQuickRegisterLoading(true);
    try {
      const res = await ensureClientRegistered(cleanNome, cleanPhone);
      setManualCliente(res.id);
      setManualClienteNome(res.nome);
      setManualClienteTelefone(res.whatsapp);
      setManualClientTab("buscar");
      setManualClienteOpen(false);
      toast.success(
        res.existing
          ? `${res.nome} já estava cadastrada e foi selecionada!`
          : `${res.nome} cadastrada no sistema com sucesso!`
      );
    } catch (err: any) {
      toast.error(err?.message || "Não foi possível cadastrar a cliente agora");
    } finally {
      setQuickRegisterLoading(false);
    }
  };



  const saveManualRegistration = async () => {
    if (!manualData || !manualHorario) {
      toast.error("Preencha data e horário");
      return;
    }
    if (manualItens.some(it => Number(it.valor) < 0 || Number(it.duracao) <= 0)) {
      toast.error("Serviços precisam ter duração, e o valor não pode ser negativo.");
      return;
    }
    setManualSaving(true);
    try {
      let userId = manualCliente || null;
      const isApenasCredito = manualItens.length === 0 && manualCredito > 0;
      const isReservaSemServico = manualItens.length === 0 && manualCredito <= 0;
      const duracao = isReservaSemServico
        ? (calcDuracao(manualHorario, manualHorarioFim) || 60)
        : (manualDuracaoTotal || 60);
      const valor = isApenasCredito ? manualCredito : manualValorTotal;

      // Agrupa duplicados: "Perfuração (×3), Troca de joia"
      const counts = new Map<string, number>();
      manualItens.forEach(it => counts.set(it.nome, (counts.get(it.nome) || 0) + 1));
      const servicoLabel = manualItens.length > 0
        ? Array.from(counts.entries())
          .map(([nome, qtd]) => qtd > 1 ? `${nome} (×${qtd})` : nome)
          .join(", ")
        : isApenasCredito ? "Adição de Crédito" : "A definir";

      const clienteNome = manualCliente
        ? (clientes.find(c => c.id === manualCliente)?.nome || "")
        : manualClienteNome.trim();

      // Auto-registrar o cliente caso seja inserido nome novo
      if (!userId && clienteNome) {
        try {
          const registered = await ensureClientRegistered(clienteNome, manualClienteTelefone);
          userId = registered.id;
        } catch (authErr) {
          console.error("Erro na requisição para criar cliente:", authErr);
        }
      }

      // --- Debit client credit if auto-discount was applied ---
      const clienteCredito = manualCliente
        ? Number(clientes.find(c => c.id === manualCliente)?.credito_saldo || 0)
        : 0;
      const descontoAplicado = Math.min(clienteCredito, manualValorTotal);

      if (descontoAplicado > 0 && userId) {
        const saldoAposDesconto = clienteCredito - descontoAplicado;
        const { error: debitErr } = await (supabase as any).rpc("admin_set_credito_saldo", {
          p_user_id: userId,
          p_novo_saldo: saldoAposDesconto,
        });
        if (debitErr) {
          console.error("Erro ao debitar crédito:", debitErr);
          toast.error("Atenção: crédito não foi debitado: " + debitErr.message);
        } else {
          setClientes(prev => prev.map(c => c.id === userId ? { ...c, credito_saldo: saldoAposDesconto } : c));
        }
      }

      if (manualCredito > 0 && userId) {
        // Fetch current balance first
        const { data: profile } = await supabase
          .from("profiles")
          .select("credito_saldo")
          .eq("id", userId)
          .maybeSingle();
        const currentCredit = Number(profile?.credito_saldo || 0);
        const novoSaldo = currentCredit + manualCredito;
        // Use RPC with SECURITY DEFINER to bypass RLS
        const { error: creditErr } = await (supabase as any).rpc("admin_set_credito_saldo", {
          p_user_id: userId,
          p_novo_saldo: novoSaldo,
        });
        if (creditErr) {
          console.error("Erro ao salvar crédito do cliente:", creditErr);
          toast.error("Registro salvo, mas falha ao adicionar crédito: " + creditErr.message);
        } else {
          setClientes(prev =>
            prev.some(c => c.id === userId)
              ? prev.map(c => c.id === userId ? { ...c, credito_saldo: novoSaldo } : c)
              : [{ id: userId!, nome: clienteNome, whatsapp: "", created_at: new Date().toISOString(), credito_saldo: novoSaldo }, ...prev]
          );
        }
      }

      const valorPagoInicial = isApenasCredito
        ? valor
        : (manualPago
          ? (manualValorPago
            ? parseCurrencyStr(manualValorPago)
            : Math.max(0, valor - (descontoAplicado > 0 ? descontoAplicado : 0)))
          : 0);
      const { data, error } = await supabase.from("agendamentos").insert({
        servico: servicoLabel,
        data_agendamento: manualData,
        horario: manualHorario,
        valor: valor,
        valor_pago: valorPagoInicial,
        paid_at: valorPagoInicial > 0 ? new Date().toISOString() : null,
        valor_troco: manualTroco,
        valor_gorjeta: manualGorjeta,
        valor_credito: isApenasCredito ? 0 : manualCredito,
        valor_desconto_credito: descontoAplicado > 0 ? descontoAplicado : null,
        duracao_minutos: duracao,
        status: isApenasCredito ? "concluido" : isReservaSemServico ? "confirmado" : (manualConcluido ? "concluido" : "confirmado"),
        forma_pagamento: manualFormaPagamento,
        user_id: userId,
        cliente_nome: clienteNome || null,
        origem: "admin_manual",
      } as any).select().single();
      
      if (error) throw error;
      if (data) {
        setAgendamentos(prev => [data as Agendamento, ...prev]);

        toast.success("Atendimento registrado com sucesso!");
        setShowManualRegister(false);
        void notifyAgendamentoConfirmadoById((data as Agendamento).id).then((res) => {
          if (!res) return;
          if (res.ok) {
            toast.success("Confirmação enviada para a cliente via WhatsApp!");
          } else if (!res.skipped) {
            toast.error(`Atendimento salvo, mas o WhatsApp via API falhou: ${res.error || "use o botão nos detalhes do agendamento"}`);
          }
        });
        sendPush({
          role: "admin",
          title: "🔔 Novo Agendamento!",
          message: `${clienteNome || "Presencial"} — ${servicoLabel} em ${manualData} às ${manualHorario}`,
          url: "/admin/",
        });
      }
    } catch (err: any) {
      toast.error("Erro ao registrar: " + (err.message || "Tente novamente"));
    }
    setManualSaving(false);
  };

  const handleEnviarConfirmacaoWpp = async (ag: Agendamento) => {
    setSendingConfirmacaoId(ag.id);
    try {
      const res = await notifyAgendamentoConfirmadoById(ag.id, { force: true });
      if (res.ok) {
        toast.success("Mensagem de confirmação enviada via WhatsApp!");
      } else if (res.reason === "NO_NUMBER") {
        toast.error("Cliente não possui número de WhatsApp cadastrado.");
      } else {
        toast.error(res.error || "Não foi possível enviar a confirmação via API.");
      }
    } catch (err: any) {
      toast.error(err?.message || "Erro ao enviar confirmação via API.");
    } finally {
      setSendingConfirmacaoId(null);
    }
  };


  const openExtendDialog = (id: string) => {
    setExtendingId(id);
    setExtendMinutes("30");
    setShowExtendDialog(true);
  };

  const saveExtendAppointment = async () => {
    if (!extendingId) return;
    const ag = agendamentos.find(a => a.id === extendingId);
    if (!ag) return;
    setExtendSaving(true);
    try {
      const extraMin = Number(extendMinutes) || 30;
      const newDuration = (ag.duracao_minutos || 60) + extraMin;
      
      // The trigger manage_blocked_slots handles slot recalculation on duration change
      const { error } = await supabase.from("agendamentos").update({
        duracao_minutos: newDuration,
        foi_estendido: true,
        updated_at: new Date().toISOString(),
      } as any).eq("id", extendingId);
      
      if (error) throw error;
      
      setAgendamentos(prev => prev.map(a => a.id === extendingId ? { ...a, duracao_minutos: newDuration } : a));
      toast.success(`Duração estendida para ${newDuration} minutos (+${extraMin}min)`);
      setShowExtendDialog(false);
    } catch (err: any) {
      toast.error("Erro ao estender: " + (err.message || "Tente novamente"));
    }
    setExtendSaving(false);
  };

  const todayAgendaKey = getDateKey(new Date());
  const selectedAgendaDateObj = parseDateKey(selectedAgendaDate);
  const agendaDatesWithAppointments = Array.from(
    new Set(filteredAgendamentos.map((item) => item.data_agendamento).filter((d): d is string => Boolean(d)))
  ).sort((a, b) => a.localeCompare(b));
  const selectedAgendaItems = filteredAgendamentos
    .filter((item) => item.data_agendamento === selectedAgendaDate)
    .sort((a, b) => a.horario.localeCompare(b.horario));
  const selectedAgendaTotal = selectedAgendaItems.reduce((sum, item) => sum + Math.max(0, Number(item.valor) - Number(item.valor_desconto_credito || 0)), 0);
  const selectedAgendaPago = selectedAgendaItems.reduce((sum, item) => sum + Number(item.valor_pago || 0), 0);
  const selectedAgendaLabel = selectedAgendaDate === todayAgendaKey
    ? "Hoje"
    : selectedAgendaDateObj.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

  // Agenda notifications
  const agendaNotifs = useMemo(() => {
    const today = getDateKey(new Date());
    const todayDate = new Date(today + "T12:00:00");
    const notifs: { tipo: "hoje" | "falta" | "pendente" | "proximo"; ag: Agendamento; label: string }[] = [];
    agendamentos.forEach((a) => {
      if (a.status === "cancelado" || a.servico === "Adição de Crédito" || a.servico === "Entrada Manual" || (a.servico && a.servico.startsWith("Pagamento de Dívida"))) return;
      const aDate = new Date(a.data_agendamento + "T12:00:00");
      const diff = Math.round((aDate.getTime() - todayDate.getTime()) / (1000 * 60 * 60 * 24));
      if (a.status === "falta") { notifs.push({ tipo: "falta", ag: a, label: "Cliente faltou" }); return; }
      if (diff === 0 && a.status === "confirmado") notifs.push({ tipo: "hoje", ag: a, label: `Hoje às ${a.horario}` });
      if (diff === 1 && a.status === "confirmado") notifs.push({ tipo: "proximo", ag: a, label: "Amanhã" });
      if (a.status !== "falta" && (Number(a.valor_pago || 0) + Number(a.valor_desconto_credito || 0)) < Number(a.valor) && diff <= 0) notifs.push({ tipo: "pendente", ag: a, label: `Falta R$ ${(Number(a.valor) - Number(a.valor_pago || 0) - Number(a.valor_desconto_credito || 0)).toFixed(2).replace(".", ",")}` });
    });
    const order = { falta: 0, hoje: 1, pendente: 2, proximo: 3 };
    notifs.sort((x, y) => order[x.tipo] - order[y.tipo]);
    return notifs;
  }, [agendamentos]);

  const activeAgendaNotifs = useMemo(
    () => agendaNotifs.filter((n) => !agendaDismissed.has(n.ag.id + n.tipo)),
    [agendaNotifs, agendaDismissed]
  );

  const dismissAgendaNotif = (id: string, tipo: string) => {
    setAgendaDismissed((prev) => {
      const next = new Set(prev); next.add(id + tipo);
      localStorage.setItem("agenda_dismissed", JSON.stringify([...next]));
      return next;
    });
  };

  const clearAgendaNotifs = () => {
    const keys = activeAgendaNotifs.map((n) => n.ag.id + n.tipo);
    setAgendaDismissed((prev) => {
      const next = new Set([...prev, ...keys]);
      localStorage.setItem("agenda_dismissed", JSON.stringify([...next]));
      return next;
    });
  };

  const agendaNotifConfig: Record<string, { bg: string; iconColor: string; titleColor: string }> = {
    hoje: { bg: "bg-gold/10 border-gold/25", iconColor: "text-gold", titleColor: "text-gold" },
    proximo: { bg: "bg-blue-500/10 border-blue-500/25", iconColor: "text-blue-400", titleColor: "text-blue-400" },
    pendente: { bg: "bg-red-500/10 border-red-500/25", iconColor: "text-red-400", titleColor: "text-red-400" },
    falta: { bg: "bg-orange-500/10 border-orange-500/25", iconColor: "text-orange-400", titleColor: "text-orange-400" },
  };

  return (
    <div className="admin-mobile-shell min-h-dvh w-screen max-w-full overflow-x-hidden bg-charcoal lg:flex">
      {/* ── Desktop Sidebar (hidden on mobile) ── */}
      <aside className="hidden lg:flex lg:flex-col lg:w-56 lg:shrink-0 lg:border-r lg:border-primary-foreground/[0.06] lg:bg-charcoal lg:fixed lg:inset-y-0 lg:left-0 lg:z-30">
        <div className="px-5 pt-6 pb-4 border-b border-primary-foreground/[0.06]">
          <h1 className="font-heading text-lg font-semibold text-primary-foreground">Admin</h1>
          <p className="font-body text-[11px] text-primary-foreground/30">Fernanda Hahn</p>
        </div>
        <nav className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-body text-[13px] font-medium transition-all ${
                tab === t.id
                  ? "tab-active bg-gold/10 text-gold"
                  : "text-primary-foreground/40 hover:bg-primary-foreground/[0.04] hover:text-primary-foreground/60"
              }`}
            >
              <t.icon
                className={`h-4 w-4 shrink-0 tab-icon ${t.anim}`}
                style={{ color: tab === t.id ? undefined : t.color }}
              />
              {t.label}
            </button>
          ))}
        </nav>
        <div className="px-3 py-3 border-t border-primary-foreground/[0.06] space-y-1">
          <Sheet>
            <SheetTrigger asChild>
              <button className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-body text-[13px] text-primary-foreground/40 hover:bg-gold/10 hover:text-gold transition-all">
                <Bell className="h-4 w-4 shrink-0" />
                Lembretes
              </button>
            </SheetTrigger>
            <SheetContent side="right" className="w-[calc(100vw-0.75rem)] max-w-[22rem] overflow-x-hidden overflow-y-auto border-primary-foreground/[0.06] bg-charcoal p-0">
              <LembretesHub />
            </SheetContent>
          </Sheet>
          <button onClick={onLogout} className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 font-body text-[13px] text-rose/60 hover:bg-rose/10 hover:text-rose transition-all">
            <LogOut className="h-4 w-4 shrink-0" />
            Sair
          </button>
        </div>
      </aside>

      {/* ── Main content area ── */}
      <div className="flex-1 lg:ml-56">
        {/* Modal: Registrar pagamento parcial / sinal */}
        <Dialog open={!!pagamentoAg} onOpenChange={(open) => { if (!open) { setPagamentoAg(null); setPagamentoInput(""); } }}>
          <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-[360px] mx-auto bg-charcoal border-primary-foreground/[0.08] rounded-2xl p-0 sm:p-0 shadow-2xl overflow-hidden">
            {pagamentoAg && (() => {
              const valorTotal = Number(pagamentoAg.valor);
              const jaPago = Number(pagamentoAg.valor_pago || 0);
              const valorAtual = Number((pagamentoInput || "0").replace(/\./g, "").replace(",", ".")) || 0;
              const novoTotal = Math.min(valorTotal, jaPago + valorAtual);
              const novoRestante = Math.max(0, valorTotal - novoTotal);
              
              return (
                <div className="p-4 space-y-3 mx-auto w-full">
                  <DialogHeader>
                    <DialogTitle className="font-heading text-[16px] font-semibold text-primary-foreground">Registrar Sinal</DialogTitle>
                  </DialogHeader>
                  <div>
                    <p className="font-body text-[11px] text-primary-foreground/70 mt-0.5 truncate">
                      {getClientName(pagamentoAg.user_id, pagamentoAg.cliente_nome)} · {pagamentoAg.servico}
                    </p>
                  </div>

                  <div className="flex justify-between items-end border-b border-primary-foreground/[0.06] pb-2.5">
                    <div>
                      <p className="font-body text-[9px] text-primary-foreground/60 uppercase tracking-wider mb-0.5">Total</p>
                      <p className="font-heading text-[14px] font-bold text-primary-foreground/90">R$ {valorTotal.toFixed(2).replace(".", ",")}</p>
                    </div>
                    {jaPago > 0 && (
                      <div className="text-right">
                        <p className="font-body text-[9px] text-green-400/70 uppercase tracking-wider mb-0.5">Já pago</p>
                        <p className="font-heading text-[14px] font-bold text-green-400">R$ {jaPago.toFixed(2).replace(".", ",")}</p>
                      </div>
                    )}
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <label className="font-body text-[10px] font-bold text-gold uppercase tracking-[0.05em] flex items-center gap-1.5">
                      Valor recebido agora
                    </label>
                    <div className="relative group">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-heading text-lg text-primary-foreground/50 group-focus-within:text-gold transition-colors">R$</span>
                      <input
                        type="text"
                        inputMode="numeric"
                        autoFocus
                        placeholder="0,00"
                        value={pagamentoInput}
                        onChange={(e) => setPagamentoInput(formatCurrencyMask(e.target.value))}
                        className="w-full pl-10 pr-3 py-2.5 rounded-xl bg-primary-foreground/[0.02] border border-primary-foreground/[0.08] text-primary-foreground font-heading text-xl font-bold focus:outline-none focus:border-gold focus:ring-1 focus:ring-gold/30 transition-all"
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5 pt-1">
                    <label className="font-body text-[10px] font-bold text-gold uppercase tracking-[0.05em] flex items-center gap-1.5">
                      Forma de pagamento
                    </label>
                    <div className="grid grid-cols-3 gap-1.5">
                      {[
                        { id: "pix", label: "PIX" },
                        { id: "cartao", label: "Cartão" },
                        { id: "dinheiro", label: "Dinheiro" },
                      ].map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          onClick={() => setPagamentoForma(m.id)}
                          className={`rounded-xl border py-2 font-body text-[11px] font-semibold transition-all ${
                            pagamentoForma === m.id
                              ? "border-gold/50 bg-gold/20 text-gold"
                              : "border-primary-foreground/[0.08] bg-primary-foreground/[0.03] text-primary-foreground/65 hover:text-primary-foreground"
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-1">
                    <label className="font-body text-[10px] font-bold text-primary-foreground/60 uppercase tracking-[0.05em]">
                      Identificação / Obs (opcional)
                    </label>
                    <input
                      type="text"
                      placeholder="Ex: Sinal 50%, Parcela 1..."
                      value={pagamentoObs}
                      onChange={(e) => setPagamentoObs(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-primary-foreground/[0.02] border border-primary-foreground/[0.08] text-primary-foreground font-body text-[12px] placeholder:text-primary-foreground/35 focus:outline-none focus:border-gold"
                    />
                  </div>

                  <div className="rounded-xl bg-amber-500/10 border border-amber-500/20 p-2.5 flex justify-between items-center mt-1">
                    <p className="font-body text-[10px] text-amber-200/80">Restante a pagar:</p>
                    <p className="font-heading text-[13px] font-bold text-amber-400">R$ {novoRestante.toFixed(2).replace(".", ",")}</p>
                  </div>

                  <div className="pt-2 flex gap-2">
                    <button onClick={() => { setPagamentoAg(null); setPagamentoInput(""); setPagamentoObs(""); }} className="flex-1 py-2.5 rounded-xl bg-primary-foreground/[0.04] text-primary-foreground/80 hover:bg-primary-foreground/[0.08] hover:text-primary-foreground font-heading text-[11px] font-bold uppercase tracking-wider transition-all">Cancelar</button>
                    <button onClick={confirmarRegistroPagamento} className="flex-1 py-2.5 rounded-xl bg-gold text-charcoal font-heading text-[11px] font-bold uppercase tracking-wider hover:bg-gold/90 transition-all shadow-[0_0_10px_hsl(var(--gold)/0.2)]">Confirmar</button>
                  </div>
                </div>
              );
            })()}
          </DialogContent>
        </Dialog>

        {/* Mobile top bar (hidden on desktop) */}
        <div className="sticky top-0 z-20 border-b border-primary-foreground/[0.06] bg-charcoal/90 backdrop-blur-xl lg:hidden">
          <div className="mx-auto flex w-full max-w-md items-center justify-between px-3 py-3 sm:px-4">
            <div className="flex items-center gap-2 min-w-0">
              <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
                <SheetTrigger asChild>
                  <button
                    aria-label="Abrir menu"
                    className="flex h-11 w-11 items-center justify-center rounded-2xl text-primary-foreground/60 transition-all hover:bg-gold/10 hover:text-gold"
                  >
                    <Menu className="h-5 w-5" />
                  </button>
                </SheetTrigger>
                <SheetContent
                  side="left"
                  className="w-[82vw] max-w-[18rem] overflow-y-auto border-primary-foreground/[0.06] bg-charcoal p-0 flex flex-col"
                >
                  <div className="px-5 pt-5 pb-4 border-b border-primary-foreground/[0.06]">
                    <h2 className="font-heading text-[16px] font-semibold text-primary-foreground">Admin</h2>
                    <p className="font-body text-[11px] text-primary-foreground/30">Fernanda Hahn</p>
                  </div>
                  <nav className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
                    {tabs.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => { setTab(t.id); setMobileNavOpen(false); }}
                        className={`group flex w-full items-center gap-3 rounded-xl px-3 py-3 font-body text-[14px] font-medium transition-all ${
                          tab === t.id
                            ? "tab-active bg-gold/10 text-gold"
                            : "text-primary-foreground/50 hover:bg-primary-foreground/[0.04] hover:text-primary-foreground/80"
                        }`}
                      >
                        <t.icon
                          className={`h-[18px] w-[18px] shrink-0 tab-icon ${t.anim}`}
                          style={{ color: tab === t.id ? undefined : t.color }}
                        />
                        {t.label}
                      </button>
                    ))}
                  </nav>
                  <div className="px-3 py-3 border-t border-primary-foreground/[0.06]">
                    <button
                      onClick={() => { setMobileNavOpen(false); onLogout(); }}
                      className="flex w-full items-center gap-3 rounded-xl px-3 py-3 font-body text-[14px] text-rose/70 hover:bg-rose/10 hover:text-rose transition-all"
                    >
                      <LogOut className="h-[18px] w-[18px] shrink-0" />
                      Sair
                    </button>
                  </div>
                </SheetContent>
              </Sheet>
              <div className="min-w-0">
                <h1 className="font-heading text-[15px] font-semibold text-primary-foreground truncate">
                  {tabs.find(t => t.id === tab)?.label || "Admin"}
                </h1>
                <p className="font-body text-[10px] text-primary-foreground/30 truncate">Fernanda Hahn</p>
              </div>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Sheet>
                <SheetTrigger asChild>
                  <button className="flex h-11 w-11 items-center justify-center rounded-2xl text-primary-foreground/40 transition-all hover:bg-gold/10 hover:text-gold">
                    <Bell className="h-4 w-4" />
                  </button>
                </SheetTrigger>
                <SheetContent side="right" className="w-[calc(100vw-0.75rem)] max-w-[22rem] overflow-x-hidden overflow-y-auto border-primary-foreground/[0.06] bg-charcoal p-0">
                  <LembretesHub />
                </SheetContent>
              </Sheet>
              <button onClick={onLogout} className="flex h-11 w-11 items-center justify-center rounded-2xl text-rose/60 transition-all hover:bg-rose/10 hover:text-rose">
                <LogOut className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        {/* Desktop top bar */}
        <div className="hidden lg:flex sticky top-0 z-20 border-b border-primary-foreground/[0.06] bg-charcoal/90 backdrop-blur-xl items-center justify-between px-8 py-4">
          <h2 className="font-heading text-xl font-semibold text-primary-foreground">{tabs.find(t => t.id === tab)?.label}</h2>
          <p className="font-body text-[12px] text-primary-foreground/30">{new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}</p>
        </div>

        {/* Content */}
        <div className="mx-auto w-full max-w-md overflow-x-hidden px-3 py-4 pb-24 sm:px-4 lg:max-w-4xl lg:px-8 lg:py-6 lg:pb-6">
          {tab === "dashboard" && (
            <AdminDashboard
              agendamentos={agendamentos.filter(a => !(a.servico === "Adição de Crédito" || a.servico === "Entrada Manual" || (a.servico && a.servico.startsWith("Pagamento de Dívida"))))}
              getClientName={getClientName}
              notificationsEnabled={notificationsEnabled}
              toggleNotifications={toggleNotifications}
              statusBadge={statusBadge}
              onGoToAgenda={() => setTab("agendamentos")}
              onNewBooking={() => openManualRegister()}
              onNavigateTab={(t) => setTab(t)}
            />
          )}

          {tab === "agendamentos" && (() => {
            const tomorrowAgendaKey = shiftDate(todayAgendaKey, 1);
            const yesterdayAgendaKey = shiftDate(todayAgendaKey, -1);
            const iosDateTitle =
              selectedAgendaDate === todayAgendaKey
                ? "Hoje"
                : selectedAgendaDate === tomorrowAgendaKey
                ? "Amanhã"
                : selectedAgendaDate === yesterdayAgendaKey
                ? "Ontem"
                : selectedAgendaDateObj.toLocaleDateString("pt-BR", { weekday: "long" });
            const iosDateSubtitle = selectedAgendaDateObj.toLocaleDateString("pt-BR", {
              day: "numeric",
              month: "long",
            });

            return (
            <div className="space-y-4 animate-fade-in">
              {/* Top Bar estilo iOS adaptado ao tema Fernanda Hahn */}
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex items-center p-1 rounded-2xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.08]">
                  <button
                    type="button"
                    onClick={() => setSelectedAgendaDate(selectedAgendaDate)}
                    className="px-3.5 py-1.5 rounded-xl bg-primary-foreground/[0.1] text-primary-foreground font-body text-[12px] font-semibold shadow-sm transition-all"
                  >
                    Agenda
                  </button>
                  <button
                    type="button"
                    onClick={() => openManualRegister()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl text-gold hover:bg-gold/10 font-body text-[12px] font-medium transition-all"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Agendar manual
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  {/* Calendário Popover */}
                  <Popover>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        aria-label="Selecionar data no calendário"
                        className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.08] text-primary-foreground/80 hover:text-gold hover:border-gold/30 transition-all"
                      >
                        <Calendar className="h-4 w-4" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent align="end" className="w-auto rounded-3xl border border-primary-foreground/[0.12] bg-charcoal text-primary-foreground p-0 shadow-2xl">
                      <div className="border-b border-primary-foreground/[0.08] px-4 py-3">
                        <p className="font-heading text-[15px] font-semibold text-primary-foreground">Selecionar data</p>
                        <p className="font-body text-[11px] text-primary-foreground/50">Pontos dourados indicam dias com horários</p>
                      </div>
                      <DatePickerCalendar
                        mode="single"
                        locale={ptBR}
                        selected={selectedAgendaDateObj}
                        onSelect={(date) => date && setSelectedAgendaDate(getDateKey(date))}
                        modifiers={{
                          hasAppointments: agendaDatesWithAppointments.map((dateKey) => parseDateKey(dateKey)),
                        }}
                        classNames={{
                          months: "flex flex-col sm:flex-row space-y-4 sm:space-x-4 sm:space-y-0",
                          month: "space-y-3",
                          caption: "flex justify-center pt-1 relative items-center",
                          caption_label: "text-sm font-semibold text-primary-foreground capitalize",
                          nav: "space-x-1 flex items-center",
                          nav_button:
                            "inline-flex items-center justify-center h-7 w-7 rounded-lg border border-primary-foreground/15 bg-primary-foreground/[0.05] p-0 text-primary-foreground/80 hover:bg-primary-foreground/15 hover:text-primary-foreground transition-colors",
                          nav_button_previous: "absolute left-1",
                          nav_button_next: "absolute right-1",
                          table: "w-full border-collapse space-y-1",
                          head_row: "flex",
                          head_cell: "text-primary-foreground/50 rounded-md w-9 font-medium text-[0.75rem] capitalize",
                          row: "flex w-full mt-1.5",
                          cell: "h-9 w-9 text-center text-sm p-0 relative focus-within:relative focus-within:z-20",
                          day: "inline-flex items-center justify-center h-9 w-9 p-0 font-normal rounded-full text-primary-foreground hover:bg-primary-foreground/10 hover:text-primary-foreground transition-colors aria-selected:opacity-100",
                          day_selected:
                            "!bg-gold !text-charcoal font-bold hover:!bg-gold hover:!text-charcoal focus:!bg-gold focus:!text-charcoal rounded-full shadow-sm",
                          day_today: "border border-gold/50 text-gold font-semibold",
                          day_outside: "day-outside text-primary-foreground/25 opacity-60",
                          day_disabled: "text-primary-foreground/20 opacity-40",
                          day_hidden: "invisible",
                        }}
                        modifiersClassNames={{
                          hasAppointments: "relative after:absolute after:bottom-1 after:left-1/2 after:h-1 after:w-1 after:-translate-x-1/2 after:rounded-full after:bg-gold",
                        }}
                        initialFocus
                      />
                    </PopoverContent>
                  </Popover>

                  {/* Sino de notificações */}
                  <Sheet>
                    <SheetTrigger asChild>
                      <button
                        type="button"
                        aria-label="Notificações da agenda"
                        className="relative flex h-9 w-9 items-center justify-center rounded-xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.08] transition-all hover:border-primary-foreground/20"
                      >
                        <Bell className={`h-4 w-4 ${activeAgendaNotifs.length > 0 ? "text-rose" : "text-primary-foreground/45"}`} />
                        {activeAgendaNotifs.length > 0 && (
                          <span className="absolute -top-1.5 -right-1.5 flex h-5 min-w-5 px-1 items-center justify-center rounded-full bg-rose text-[10px] font-bold text-white shadow-sm">
                            {activeAgendaNotifs.length}
                          </span>
                        )}
                      </button>
                    </SheetTrigger>
                    <SheetContent side="right" className="w-[340px] sm:w-[400px] bg-charcoal border-primary-foreground/[0.08] p-0">
                      <SheetHeader className="px-5 pt-5 pb-4 border-b border-primary-foreground/[0.08]">
                        <SheetTitle className="font-heading text-[16px] font-semibold text-primary-foreground flex items-center gap-2">
                          <Bell className="w-4 h-4 text-gold" />
                          Notificações da Agenda
                          {activeAgendaNotifs.length > 0 && (
                            <span className="ml-auto px-2 py-0.5 rounded-full bg-rose/15 text-rose text-[10px] font-body font-medium border border-rose/25">
                              {activeAgendaNotifs.length}
                            </span>
                          )}
                        </SheetTitle>
                      </SheetHeader>

                      {activeAgendaNotifs.length > 0 && (
                        <div className="px-4 pt-3 flex justify-end">
                          <button onClick={clearAgendaNotifs}
                            className="flex items-center gap-1 rounded-lg px-2.5 py-1.5 font-body text-[10px] font-medium text-primary-foreground/40 transition-all hover:bg-primary-foreground/[0.06] hover:text-primary-foreground/70">
                            <X className="h-3 w-3" /> Limpar tudo
                          </button>
                        </div>
                      )}

                      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-2 max-h-[calc(100vh-160px)]">
                        {activeAgendaNotifs.length === 0 ? (
                          <div className="py-16 text-center">
                            <CheckCircle className="h-8 w-8 text-emerald-400/40 mx-auto mb-3" />
                            <p className="font-body text-[13px] text-primary-foreground/50">Tudo em dia!</p>
                            <p className="font-body text-[11px] text-primary-foreground/25 mt-1">Nenhuma notificação pendente</p>
                          </div>
                        ) : (
                          activeAgendaNotifs.map((n, i) => {
                            const cfg = agendaNotifConfig[n.tipo];
                            const icons: Record<string, typeof Bell> = { hoje: Clock, proximo: Clock, pendente: DollarSign, falta: UserX };
                            const Icon = icons[n.tipo] || Bell;
                            return (
                              <div key={n.ag.id + n.tipo + i} className={`rounded-2xl border p-3 transition-all ${cfg.bg}`}>
                                <div className="flex items-start gap-2.5">
                                  <div className={`mt-0.5 shrink-0 ${cfg.iconColor}`}>
                                    <Icon className="h-4 w-4" />
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className={`font-body text-[11px] font-semibold ${cfg.titleColor}`}>{n.label}</p>
                                    <p className="font-body text-[13px] font-medium text-primary-foreground truncate mt-0.5">
                                      {getClientName(n.ag.user_id, (n.ag as any).cliente_nome)}
                                    </p>
                                    <p className="font-body text-[11px] text-primary-foreground/50 truncate">
                                      {n.ag.servico}{n.ag.variacao ? ` · ${n.ag.variacao}` : ""}
                                    </p>
                                    <div className="flex items-center gap-2 mt-1">
                                      <span className="font-heading text-[13px] font-bold text-primary-foreground">
                                        R$ {Number(n.ag.valor).toFixed(2).replace(".", ",")}
                                      </span>
                                      <span className="font-body text-[10px] text-primary-foreground/40">
                                        {new Date(n.ag.data_agendamento + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "short" })} · {n.ag.horario}
                                      </span>
                                    </div>
                                    <div className="flex items-center gap-1.5 mt-2">
                                      <button
                                        onClick={() => dismissAgendaNotif(n.ag.id, n.tipo)}
                                        className="flex items-center gap-1 rounded-lg px-2 py-1 bg-primary-foreground/[0.06] text-primary-foreground/55 text-[10px] font-body font-medium border border-primary-foreground/[0.08] hover:bg-primary-foreground/[0.1] hover:text-primary-foreground/80 transition-all"
                                      >
                                        <CheckCircle className="h-3 w-3" /> Lida
                                      </button>
                                      <BinButton size="sm" onClick={() => deleteAgendamento(n.ag.id)} />
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

              {/* Navegador de data centralizado estilo iOS */}
              <div className="flex items-center justify-between px-2 py-1">
                <button
                  type="button"
                  onClick={() => setSelectedAgendaDate(shiftDate(selectedAgendaDate, -1))}
                  aria-label="Dia anterior"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-primary-foreground/[0.08] bg-primary-foreground/[0.03] text-primary-foreground/75 hover:border-gold/30 hover:text-gold transition-all"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <div className="text-center">
                  <h3 className="font-heading text-[22px] font-semibold capitalize text-primary-foreground leading-tight">
                    {iosDateTitle}
                  </h3>
                  <div className="mt-0.5 flex items-center justify-center gap-1.5">
                    <span className="font-body text-[12px] text-primary-foreground/55">{iosDateSubtitle}</span>
                    <span className="inline-flex h-4 min-w-4 px-1.5 items-center justify-center rounded-full bg-gold/15 border border-gold/30 font-body text-[10px] font-bold text-gold tabular-nums">
                      {selectedAgendaItems.length}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setSelectedAgendaDate(shiftDate(selectedAgendaDate, 1))}
                  aria-label="Próximo dia"
                  className="flex h-9 w-9 items-center justify-center rounded-full border border-primary-foreground/[0.08] bg-primary-foreground/[0.03] text-primary-foreground/75 hover:border-gold/30 hover:text-gold transition-all"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* 2 pílulas rápidas estilo iOS (Novo Atendimento + Resumo do dia) */}
              <div className="grid grid-cols-2 gap-2.5">
                <button
                  type="button"
                  onClick={() => openManualRegister()}
                  className="flex items-center justify-center gap-2 rounded-2xl border border-gold/35 bg-gold/10 hover:bg-gold/20 py-2.5 px-3 font-body text-[12.5px] font-semibold text-gold transition-all"
                >
                  <Plus className="h-4 w-4" /> Novo / Encaixe
                </button>

                <div className="flex items-center justify-center gap-2 rounded-2xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.03] py-2.5 px-3 font-body text-[12px] font-semibold tabular-nums">
                  <span className="text-emerald-400">Rec. R$ {selectedAgendaPago.toFixed(0)}</span>
                  <span className="text-primary-foreground/25">/</span>
                  <span className="text-primary-foreground/65">Prev. R$ {selectedAgendaTotal.toFixed(0)}</span>
                </div>
              </div>

              {/* Container Timeline 24h estilo iOS no tema do estúdio */}
              <section className="overflow-hidden rounded-3xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.025] p-3 sm:p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-1 max-w-2xl mx-auto">
                  <span className="font-body text-[10px] uppercase tracking-[0.18em] text-primary-foreground/45 font-semibold">
                    Agenda 24h · Todos os horários liberados
                  </span>
                  <div className="flex flex-wrap items-center gap-1">
                    {[
                      { label: "00h Madrugada", slot: "00:00" },
                      { label: "07h Manhã", slot: "07:00" },
                      { label: "13h Tarde", slot: "13:00" },
                      { label: "19h Noite", slot: "19:00" },
                    ].map((p) => (
                      <button
                        key={p.slot}
                        type="button"
                        onClick={() => {
                          document.getElementById(`agenda-slot-${p.slot}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
                        }}
                        className="px-2 py-1 rounded-lg border border-primary-foreground/[0.08] bg-primary-foreground/[0.03] hover:border-gold/30 hover:text-gold font-body text-[10px] font-medium text-primary-foreground/60 transition-colors"
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                {(() => {
                  const START_HOUR = 0;
                  const END_HOUR = 24;
                  const INTERVAL_MINS = 30;

                  const timeSlots: number[] = [];
                  for (let i = START_HOUR * 60; i < END_HOUR * 60; i += INTERVAL_MINS) {
                    timeSlots.push(i);
                  }

                  const sortedItems = [...selectedAgendaItems].sort((a, b) => timeToMinutes(a.horario) - timeToMinutes(b.horario));

                  return (
                    <div className="space-y-1.5 max-w-2xl mx-auto">
                      {timeSlots.map((slotMins) => {
                        const timeString = minutesToTime(slotMins);

                        const startingAppts = sortedItems.filter((a) => {
                          const start = timeToMinutes(a.horario);
                          return start >= slotMins && start < slotMins + INTERVAL_MINS;
                        });

                        const isCovered = sortedItems.some((a) => {
                          const start = timeToMinutes(a.horario);
                          const end = start + (a.duracao_minutos || 60);
                          return start < slotMins && end > slotMins;
                        });

                        if (startingAppts.length === 0 && !isCovered) {
                          return (
                            <div key={`empty-${slotMins}`} id={`agenda-slot-${timeString}`} className="flex items-stretch min-h-[46px] scroll-mt-20">
                              <div className="w-14 shrink-0 flex items-center justify-end pr-3 border-r border-primary-foreground/[0.08] mr-3">
                                <span className="font-body text-[11px] font-medium text-primary-foreground/40 tabular-nums">
                                  {timeString}
                                </span>
                              </div>
                              <div className="flex-1 flex">
                                <button
                                  type="button"
                                  onClick={() => openManualRegister(timeString)}
                                  className="w-full min-h-[44px] rounded-2xl border border-dashed border-primary-foreground/[0.09] bg-primary-foreground/[0.015] hover:bg-primary-foreground/[0.045] hover:border-gold/35 flex items-center justify-center gap-1.5 text-primary-foreground/35 hover:text-gold transition-all"
                                >
                                  <Plus className="w-3.5 h-3.5" />
                                  <span className="font-body text-[12px] font-medium">Agendar</span>
                                </button>
                              </div>
                            </div>
                          );
                        }

                        if (startingAppts.length === 0 && isCovered) {
                          return (
                            <div key={`covered-${slotMins}`} id={`agenda-slot-${timeString}`} className="flex items-stretch min-h-[42px] scroll-mt-20">
                              <div className="w-14 shrink-0 flex items-center justify-end pr-3 border-r border-primary-foreground/[0.08] mr-3">
                                <span className="font-body text-[11px] font-medium text-primary-foreground/35 tabular-nums">
                                  {timeString}
                                </span>
                              </div>
                              <div className="flex-1 flex">
                                <div className="w-full min-h-[40px] rounded-2xl bg-primary-foreground/[0.03] border border-primary-foreground/[0.06] flex items-center justify-center">
                                  <span className="font-body text-[11px] font-medium text-primary-foreground/25">Ocupado</span>
                                </div>
                              </div>
                            </div>
                          );
                        }

                        return (
                          <div key={`slot-${slotMins}`} id={`agenda-slot-${timeString}`} className="flex items-stretch scroll-mt-20">
                            <div className="w-14 shrink-0 flex items-start justify-end pr-3 pt-3 border-r border-primary-foreground/[0.08] mr-3">
                              <span className="font-body text-[11px] font-semibold text-primary-foreground/70 tabular-nums">
                                {timeString}
                              </span>
                            </div>
                            <div className="flex-1 min-w-0 space-y-2">
                              {startingAppts.map((a, idx) => {
                                const duracao = a.duracao_minutos || 60;
                                const endTimeString = calcFim(a.horario, duracao);
                                const isCancelado = a.status === "cancelado" || a.status === "falta";
                                const barColor =
                                  a.status === "confirmado"
                                    ? "bg-gold"
                                    : a.status === "concluido"
                                    ? "bg-emerald-400"
                                    : a.status === "cancelado"
                                    ? "bg-rose"
                                    : "bg-amber-400";
                                const clienteWpp = clientes.find((c) => c.id === a.user_id)?.whatsapp || null;

                                return (
                                  <SwipeableTimelineCard
                                    key={a.id}
                                    a={a}
                                    idx={idx}
                                    isCancelado={isCancelado}
                                    barColor={barColor}
                                    duracao={duracao}
                                    endTimeString={endTimeString}
                                    clientName={getClientName(a.user_id, a.cliente_nome)}
                                    clientWhatsapp={clienteWpp}
                                    onClick={(appt: any) => setDetalheAgendamento(appt)}
                                    onEdit={(appt: any) => openEditAgendamento(appt)}
                                    onDelete={deleteAgendamento}
                                  />
                                );
                              })}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })()}
              </section>

              {/* Modal de detalhes + ações completas ao clicar no card */}
              <Dialog open={!!detalheAgendamento} onOpenChange={(o) => !o && setDetalheAgendamento(null)}>
                <DialogContent
                  aria-describedby={undefined}
                  className="w-[calc(100vw-1.25rem)] max-w-[calc(100vw-1.25rem)] sm:max-w-md max-h-[calc(100dvh-1.5rem)] overflow-y-auto overflow-x-hidden rounded-3xl border border-primary-foreground/[0.1] bg-charcoal p-4 sm:p-5 shadow-2xl"
                >
                  <DialogHeader>
                    <DialogTitle className="font-heading text-[18px] font-semibold text-primary-foreground">
                      Detalhes do Agendamento
                    </DialogTitle>
                  </DialogHeader>
                  {detalheAgendamento && (() => {
                    const a = detalheAgendamento;
                    const cliente = clientes.find((c) => c.id === a.user_id);
                    const valorPago = Number(a.valor_pago || 0);
                    const valorTotal = Number(a.valor);
                    const valorDescontoCredito = Number(a.valor_desconto_credito || 0);
                    const restante = Math.max(0, valorTotal - valorPago - valorDescontoCredito);
                    return (
                      <div className="space-y-3.5">
                        {/* 3 Ações Principais em destaque: Concluir | Editar | Excluir */}
                        <div className="grid grid-cols-3 gap-2">
                          <button
                            type="button"
                            onClick={() => updateStatus(a.id, "concluido")}
                            className={`flex flex-col items-center justify-center gap-1 rounded-2xl border py-2.5 px-2 font-body text-[11px] font-semibold transition-all ${
                              a.status === "concluido"
                                ? "border-emerald-500/50 bg-emerald-500/20 text-emerald-400"
                                : "border-emerald-500/30 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                            }`}
                          >
                            <CheckCircle className="h-4 w-4" />
                            {a.status === "concluido" ? "Concluído" : "Concluir"}
                          </button>

                          <button
                            type="button"
                            onClick={() => openEditAgendamento(a)}
                            className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-sky-500/35 bg-sky-500/15 py-2.5 px-2 font-body text-[11px] font-semibold text-sky-400 hover:bg-sky-500/25 transition-all"
                          >
                            <Edit2 className="h-4 w-4" />
                            Editar
                          </button>

                          <button
                            type="button"
                            onClick={() => {
                              confirm({
                                title: "Excluir Agendamento?",
                                description: `Tem certeza que deseja excluir o agendamento de ${getClientName(a.user_id, a.cliente_nome)}?`,
                                confirmText: "Sim, Excluir",
                                cancelText: "Cancelar",
                                variant: "destructive",
                                onConfirm: () => {
                                  deleteAgendamento(a.id);
                                },
                              });
                            }}
                            className="flex flex-col items-center justify-center gap-1 rounded-2xl border border-rose/35 bg-rose/15 py-2.5 px-2 font-body text-[11px] font-semibold text-rose hover:bg-rose/25 transition-all"
                          >
                            <Trash2 className="h-4 w-4" />
                            Excluir
                          </button>
                        </div>

                        {/* Status secundários rápidos */}
                        <div className="flex flex-wrap gap-1.5">
                          {a.status !== "confirmado" && (
                            <button
                              type="button"
                              onClick={() => updateStatus(a.id, "confirmado")}
                              className="flex-1 py-1.5 px-2.5 rounded-xl border border-gold/25 bg-gold/10 text-gold font-body text-[11px] font-medium hover:bg-gold/20 transition-all"
                            >
                              Marcar Confirmado
                            </button>
                          )}
                          {a.status !== "falta" && (
                            <button
                              type="button"
                              onClick={() => updateStatus(a.id, "falta")}
                              className="flex-1 py-1.5 px-2.5 rounded-xl border border-amber-500/25 bg-amber-500/10 text-amber-300 font-body text-[11px] font-medium hover:bg-amber-500/20 transition-all"
                            >
                              Faltou
                            </button>
                          )}
                          {a.status !== "cancelado" && (
                            <button
                              type="button"
                              onClick={() => updateStatus(a.id, "cancelado")}
                              className="flex-1 py-1.5 px-2.5 rounded-xl border border-rose/25 bg-rose/10 text-rose font-body text-[11px] font-medium hover:bg-rose/20 transition-all"
                            >
                              Cancelar
                            </button>
                          )}
                        </div>

                        {/* Cliente */}
                        <div className="rounded-2xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.03] p-3.5">
                          <p className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/45 mb-1">Cliente</p>
                          <div className="flex items-center justify-between gap-2">
                            <p className="font-heading text-[16px] font-semibold text-primary-foreground">{getClientName(a.user_id, a.cliente_nome)}</p>
                            {cliente?.whatsapp && (
                              <a
                                href={`https://wa.me/${normalizeWhatsappNumber(cliente.whatsapp)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="inline-flex items-center gap-1.5 rounded-xl bg-[#25d366]/15 border border-[#25d366]/30 px-2.5 py-1 font-body text-[11px] font-medium text-[#25d366] hover:bg-[#25d366]/25 transition-colors"
                              >
                                <WhatsAppIcon className="h-3.5 w-3.5" />
                                {formatWhatsapp(cliente.whatsapp)}
                              </a>
                            )}
                          </div>
                        </div>

                        {/* Serviço + data/hora */}
                        <div className="grid grid-cols-2 gap-2">
                          <div className="col-span-2 rounded-2xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.03] p-3">
                            <p className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/45 mb-1">Serviço</p>
                            <p className="font-body text-[14px] font-medium text-primary-foreground">{a.servico}{a.variacao ? ` · ${a.variacao}` : ""}</p>
                            <p className="font-body text-[11px] text-primary-foreground/50 mt-0.5">Duração: {a.duracao_minutos || 60} min{(a as any).foi_estendido ? " (estendido)" : ""}</p>
                          </div>
                          <div className="rounded-2xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.03] p-3">
                            <p className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/45 mb-1">Data</p>
                            <p className="font-body text-[13px] font-medium text-primary-foreground">{formatDate(a.data_agendamento)}</p>
                          </div>
                          <div className="rounded-2xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.03] p-3">
                            <p className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/45 mb-1">Horário</p>
                            <p className="font-body text-[13px] font-medium text-primary-foreground">{a.horario} – {calcFim(a.horario, a.duracao_minutos || 60)}</p>
                          </div>
                        </div>

                        {/* Observações */}
                        {a.observacao && (
                          <div className="rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
                            <p className="font-body text-[10px] uppercase tracking-wider text-amber-400/80 mb-1">Observações do cliente</p>
                            <p className="font-body text-[13px] text-amber-100/95 leading-relaxed whitespace-pre-wrap break-words">{a.observacao}</p>
                          </div>
                        )}

                        {/* Pagamento + botão receber sinal/restante */}
                        <div className="rounded-2xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.03] p-3.5 space-y-2">
                          <div className="flex items-center justify-between">
                            <p className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/50">Pagamento</p>
                            {pagamentoBadge(a)}
                          </div>
                          <div className="flex items-center justify-between">
                            <p className="font-body text-[12px] text-primary-foreground/60">Valor total</p>
                            <p className="font-heading text-[15px] font-semibold text-primary-foreground">R$ {valorTotal.toFixed(2).replace(".", ",")}</p>
                          </div>
                          <div className="flex items-center justify-between">
                            <p className="font-body text-[12px] text-primary-foreground/60">Já recebido</p>
                            <p className="font-body text-[13px] font-medium text-emerald-400">R$ {valorPago.toFixed(2).replace(".", ",")}</p>
                          </div>
                          {restante > 0 && (
                            <div className="flex items-center justify-between border-t border-primary-foreground/[0.06] pt-1.5">
                              <p className="font-body text-[12px] text-primary-foreground/60">A receber</p>
                              <p className="font-body text-[13px] font-semibold text-rose">R$ {restante.toFixed(2).replace(".", ",")}</p>
                            </div>
                          )}
                          {(a.valor_gorjeta || a.valor_troco || a.valor_credito || (a as any).valor_desconto_credito) ? (
                            <div className="border-t border-primary-foreground/[0.06] pt-1.5 mt-1.5 space-y-1.5">
                              {Number((a as any).valor_desconto_credito) > 0 && (
                                <div className="flex items-center justify-between rounded-lg bg-sky-500/10 border border-sky-400/20 px-2 py-1.5">
                                  <p className="font-body text-[12px] text-sky-300 font-medium">Desconto crédito</p>
                                  <p className="font-body text-[12px] font-bold text-sky-300">- R$ {Number((a as any).valor_desconto_credito).toFixed(2).replace(".", ",")}</p>
                                </div>
                              )}
                              {Number(a.valor_gorjeta) > 0 && (
                                <div className="flex items-center justify-between">
                                  <p className="font-body text-[12px] text-primary-foreground/60">Gorjeta (extra)</p>
                                  <p className="font-body text-[12px] font-medium text-purple-300">R$ {Number(a.valor_gorjeta).toFixed(2).replace(".", ",")}</p>
                                </div>
                              )}
                              {Number(a.valor_troco) > 0 && (
                                <div className="flex items-center justify-between">
                                  <p className="font-body text-[12px] text-primary-foreground/60">Troco pago</p>
                                  <p className="font-body text-[12px] font-medium text-sky-400">R$ {Number(a.valor_troco).toFixed(2).replace(".", ",")}</p>
                                </div>
                              )}
                              {Number(a.valor_credito) > 0 && (
                                <div className="flex items-center justify-between">
                                  <p className="font-body text-[12px] text-primary-foreground/60">Crédito concedido</p>
                                  <p className="font-body text-[12px] font-medium text-emerald-400">R$ {Number(a.valor_credito).toFixed(2).replace(".", ",")}</p>
                                </div>
                              )}
                            </div>
                          ) : null}
                          <div className="flex items-center justify-between border-t border-primary-foreground/[0.06] pt-1.5">
                            <p className="font-body text-[12px] text-primary-foreground/60">Forma</p>
                            <p className="font-body text-[12px] font-medium text-primary-foreground">{formatFormaPagamento(a.forma_pagamento)}</p>
                          </div>

                          {restante > 0 && a.status !== "cancelado" && a.status !== "falta" && (
                            <button
                              type="button"
                              onClick={() => {
                                setDetalheAgendamento(null);
                                abrirRegistroPagamento(a);
                              }}
                              className="w-full mt-2 flex items-center justify-center gap-1.5 rounded-xl bg-gold text-charcoal py-2 px-3 font-body text-[12px] font-bold hover:brightness-105 transition-all"
                            >
                              <DollarSign className="h-3.5 w-3.5" /> Registrar Sinal / Pagamento
                            </button>
                          )}
                        </div>

                        {/* Status + origem + metadados */}
                        <div className="flex flex-wrap items-center justify-between gap-2 px-1">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {statusBadge(a.status)}
                            {a.origem === "admin_manual" && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 font-body text-[10px] font-semibold uppercase text-gold">Presencial</span>
                            )}
                            {a.origem === "app" && (
                              <span className="inline-flex items-center gap-1 rounded-full border border-sky-400/30 bg-sky-400/10 px-2 py-0.5 font-body text-[10px] font-semibold uppercase text-sky-400">App</span>
                            )}
                          </div>
                          <p className="font-body text-[10px] text-primary-foreground/35">
                            {new Date(a.created_at).toLocaleDateString("pt-BR")} · #{a.id.slice(0, 6)}
                          </p>
                        </div>

                        {a.status !== "cancelado" && a.status !== "falta" && (
                          <button
                            type="button"
                            onClick={() => handleEnviarConfirmacaoWpp(a)}
                            disabled={sendingConfirmacaoId === a.id}
                            className="w-full flex items-center justify-center gap-2 rounded-2xl border border-[#25d366]/30 bg-[#25d366]/10 px-4 py-2.5 font-body text-[12px] font-medium text-[#25d366] hover:bg-[#25d366]/20 transition-all disabled:opacity-50"
                          >
                            {sendingConfirmacaoId === a.id ? (
                              <>
                                <Loader2 className="h-3.5 w-3.5 animate-spin" /> Enviando confirmação...
                              </>
                            ) : (
                              <>
                                <WhatsAppIcon className="h-3.5 w-3.5" /> Enviar confirmação via WhatsApp
                              </>
                            )}
                          </button>
                        )}

                        {cliente && (
                          <button
                            onClick={() => { setDetalheAgendamento(null); setTab("clientes"); setSelectedClient(cliente.id); }}
                            className="w-full flex items-center justify-center gap-2 rounded-2xl border border-primary-foreground/[0.1] bg-primary-foreground/[0.04] px-4 py-2.5 font-body text-[12px] font-medium text-primary-foreground/80 hover:bg-primary-foreground/[0.08] transition-all"
                          >
                            <Users className="h-3.5 w-3.5 text-gold" /> Ver perfil completo do cliente
                          </button>
                        )}
                      </div>
                    );
                  })()}
                </DialogContent>
              </Dialog>
            </div>
            );
          })()}

              {/* Edit Agendamento Dialog */}
              <Dialog open={showEditAgendamento} onOpenChange={setShowEditAgendamento}>
                <DialogContent className="w-[calc(100vw-1rem)] max-w-md max-h-[88dvh] overflow-y-auto bg-charcoal/95 backdrop-blur-xl border border-gold/25 rounded-[1.75rem] p-6 shadow-2xl">
                  <DialogHeader>
                    <DialogTitle className="font-heading text-[18px] font-semibold text-primary-foreground flex items-center gap-2">
                      <Edit2 className="w-5 h-5 text-gold" />
                      Editar Agendamento
                    </DialogTitle>
                  </DialogHeader>
                  <div className="space-y-4 mt-4">
                    <div className="space-y-1.5 relative z-20">
                      <label className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/50">Buscar Serviço p/ Adicionar</label>
                      <div className="relative group">
                        <div className="absolute left-3 top-1/2 -translate-y-1/2">
                          <Search className="h-4 w-4 text-primary-foreground/50" />
                        </div>
                        <input
                          type="text"
                          placeholder="Pesquisar e adicionar serviço..."
                          value={editAgServicoSearch}
                          onFocus={() => setEditAgServicoOpen(true)}
                          onChange={(e) => { setEditAgServicoSearch(e.target.value); setEditAgServicoOpen(true); }}
                          className="w-full pl-9 px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-primary-foreground font-body text-[13px] focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/40"
                        />
                      </div>
                      
                      {editAgServicoOpen && (
                        <div className="absolute z-50 mt-1 left-0 right-0 rounded-2xl border border-gold/20 bg-charcoal/95 backdrop-blur-xl shadow-2xl overflow-hidden">
                          <div className="max-h-52 overflow-y-auto">
                            {manualServicos
                              .filter(s => s.nome.toLowerCase().includes(editAgServicoSearch.toLowerCase()))
                              .length === 0 ? (
                              <p className="px-4 py-3 font-body text-[12px] text-primary-foreground/30 text-center">Nenhum serviço encontrado</p>
                            ) : (
                              manualServicos
                                .filter(s => s.nome.toLowerCase().includes(editAgServicoSearch.toLowerCase()))
                                .map(s => (
                                  <button
                                    key={s.id}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      setEditAgServico(prev => {
                                        if (!prev || prev === "A definir") return s.nome;
                                        return prev + " + " + s.nome;
                                      });
                                      setEditAgValor(prev => Number(prev) + s.preco);
                                      setEditAgDuracao(prev => prev + s.duracao_minutos);
                                      setEditAgServicoSearch("");
                                      setEditAgServicoOpen(false);
                                    }}
                                    className="w-full text-left px-4 py-3 font-body text-[13px] transition-all hover:bg-gold/10 text-primary-foreground flex items-center justify-between gap-3"
                                  >
                                    <span className="font-medium truncate">{s.nome}</span>
                                    <span className="text-[11px] text-gold/70 tabular-nums flex-shrink-0">R$ {s.preco.toFixed(2).replace(".", ",")}</span>
                                  </button>
                                ))
                            )}
                          </div>
                        </div>
                      )}
                      {editAgServicoOpen && (
                        <div className="fixed inset-0 z-40" onClick={() => setEditAgServicoOpen(false)} />
                      )}
                    </div>

                    <div className="space-y-1.5 relative z-10">
                      <label className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/50">Serviço(s) Atual(is) / Editável</label>
                      <input
                        type="text"
                        value={editAgServico}
                        onChange={(e) => setEditAgServico(e.target.value)}
                        className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-primary-foreground font-body text-[13px] focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/40"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/50">Data</label>
                        <input
                          type="date"
                          value={editAgData}
                          onChange={(e) => setEditAgData(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-primary-foreground font-body text-[13px] focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/40"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/50">Horário</label>
                        <input
                          type="time"
                          value={editAgHorario}
                          onChange={(e) => setEditAgHorario(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-primary-foreground font-body text-[13px] focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/40"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/50">Valor Total (R$)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editAgValor}
                          onChange={(e) => setEditAgValor(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-primary-foreground font-body text-[13px] focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/40"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/50">Valor Pago (R$)</label>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          value={editAgValorPago}
                          onChange={(e) => setEditAgValorPago(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-primary-foreground font-body text-[13px] focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/40"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1.5">
                        <label className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/50">Duração (min)</label>
                        <input
                          type="number"
                          step="5"
                          min="5"
                          value={editAgDuracao}
                          onChange={(e) => setEditAgDuracao(Number(e.target.value))}
                          className="w-full px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/[0.08] text-primary-foreground font-body text-[13px] focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/40"
                        />
                      </div>
                      <div className="space-y-1.5">
                        <label className="font-body text-[10px] uppercase tracking-wider text-primary-foreground/50">Forma de Pagamento</label>
                        <select
                          value={editAgFormaPagamento}
                          onChange={(e) => setEditAgFormaPagamento(e.target.value)}
                          className="w-full px-3 py-2.5 rounded-xl bg-[#1a1a1a] border border-white/[0.08] text-primary-foreground font-body text-[13px] focus:outline-none focus:border-gold/60 focus:ring-1 focus:ring-gold/40"
                        >
                          <option value="">Nenhuma (Pendente)</option>
                          <option value="PIX">PIX</option>
                          <option value="Cartão de Crédito">Cartão de Crédito</option>
                          <option value="Cartão de Débito">Cartão de Débito</option>
                          <option value="Dinheiro">Dinheiro</option>
                          <option value="Permuta">Permuta</option>
                          <option value="Cortesia">Cortesia</option>
                        </select>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-6">
                    <button
                      onClick={() => setShowEditAgendamento(false)}
                      className="flex-1 px-4 py-2.5 rounded-xl border border-primary-foreground/10 bg-primary-foreground/[0.05] text-primary-foreground/60 font-body text-[13px] hover:bg-primary-foreground/10 transition-all"
                    >
                      Cancelar
                    </button>
                    <button
                      onClick={handleSaveEditAgendamento}
                      disabled={editAgSaving}
                      className="flex-1 px-4 py-2.5 rounded-xl bg-gold text-charcoal font-body font-semibold text-[13px] hover:bg-gold/90 transition-all disabled:opacity-50"
                    >
                      {editAgSaving ? "Salvando..." : "Salvar Alterações"}
                    </button>
                  </div>
                </DialogContent>
              </Dialog>

              {/* Manual Registration Dialog — visual destacado e scrollbar personalizada */}
              <Dialog open={showManualRegister} onOpenChange={setShowManualRegister}>
                <DialogContent
                  aria-describedby={undefined}
                  onOpenAutoFocus={(e) => e.preventDefault()}
                  className="w-[calc(100vw-1.5rem)] max-w-[360px] sm:max-w-[440px] max-h-[82dvh] flex flex-col overflow-hidden bg-charcoal border border-gold/25 rounded-2xl p-0 shadow-[0_24px_70px_-15px_rgba(0,0,0,0.85)]"
                >
                  {/* Barra de destaque dourada no topo */}
                  <div className="h-[2px] w-full shrink-0 bg-gradient-to-r from-transparent via-gold/70 to-transparent" />

                  {/* Header fixo compacto */}
                  <div className="shrink-0 px-4 py-2.5 border-b border-primary-foreground/[0.08] bg-gradient-to-b from-gold/[0.06] to-transparent">
                    <DialogHeader>
                      <DialogTitle className="font-heading text-[16px] font-semibold text-primary-foreground flex items-center gap-2 pr-7">
                        <span className="w-7 h-7 rounded-lg bg-gold/15 border border-gold/40 flex items-center justify-center shrink-0">
                          <Plus className="w-3.5 h-3.5 text-gold" />
                        </span>
                        <span className="truncate">Novo Agendamento</span>
                      </DialogTitle>
                    </DialogHeader>
                  </div>

                  {/* Body rolável com scrollbar customizada */}
                  <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden custom-scrollbar px-3.5 sm:px-4 py-2.5 space-y-2 w-full min-w-0">
                    {/* 1. CLIENTE */}
                    <div className="relative rounded-xl border border-primary-foreground/[0.09] bg-primary-foreground/[0.03] p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-gold/20 border border-gold/40 text-gold font-body text-[10px] font-bold flex items-center justify-center">
                            1
                          </span>
                          <span className="font-body text-[12px] font-semibold text-primary-foreground">
                            Cliente
                          </span>
                          {manualCliente && (
                            <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/15 border border-emerald-500/30 font-body text-[9.5px] text-emerald-400 font-semibold">
                              ✓ Cadastrada
                            </span>
                          )}
                        </div>

                        {/* Alternar entre buscar cliente existente e cadastrar nova cliente */}
                        <div className="inline-flex items-center p-0.5 rounded-lg bg-[#201f1d] border border-primary-foreground/[0.1]">
                          <button
                            type="button"
                            onClick={() => {
                              setManualClientTab("buscar");
                              setManualClienteOpen(false);
                            }}
                            className={`px-2 py-0.5 rounded-md font-body text-[10.5px] font-medium transition-all ${
                              manualClientTab === "buscar"
                                ? "bg-primary-foreground/[0.12] text-primary-foreground font-semibold"
                                : "text-primary-foreground/55 hover:text-primary-foreground"
                            }`}
                          >
                            Já cadastrada
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setManualClientTab("cadastrar");
                              setManualCliente("");
                              setManualClienteOpen(false);
                            }}
                            className={`px-2 py-0.5 rounded-md font-body text-[10.5px] font-medium transition-all flex items-center gap-1 ${
                              manualClientTab === "cadastrar"
                                ? "bg-gold/20 text-gold border border-gold/30 font-semibold"
                                : "text-gold/80 hover:text-gold"
                            }`}
                          >
                            <Plus className="w-2.5 h-2.5" />
                            Nova cliente
                          </button>
                        </div>
                      </div>

                      {manualClientTab === "buscar" ? (
                        <div className="relative">
                          <Search className="h-3.5 w-3.5 text-gold/70 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                          <input
                            type="text"
                            placeholder="Buscar cliente por nome ou WhatsApp..."
                            value={manualClienteNome}
                            onFocus={() => setManualClienteOpen(true)}
                            onChange={(e) => {
                              setManualCliente("");
                              setManualClienteNome(e.target.value);
                              setManualClienteOpen(true);
                            }}
                            className={`w-full pl-8 pr-8 py-1.5 rounded-lg border font-body text-[12px] focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 transition-all placeholder:text-primary-foreground/40 ${
                              manualCliente
                                ? "bg-gold/15 border-gold/50 text-gold font-semibold"
                                : "bg-[#262523] border-primary-foreground/[0.14] text-primary-foreground"
                            }`}
                          />
                          {(manualCliente || manualClienteNome) && (
                            <button
                              type="button"
                              aria-label="Limpar cliente"
                              onClick={() => {
                                setManualCliente("");
                                setManualClienteNome("");
                                setManualClienteTelefone("");
                                setManualClienteOpen(false);
                              }}
                              className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-lg text-primary-foreground/50 hover:text-primary-foreground hover:bg-primary-foreground/10 flex items-center justify-center"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}

                          {manualClienteOpen && !manualCliente && (
                            <div className="absolute z-50 mt-1 left-0 right-0 rounded-2xl border border-gold/25 bg-charcoal shadow-2xl overflow-hidden">
                              <div className="max-h-48 overflow-y-auto divide-y divide-primary-foreground/[0.06]">
                                {(() => {
                                  const q = manualClienteNome.trim().toLowerCase();
                                  const matches = clientes.filter(
                                    (c) =>
                                      !q ||
                                      c.nome.toLowerCase().includes(q) ||
                                      (c.whatsapp || "").includes(q)
                                  ).slice(0, 6);
                                  return (
                                    <>
                                      {matches.map((c) => (
                                        <button
                                          key={c.id}
                                          type="button"
                                          onMouseDown={(e) => e.preventDefault()}
                                          onClick={() => {
                                            setManualCliente(c.id);
                                            setManualClienteNome(c.nome);
                                            setManualClienteTelefone(c.whatsapp || "");
                                            setManualClienteOpen(false);
                                          }}
                                          className="w-full text-left px-3.5 py-2.5 font-body text-[12.5px] hover:bg-gold/10 flex items-center justify-between gap-2 text-primary-foreground"
                                        >
                                          <span className="font-medium truncate">{c.nome}</span>
                                          <span className="text-[11px] text-primary-foreground/50 tabular-nums shrink-0">{c.whatsapp}</span>
                                        </button>
                                      ))}
                                      <button
                                        type="button"
                                        onMouseDown={(e) => e.preventDefault()}
                                        onClick={() => {
                                          setManualClientTab("cadastrar");
                                          setManualClienteOpen(false);
                                        }}
                                        className="w-full text-left px-3.5 py-2.5 font-body text-[12px] font-semibold text-gold bg-gold/[0.06] hover:bg-gold/15 flex items-center gap-2 transition-colors"
                                      >
                                        <Plus className="w-3.5 h-3.5 shrink-0" />
                                        {manualClienteNome.trim()
                                          ? `Cadastrar "${manualClienteNome.trim()}" no sistema`
                                          : "Cadastrar nova cliente no sistema"}
                                      </button>
                                    </>
                                  );
                                })()}
                              </div>
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="space-y-2.5 rounded-xl border border-gold/25 bg-gold/[0.05] p-3">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            <div>
                              <label className="font-body text-[10px] font-medium text-primary-foreground/60 block mb-1 px-0.5">
                                Nome completo
                              </label>
                              <input
                                type="text"
                                placeholder="Ex: Maria Silva"
                                value={manualClienteNome}
                                onChange={(e) => {
                                  setManualCliente("");
                                  setManualClienteNome(e.target.value);
                                }}
                                className="w-full px-3 py-2 rounded-xl bg-[#262523] border border-primary-foreground/[0.16] text-primary-foreground font-body text-[13px] focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 placeholder:text-primary-foreground/40"
                              />
                            </div>
                            <div>
                              <label className="font-body text-[10px] font-medium text-primary-foreground/60 block mb-1 px-0.5">
                                Telefone / WhatsApp
                              </label>
                              <input
                                type="tel"
                                placeholder="(00) 00000-0000"
                                value={manualClienteTelefone}
                                onChange={(e) => setManualClienteTelefone(formatWhatsappMask(e.target.value))}
                                className="w-full px-3 py-2 rounded-xl bg-[#262523] border border-primary-foreground/[0.16] text-primary-foreground font-body text-[13px] tabular-nums focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 placeholder:text-primary-foreground/40"
                              />
                            </div>
                          </div>

                          <div className="flex items-center justify-between gap-2 pt-0.5">
                            <span className="font-body text-[10.5px] text-primary-foreground/55 leading-tight">
                              Salva na base de clientes automaticamente
                            </span>
                            <button
                              type="button"
                              onClick={handleQuickClientSignup}
                              disabled={quickRegisterLoading}
                              className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-gold/20 border border-gold/45 text-gold hover:bg-gold/30 font-body text-[11.5px] font-semibold transition-all disabled:opacity-50"
                            >
                              {quickRegisterLoading ? (
                                <>
                                  <Loader2 className="w-3 h-3 animate-spin" /> Cadastrando...
                                </>
                              ) : (
                                <>
                                  <Plus className="w-3 h-3" /> Cadastrar agora
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      )}

                      {manualClienteOpen && (
                        <div className="fixed inset-0 z-40" onClick={() => setManualClienteOpen(false)} />
                      )}

                      {manualCliente && (() => {
                        const creditoSaldo = Number(clientes.find(c => c.id === manualCliente)?.credito_saldo || 0);
                        if (creditoSaldo <= 0) return null;
                        return (
                          <div className="flex items-center justify-between rounded-xl border border-sky-400/30 bg-sky-500/15 px-3 py-1.5 font-body text-[11px] text-sky-300">
                            <span>💳 Crédito disponível</span>
                            <span className="font-semibold tabular-nums">R$ {creditoSaldo.toFixed(2).replace(".", ",")} (abatido no total)</span>
                          </div>
                        );
                      })()}
                    </div>

                    {/* 2. SERVIÇO */}
                    <div className="relative rounded-xl border border-primary-foreground/[0.09] bg-primary-foreground/[0.03] p-2.5 space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-gold/20 border border-gold/40 text-gold font-body text-[10px] font-bold flex items-center justify-center">
                            2
                          </span>
                          <span className="font-body text-[12px] font-semibold text-primary-foreground">
                            Serviço
                          </span>
                          <span className="font-body text-[10.5px] text-primary-foreground/45">(opcional)</span>
                        </div>
                        {manualItens.length > 0 && (
                          <span className="px-2 py-0.5 rounded-full bg-gold/15 border border-gold/35 font-body text-[10.5px] font-bold text-gold tabular-nums">
                            R$ {manualValorTotal.toFixed(2).replace(".", ",")} · {manualDuracaoTotal}min
                          </span>
                        )}
                      </div>

                      {/* Itens selecionados */}
                      {manualItens.length > 0 && (
                        <div className="space-y-1.5">
                          {manualItens.map((it) => (
                            <div key={it.id} className="flex items-center gap-2 rounded-lg border border-gold/35 bg-gold/[0.09] px-2.5 py-1.5">
                              <span className="flex-1 min-w-0 font-body text-[12px] font-semibold text-primary-foreground truncate">
                                {it.nome}
                              </span>
                              <div className="flex items-center gap-1 shrink-0">
                                <span className="text-[10.5px] text-gold font-medium">R$</span>
                                <input
                                  type="text"
                                  inputMode="numeric"
                                  placeholder="0,00"
                                  aria-label={`Valor ${it.nome}`}
                                  value={formatCurrencyValue(it.valor)}
                                  onChange={(e) => updateManualItem(it.id, { valor: parseCurrencyStr(formatCurrencyMask(e.target.value)) })}
                                  className="w-[72px] px-2 py-0.5 rounded-md bg-[#262523] border border-gold/30 text-primary-foreground font-body text-[11.5px] text-right tabular-nums focus:outline-none focus:border-gold"
                                />
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <input
                                  type="number"
                                  inputMode="numeric"
                                  min={5}
                                  step={5}
                                  aria-label={`Duração ${it.nome}`}
                                  value={it.duracao || ""}
                                  onChange={(e) => updateManualItem(it.id, { duracao: Number(e.target.value) || 0 })}
                                  className="w-11 px-1 py-0.5 rounded-md bg-[#262523] border border-primary-foreground/[0.14] text-primary-foreground font-body text-[11.5px] text-right tabular-nums focus:outline-none focus:border-gold"
                                />
                                <span className="text-[10px] text-primary-foreground/55">m</span>
                              </div>
                              <button
                                type="button"
                                onClick={() => removeManualItem(it.id)}
                                aria-label="Remover serviço"
                                className="w-5 h-5 rounded-md text-rose hover:bg-rose/15 flex items-center justify-center shrink-0"
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Chips rápidos dos serviços */}
                      {manualServicos.length > 0 && manualItens.length === 0 && !manualServicoSearch && (
                        <div className="flex flex-wrap gap-1.5">
                          {manualServicos.slice(0, 6).map((s) => (
                            <button
                              key={s.id}
                              type="button"
                              onClick={() => addManualItem(s.nome)}
                              className="px-2 py-1 rounded-lg border border-gold/25 bg-[#262523] hover:border-gold/60 hover:bg-gold/15 font-body text-[11px] text-primary-foreground transition-all flex items-center gap-1"
                            >
                              <span className="font-medium">+ {s.nome}</span>
                              <span className="text-[10px] font-semibold text-gold tabular-nums">R$ {Number(s.preco).toFixed(0)}</span>
                            </button>
                          ))}
                        </div>
                      )}

                      {/* Busca rápida */}
                      <div className="relative">
                        <Search className="h-3.5 w-3.5 text-gold/70 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                        <input
                          type="text"
                          placeholder={manualItens.length === 0 ? "Buscar ou escolher serviço..." : "+ Adicionar outro serviço..."}
                          value={manualServicoSearch}
                          onFocus={() => setManualServicoOpen(true)}
                          onChange={(e) => { setManualServicoSearch(e.target.value); setManualServicoOpen(true); }}
                          className="w-full pl-8 pr-3 py-1.5 rounded-lg bg-[#262523] border border-primary-foreground/[0.14] text-primary-foreground font-body text-[12px] focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20 placeholder:text-primary-foreground/40"
                        />
                        {manualServicoOpen && (
                          <div className="absolute z-50 mt-1 left-0 right-0 rounded-2xl border border-gold/25 bg-charcoal shadow-2xl overflow-hidden">
                            <div className="max-h-44 overflow-y-auto divide-y divide-primary-foreground/[0.06]">
                              {manualServicos
                                .filter((item) => item.nome.toLowerCase().includes(manualServicoSearch.toLowerCase()))
                                .map((s) => (
                                  <button
                                    key={s.id}
                                    type="button"
                                    onMouseDown={(e) => e.preventDefault()}
                                    onClick={() => {
                                      addManualItem(s.nome);
                                      setManualServicoSearch("");
                                      setManualServicoOpen(false);
                                    }}
                                    className="w-full text-left px-3.5 py-2.5 font-body text-[12.5px] hover:bg-gold/10 text-primary-foreground flex items-center justify-between gap-2"
                                  >
                                    <span className="font-medium truncate">{s.nome}</span>
                                    <span className="text-[11px] text-gold font-semibold tabular-nums shrink-0">
                                      R$ {Number(s.preco).toFixed(2).replace(".", ",")} · {s.duracao_minutos}m
                                    </span>
                                  </button>
                                ))}
                              {manualServicos.filter((item) => item.nome.toLowerCase().includes(manualServicoSearch.toLowerCase())).length === 0 && (
                                <p className="px-3 py-3 text-center font-body text-[12px] text-primary-foreground/45">Nenhum serviço encontrado</p>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                      {manualServicoOpen && (
                        <div className="fixed inset-0 z-40" onClick={() => setManualServicoOpen(false)} />
                      )}
                    </div>

                    {/* 3. DATA E HORÁRIO (24h com ícones claros) */}
                    <div className="rounded-xl border border-primary-foreground/[0.09] bg-primary-foreground/[0.03] p-2.5 space-y-2">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-gold/20 border border-gold/40 text-gold font-body text-[10px] font-bold flex items-center justify-center">
                            3
                          </span>
                          <span className="font-body text-[12px] font-semibold text-primary-foreground">
                            Data e Horário
                          </span>
                        </div>
                        <span className="px-1.5 py-0.5 rounded bg-primary-foreground/[0.06] border border-primary-foreground/[0.1] font-body text-[9.5px] font-medium text-primary-foreground/65">
                          24h
                        </span>
                      </div>

                      <div className="grid grid-cols-2 sm:grid-cols-[1.35fr_1fr_1fr] gap-1.5">
                        <div className="col-span-2 sm:col-span-1">
                          <input
                            type="date"
                            aria-label="Data do agendamento"
                            value={manualData}
                            onChange={(e) => setManualData(e.target.value)}
                            className="w-full px-2.5 py-1.5 rounded-lg bg-[#262523] border border-primary-foreground/[0.14] text-primary-foreground font-body text-[12px] tabular-nums [color-scheme:dark] focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                          />
                        </div>
                        <div>
                          <span className="font-body text-[9.5px] font-medium text-primary-foreground/50 block mb-0.5 px-0.5">Início</span>
                          <input
                            type="time"
                            value={manualHorario}
                            onChange={(e) => handleManualHorarioChange(e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg bg-[#262523] border border-gold/35 text-primary-foreground font-body text-[12px] font-semibold text-center tabular-nums [color-scheme:dark] focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                          />
                        </div>
                        <div>
                          <span className="font-body text-[9.5px] font-medium text-primary-foreground/50 block mb-0.5 px-0.5">Fim</span>
                          <input
                            type="time"
                            value={manualHorarioFim}
                            onChange={(e) => handleManualHorarioFimChange(e.target.value)}
                            className="w-full px-2 py-1.5 rounded-lg bg-[#262523] border border-primary-foreground/[0.14] text-primary-foreground font-body text-[12px] text-center tabular-nums [color-scheme:dark] focus:outline-none focus:border-gold focus:ring-2 focus:ring-gold/20"
                          />
                        </div>
                      </div>
                    </div>

                    {/* 4. PAGAMENTO */}
                    <div className="rounded-xl border border-primary-foreground/[0.09] bg-primary-foreground/[0.03] p-2.5 space-y-2">
                      <div className="flex items-center gap-1.5">
                        <span className="w-4 h-4 rounded-full bg-gold/20 border border-gold/40 text-gold font-body text-[10px] font-bold flex items-center justify-center">
                          4
                        </span>
                        <span className="font-body text-[12px] font-semibold text-primary-foreground">
                          Pagamento
                        </span>
                      </div>

                      <div className="grid grid-cols-3 gap-1.5">
                        {[
                          { id: "pendente" as const, label: "Pagar depois" },
                          { id: "sinal" as const, label: "Deu sinal" },
                          { id: "pago" as const, label: "Já pagou" },
                        ].map((opt) => (
                          <button
                            key={opt.id}
                            type="button"
                            onClick={() => {
                              setManualPaymentMode(opt.id);
                              if (opt.id === "pendente") {
                                setManualPago(false);
                                setManualValorPago("");
                              } else if (opt.id === "sinal") {
                                setManualPago(true);
                              } else {
                                setManualPago(true);
                                setManualValorPago("");
                              }
                            }}
                            className={`py-1.5 px-1.5 rounded-lg border font-body text-[11px] transition-all ${
                              manualPaymentMode === opt.id
                                ? opt.id === "pago"
                                  ? "border-emerald-400/60 bg-emerald-500/20 text-emerald-300 font-semibold shadow-sm"
                                  : opt.id === "sinal"
                                  ? "border-gold/60 bg-gold/20 text-gold font-semibold shadow-sm"
                                  : "border-primary-foreground/35 bg-[#2d2b29] text-primary-foreground font-semibold shadow-sm"
                                : "border-primary-foreground/[0.1] bg-[#262523] text-primary-foreground/60 hover:text-primary-foreground hover:border-primary-foreground/20"
                            }`}
                          >
                            {opt.label}
                          </button>
                        ))}
                      </div>

                      {manualPaymentMode !== "pendente" && (
                        <div className="space-y-2.5 rounded-xl border border-primary-foreground/[0.1] bg-[#232220] p-3">
                          <div className="grid grid-cols-3 gap-1.5">
                            {[
                              { id: "pix", label: "PIX" },
                              { id: "cartao", label: "Cartão" },
                              { id: "dinheiro", label: "Dinheiro" },
                            ].map((m) => (
                              <button
                                key={m.id}
                                type="button"
                                onClick={() => setManualFormaPagamento(m.id)}
                                className={`py-1.5 rounded-lg border font-body text-[11.5px] font-medium transition-all ${
                                  manualFormaPagamento === m.id
                                    ? "border-gold/55 bg-gold/20 text-gold font-semibold"
                                    : "border-primary-foreground/[0.1] bg-primary-foreground/[0.03] text-primary-foreground/60 hover:text-primary-foreground"
                                }`}
                              >
                                {m.label}
                              </button>
                            ))}
                          </div>

                          {manualPaymentMode === "sinal" && (
                            <div className="flex items-center gap-2">
                              <span className="font-body text-[11.5px] text-primary-foreground/75 font-medium shrink-0">Valor do sinal (R$):</span>
                              <input
                                type="text"
                                inputMode="numeric"
                                value={manualValorPago}
                                onChange={(e) => setManualValorPago(formatCurrencyMask(e.target.value))}
                                placeholder="0,00"
                                className="flex-1 px-3 py-1.5 rounded-lg bg-[#262523] border border-gold/45 text-gold font-body text-[13px] font-semibold tabular-nums focus:outline-none focus:border-gold"
                              />
                            </div>
                          )}
                        </div>
                      )}

                      {/* Status rápido + Extras opcionais */}
                      <div className="flex items-center justify-between pt-1">
                        <label className="inline-flex items-center gap-2.5 cursor-pointer select-none">
                          <Switch checked={manualConcluido} onCheckedChange={setManualConcluido} />
                          <span className={`font-body text-[12px] font-medium ${manualConcluido ? "text-emerald-400" : "text-primary-foreground/80"}`}>
                            Já foi atendida
                          </span>
                        </label>

                        <button
                          type="button"
                          onClick={() => setManualShowExtras((v) => !v)}
                          className="font-body text-[11px] text-primary-foreground/55 hover:text-gold transition-colors"
                        >
                          {manualShowExtras ? "− Ocultar extras" : "+ Extras (troco, gorjeta, crédito)"}
                        </button>
                      </div>

                      {manualShowExtras && (
                        <div className="grid grid-cols-3 gap-2 rounded-xl border border-primary-foreground/[0.1] bg-[#232220] p-3">
                          <div>
                            <label className="font-body text-[9.5px] text-sky-300/90 block mb-1">Troco (R$)</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={formatCurrencyValue(manualTroco)}
                              onChange={(e) => setManualTroco(parseCurrencyStr(formatCurrencyMask(e.target.value)))}
                              placeholder="0,00"
                              className="w-full px-2.5 py-1.5 rounded-lg bg-[#262523] border border-primary-foreground/[0.12] text-primary-foreground font-body text-[12px] tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="font-body text-[9.5px] text-purple-300/90 block mb-1">Gorjeta (R$)</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={formatCurrencyValue(manualGorjeta)}
                              onChange={(e) => setManualGorjeta(parseCurrencyStr(formatCurrencyMask(e.target.value)))}
                              placeholder="0,00"
                              className="w-full px-2.5 py-1.5 rounded-lg bg-[#262523] border border-primary-foreground/[0.12] text-primary-foreground font-body text-[12px] tabular-nums"
                            />
                          </div>
                          <div>
                            <label className="font-body text-[9.5px] text-emerald-300/90 block mb-1">Crédito (R$)</label>
                            <input
                              type="text"
                              inputMode="numeric"
                              value={formatCurrencyValue(manualCredito)}
                              onChange={(e) => setManualCredito(parseCurrencyStr(formatCurrencyMask(e.target.value)))}
                              placeholder="0,00"
                              className="w-full px-2.5 py-1.5 rounded-lg bg-[#262523] border border-primary-foreground/[0.12] text-primary-foreground font-body text-[12px] tabular-nums"
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Footer fixo compacto */}
                  <div className="shrink-0 px-4 py-2.5 border-t border-primary-foreground/[0.08] bg-charcoal flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setShowManualRegister(false)}
                      className="px-3.5 py-2.5 rounded-xl border border-primary-foreground/[0.14] bg-[#262523] text-primary-foreground/75 hover:text-primary-foreground hover:border-primary-foreground/30 font-body text-[12px] font-medium transition-all"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={saveManualRegistration}
                      disabled={manualSaving}
                      className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-gold via-[#e2a380] to-gold text-charcoal font-body text-[12.5px] font-bold shadow-[0_8px_24px_-6px_hsl(22_58%_63%/0.5)] hover:brightness-105 active:scale-[0.98] transition-all disabled:opacity-40"
                    >
                      {manualSaving ? "Salvando..." : "Salvar Agendamento"}
                    </button>
                  </div>
                </DialogContent>
              </Dialog>



              {/* Extend Duration Dialog */}
              <Dialog open={showExtendDialog} onOpenChange={setShowExtendDialog}>
                <DialogContent className="w-[calc(100vw-1rem)] max-w-[calc(100vw-1rem)] sm:max-w-sm max-h-[85dvh] overflow-y-auto overflow-x-hidden bg-charcoal border border-blue-500/20 rounded-2xl p-4 sm:p-5">
                  <DialogHeader>
                    <DialogTitle className="font-heading text-[16px] font-semibold text-primary-foreground flex items-center gap-2">
                      <Timer className="w-4 h-4 text-blue-400" />
                      Estender Atendimento
                    </DialogTitle>
                  </DialogHeader>
                  {(() => {
                    const ag = agendamentos.find(a => a.id === extendingId);
                    if (!ag) return null;
                    const extraMin = Number(extendMinutes) || 30;
                    const newDuration = (ag.duracao_minutos || 60) + extraMin;
                    const [startH, startM] = ag.horario.split(":").map(Number);
                    const endTotalMin = startH * 60 + startM + newDuration;
                    const endH = Math.floor(endTotalMin / 60);
                    const endMn = endTotalMin % 60;
                    const newSlotsBlocked = Math.ceil(newDuration / 30);
                    return (
                      <div className="space-y-3 w-full">
                        <div className="p-3 rounded-xl bg-primary-foreground/[0.03] border border-primary-foreground/[0.06]">
                          <p className="font-body text-[13px] font-medium text-primary-foreground">{ag.servico}</p>
                          <p className="font-body text-[11px] text-primary-foreground/40 mt-0.5">
                            {ag.horario} · Duração atual: {ag.duracao_minutos || 60} min
                          </p>
                        </div>

                        <div>
                          <label className="font-body text-[10px] text-primary-foreground/30 mb-1 block">Adicionar minutos</label>
                          <div className="grid grid-cols-4 gap-1.5">
                            {["30", "60", "90", "120"].map(m => (
                              <button
                                key={m}
                                onClick={() => setExtendMinutes(m)}
                                className={`py-2 rounded-xl font-body text-[12px] font-medium transition-all border ${
                                  extendMinutes === m
                                    ? "bg-blue-500/10 text-blue-400 border-blue-500/20"
                                    : "bg-primary-foreground/[0.03] text-primary-foreground/40 border-primary-foreground/[0.06] hover:text-primary-foreground/60"
                                }`}
                              >
                                +{m}min
                              </button>
                            ))}
                          </div>
                        </div>

                        <div className="p-3 rounded-xl bg-blue-500/5 border border-blue-500/15">
                          <div className="flex items-center justify-between">
                            <p className="font-body text-[11px] text-blue-400/70">Nova duração</p>
                            <p className="font-body text-[14px] font-bold text-blue-400">{newDuration} min</p>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <p className="font-body text-[11px] text-blue-400/70">Término</p>
                            <p className="font-body text-[13px] font-medium text-blue-400">
                              {String(endH).padStart(2, "0")}:{String(endMn).padStart(2, "0")}
                            </p>
                          </div>
                          <div className="flex items-center justify-between mt-1">
                            <p className="font-body text-[11px] text-blue-400/70">Slots bloqueados</p>
                            <p className="font-body text-[13px] font-medium text-blue-400">{newSlotsBlocked}</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 pt-1">
                          <button
                            onClick={saveExtendAppointment}
                            disabled={extendSaving}
                            className="w-full py-2.5 rounded-xl bg-blue-500/10 text-blue-400 font-body text-[13px] font-medium hover:bg-blue-500/20 transition-all disabled:opacity-40"
                          >
                            {extendSaving ? "Salvando..." : "Estender"}
                          </button>
                          <button
                            onClick={() => setShowExtendDialog(false)}
                            className="w-full py-2.5 rounded-xl bg-primary-foreground/[0.05] text-primary-foreground/40 font-body text-[13px] hover:text-primary-foreground/60 transition-all"
                          >
                            Cancelar
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </DialogContent>
              </Dialog>

          {tab === "clientes" && (
            <ClientesTab
              clientes={clientes}
              setClientes={setClientes}
              searchClientes={searchClientes}
              agendamentos={agendamentos}
              searchTerm={searchTerm}
              setSearchTerm={setSearchTerm}
              selectedClientId={selectedClient}
              onSelectClientId={setSelectedClient}
              onReload={loadData}
              onRegisterClient={ensureClientRegistered}
              onBookClient={openManualRegisterForClient}
            />
          )}

          {tab === "caixa" && <CaixaTab agendamentos={agendamentos} getClientName={getClientName} onUpdate={loadData} />}
          {tab === "pagamentos" && <PagamentosTab agendamentos={agendamentos} getClientName={getClientName} onUpdate={loadData} onEdit={openEditAgendamento} clientes={clientes} />}
          {tab === "gastos" && <GastosTab />}
          {tab === "pedidos" && (
            <PedidosTab
              agendamentos={agendamentos.filter(a => !(a.servico === "Adição de Crédito" || a.servico === "Entrada Manual" || (a.servico && a.servico.startsWith("Pagamento de Dívida"))))}
              getClientName={getClientName}
              clientes={clientes}
              setClientes={setClientes}
              onUpdate={loadData}
              onBookClient={openManualRegisterForClient}
            />
          )}
          {tab === "avaliacoes" && <AvaliacoesTab />}
          {tab === "gateway" && <GatewayTab />}
          {tab === "horarios" && <HorariosTab />}
          {tab === "servicos_app" && <ServicosTab tableName="servicos_app" storageKey="admin_custom_categorias_servicos_app" />}
        </div>
      </div>

      {/* Bottom nav fixa - mobile only - atalhos do dia a dia */}
      <nav className="fixed bottom-0 inset-x-0 z-30 border-t border-primary-foreground/[0.06] bg-charcoal/95 backdrop-blur-xl lg:hidden">
        <div className="mx-auto flex w-full max-w-md items-stretch justify-around px-1 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]">
          {tabs
            .filter((t) => ["dashboard", "agendamentos", "caixa", "pagamentos"].includes(t.id))
            .map((t) => {
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`group flex flex-1 flex-col items-center justify-center gap-1 rounded-xl px-2 py-2 transition-all ${
                    active ? "tab-active text-gold" : "text-primary-foreground/45 hover:text-primary-foreground/70"
                  }`}
                >
                  <t.icon
                    className={`h-5 w-5 tab-icon ${t.anim} ${active ? "scale-110" : ""}`}
                    style={{ color: active ? undefined : t.color }}
                  />
                  <span className="font-body text-[10px] font-medium leading-none">{t.label}</span>
                </button>
              );
            })}
        </div>
      </nav>
    </div>
  );
};

export default Admin;
