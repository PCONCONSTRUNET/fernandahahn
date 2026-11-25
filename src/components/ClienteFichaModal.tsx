import { useState, useMemo, useEffect } from "react";
import { toast } from "sonner";
import { Edit2, Trash2, Calendar, CheckCircle2 } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";
import {
  formatWhatsappMask,
  formatCurrencyMask,
  formatCurrencyValue,
  parseCurrencyStr,
} from "@/lib/utils";
import { normalizeWhatsappNumber } from "@/lib/notify-webhook";
import WhatsAppIcon from "@/components/icons/WhatsAppIcon";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export interface ClienteProfile {
  id: string;
  nome: string;
  whatsapp: string;
  cpf?: string | null;
  created_at: string;
  credito_saldo?: number | null;
}

export interface ClienteAgendamento {
  id: string;
  servico: string;
  variacao: string | null;
  data_agendamento: string;
  horario: string;
  valor: number;
  valor_pago: number | null;
  valor_desconto_credito?: number | null;
  status: string;
  user_id: string;
  cliente_nome: string | null;
}

export interface ClientMetrics {
  totalAgendamentos: number;
  realizadas: number;
  faltas: number;
  canceladas: number;
  totalGasto: number;
  totalValor: number;
  saldoDevedor: number;
  pedidosDevendo: number;
  ultimaVisita: string | null;
}

const STATUS_BADGE_MAP: Record<string, { label: string; cls: string }> = {
  confirmado: { label: "Confirmado", cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" },
  concluido: { label: "Concluído", cls: "text-emerald-300 bg-emerald-500/15 border-emerald-500/25" },
  falta: { label: "Falta", cls: "text-red-400 bg-red-500/10 border-red-500/20" },
  cancelado: { label: "Cancelado", cls: "text-white/45 bg-white/5 border-white/10" },
  pendente: { label: "Pendente", cls: "text-amber-300 bg-amber-500/10 border-amber-500/20" },
};

export const formatDateShort = (d: string) => {
  if (!d) return "—";
  try {
    return new Date(d + "T12:00:00").toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
    });
  } catch {
    return d;
  }
};

export const formatWhatsappDisplay = (w: string) => {
  if (!w) return "Sem WhatsApp";
  let d = w.replace(/\D/g, "");
  if ((d.length === 12 || d.length === 13) && d.startsWith("55")) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return w;
};

export const formatBRL = (val: number) =>
  new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(val);

export function computeClientMetrics(ags: ClienteAgendamento[]): ClientMetrics {
  let realizadas = 0;
  let faltas = 0;
  let canceladas = 0;
  let totalGasto = 0;
  let totalValor = 0;
  let saldoDevedor = 0;
  let pedidosDevendo = 0;
  let ultimaVisita: string | null = null;

  for (const a of ags) {
    const pago = Number(a.valor_pago || 0);
    const descontoCred = Number(a.valor_desconto_credito || 0);
    const valorTotal = Number(a.valor || 0);

    totalGasto += pago;
    totalValor += valorTotal;

    if (a.status === "confirmado" || a.status === "concluido") {
      realizadas += 1;
      if (!ultimaVisita || a.data_agendamento > ultimaVisita) {
        ultimaVisita = a.data_agendamento;
      }
    } else if (a.status === "falta") {
      faltas += 1;
    } else if (a.status === "cancelado") {
      canceladas += 1;
    }

    if (a.status !== "cancelado" && a.status !== "falta") {
      const restante = valorTotal - pago - descontoCred;
      if (restante > 0.01) {
        saldoDevedor += restante;
        pedidosDevendo += 1;
      }
    }
  }

  return {
    totalAgendamentos: ags.length,
    realizadas,
    faltas,
    canceladas,
    totalGasto,
    totalValor,
    saldoDevedor,
    pedidosDevendo,
    ultimaVisita,
  };
}

export function openClienteWhatsapp(whatsapp: string) {
  const digits = normalizeWhatsappNumber(whatsapp);
  if (digits.length < 12) {
    toast.error("Cliente sem número de WhatsApp válido");
    return;
  }
  window.open(`https://wa.me/${digits}`, "_blank", "noopener,noreferrer");
}

interface ClienteFichaModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  cliente: ClienteProfile | null;
  fallbackName?: string;
  clienteAgendamentos: ClienteAgendamento[];
  setClientes?: React.Dispatch<React.SetStateAction<ClienteProfile[]>>;
  onReload?: () => Promise<void> | void;
  onBookClient?: (cliente: ClienteProfile) => void;
  onAfterDelete?: () => void;
}

/**
 * Ficha completa da cliente (reutilizada entre ClientesTab e PedidosTab).
 */
const ClienteFichaModal = ({
  open,
  onOpenChange,
  cliente,
  fallbackName,
  clienteAgendamentos,
  setClientes,
  onReload,
  onBookClient,
  onAfterDelete,
}: ClienteFichaModalProps) => {
  const [editProfileEditing, setEditProfileEditing] = useState(false);
  const [editProfileNome, setEditProfileNome] = useState("");
  const [editProfileWhatsapp, setEditProfileWhatsapp] = useState("");
  const [editProfileSaving, setEditProfileSaving] = useState(false);

  const [editingCredito, setEditingCredito] = useState(false);
  const [tempCredito, setTempCredito] = useState("");
  const [savingCredito, setSavingCredito] = useState(false);

  const [clienteParaExcluir, setClienteParaExcluir] = useState<ClienteProfile | null>(null);
  const [excluindoCliente, setExcluindoCliente] = useState(false);

  useEffect(() => {
    if (!open) {
      setEditProfileEditing(false);
      setEditingCredito(false);
    }
  }, [open, cliente?.id]);

  const sortedAgendamentos = useMemo(
    () =>
      [...clienteAgendamentos].sort((a, b) =>
        b.data_agendamento.localeCompare(a.data_agendamento) || b.horario.localeCompare(a.horario)
      ),
    [clienteAgendamentos]
  );

  const metrics = useMemo(() => computeClientMetrics(sortedAgendamentos), [sortedAgendamentos]);

  const handleSaveProfile = async () => {
    if (!cliente) return;
    const cleanNome = editProfileNome.trim();
    const cleanWhatsapp = editProfileWhatsapp.replace(/\D/g, "");
    if (cleanNome.length < 2) {
      toast.error("Informe o nome da cliente");
      return;
    }
    if (cleanWhatsapp.length < 10) {
      toast.error("Informe um WhatsApp válido com DDD");
      return;
    }

    setEditProfileSaving(true);
    try {
      if (isSupabaseConfigured) {
        const { error } = await (supabase as any).rpc("admin_update_profile", {
          p_user_id: cliente.id,
          p_nome: cleanNome,
          p_whatsapp: cleanWhatsapp,
        });
        if (error) throw error;
      }
      setClientes?.((prev) =>
        prev.map((c) =>
          c.id === cliente.id ? { ...c, nome: cleanNome, whatsapp: cleanWhatsapp } : c
        )
      );
      toast.success("Dados da cliente atualizados!");
      setEditProfileEditing(false);
    } catch (err: any) {
      console.error("Erro ao atualizar perfil:", err);
      toast.error("Erro ao atualizar dados da cliente");
    } finally {
      setEditProfileSaving(false);
    }
  };

  const handleSaveCredito = async () => {
    if (!cliente) return;
    setSavingCredito(true);
    const novoSaldo = Math.max(0, parseCurrencyStr(tempCredito));
    try {
      if (isSupabaseConfigured) {
        const { error } = await (supabase as any).rpc("admin_set_credito_saldo", {
          p_user_id: cliente.id,
          p_novo_saldo: novoSaldo,
        });
        if (error) throw error;
      }
      setClientes?.((prev) =>
        prev.map((c) => (c.id === cliente.id ? { ...c, credito_saldo: novoSaldo } : c))
      );
      toast.success("Crédito atualizado!");
      setEditingCredito(false);
    } catch (err: any) {
      console.error("Erro ao salvar crédito:", err);
      toast.error("Erro ao salvar crédito: " + (err?.message || ""));
    } finally {
      setSavingCredito(false);
    }
  };

  const handleExcluirCliente = async () => {
    if (!clienteParaExcluir) return;
    setExcluindoCliente(true);
    try {
      if (isSupabaseConfigured) {
        const { data, error } = await supabase.functions.invoke("admin-delete-cliente", {
          body: { user_id: clienteParaExcluir.id },
        });
        if (error || (data && data.error)) {
          throw new Error(error?.message || data?.error || "Erro desconhecido");
        }
        await onReload?.();
      } else {
        setClientes?.((prev) => prev.filter((c) => c.id !== clienteParaExcluir.id));
      }

      toast.success("Cliente excluída com sucesso");
      onOpenChange(false);
      setClienteParaExcluir(null);
      onAfterDelete?.();
    } catch (e: any) {
      console.error("Erro ao excluir cliente:", e);
      toast.error(`Erro ao excluir: ${e.message || "tente novamente"}`);
    } finally {
      setExcluindoCliente(false);
    }
  };

  const displayName = cliente?.nome || fallbackName || "Cliente";
  const canEditProfile = Boolean(cliente && setClientes);
  const creditoSaldo = Number(cliente?.credito_saldo || 0);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="w-[calc(100vw-1rem)] max-w-md max-h-[calc(100dvh-1rem)] overflow-y-auto overflow-x-hidden rounded-[24px] border border-white/10 bg-[#1c1c1e] p-5 shadow-2xl custom-scrollbar">
          <DialogHeader className="mb-2">
            <DialogTitle className="font-heading text-[20px] font-semibold text-white tracking-wide flex items-center justify-between pr-6">
              <span className="truncate">
                {editProfileEditing ? "Editar Perfil" : displayName}
              </span>
              {!editProfileEditing && canEditProfile && cliente && (
                <button
                  type="button"
                  title="Editar nome e WhatsApp"
                  onClick={() => {
                    setEditProfileNome(cliente.nome);
                    setEditProfileWhatsapp(formatWhatsappMask(cliente.whatsapp || ""));
                    setEditProfileEditing(true);
                  }}
                  className="p-1.5 rounded-lg text-white/50 hover:text-white hover:bg-white/10 transition-colors"
                >
                  <Edit2 className="w-4 h-4" />
                </button>
              )}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-3 relative z-10">
            {/* Atalhos diretos */}
            {cliente && !editProfileEditing && (
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => openClienteWhatsapp(cliente.whatsapp)}
                  className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 font-body text-[12px] font-semibold hover:bg-emerald-500/25 transition-all"
                >
                  <WhatsAppIcon className="w-3.5 h-3.5" />
                  Chamar no WhatsApp
                </button>
                {onBookClient && (
                  <button
                    type="button"
                    onClick={() => {
                      onOpenChange(false);
                      onBookClient(cliente);
                    }}
                    className="flex items-center justify-center gap-1.5 py-2.5 px-3 rounded-xl bg-gradient-to-br from-gold to-nude text-charcoal font-body text-[12px] font-bold hover:brightness-105 transition-all"
                  >
                    <Calendar className="w-3.5 h-3.5" />
                    Novo Horário
                  </button>
                )}
              </div>
            )}

            {/* Dados Pessoais ou Edição */}
            {cliente &&
              (editProfileEditing ? (
                <div className="space-y-3 rounded-[20px] border border-white/10 bg-[#2c2c2e] p-4">
                  <div>
                    <label className="font-body text-[11px] text-white/55 mb-1 block uppercase tracking-wider font-semibold">
                      Nome completo
                    </label>
                    <input
                      value={editProfileNome}
                      onChange={(e) => setEditProfileNome(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-body text-[13px] focus:outline-none focus:border-gold/45"
                    />
                  </div>
                  <div>
                    <label className="font-body text-[11px] text-white/55 mb-1 block uppercase tracking-wider font-semibold">
                      WhatsApp
                    </label>
                    <input
                      value={editProfileWhatsapp}
                      onChange={(e) => setEditProfileWhatsapp(formatWhatsappMask(e.target.value))}
                      className="w-full px-3 py-2 rounded-xl bg-white/5 border border-white/10 text-white font-body text-[13px] focus:outline-none focus:border-gold/45"
                    />
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-2">
                    <button
                      type="button"
                      onClick={() => setEditProfileEditing(false)}
                      className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/10 text-white/65 font-body text-[12px] hover:bg-white/10 transition-all"
                    >
                      Cancelar
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveProfile}
                      disabled={editProfileSaving}
                      className="px-3.5 py-1.5 rounded-xl bg-gold text-charcoal font-body text-[12px] font-bold hover:brightness-105 transition-all disabled:opacity-50"
                    >
                      {editProfileSaving ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 rounded-[20px] border border-white/5 bg-[#2c2c2e] p-3.5">
                  <div className="flex items-center justify-between text-[13px] font-body text-white/90">
                    <span className="text-white/50">WhatsApp</span>
                    <span className="font-medium">{formatWhatsappDisplay(cliente.whatsapp)}</span>
                  </div>
                  {cliente.cpf && (
                    <div className="flex items-center justify-between text-[13px] font-body text-white/90">
                      <span className="text-white/50">CPF</span>
                      <span className="font-medium tabular-nums">
                        {cliente.cpf.replace(/(\d{3})(\d{3})(\d{3})(\d{2})/, "$1.$2.$3-$4")}
                      </span>
                    </div>
                  )}
                  <div className="flex items-center justify-between text-[13px] font-body text-white/90">
                    <span className="text-white/50">Cliente desde</span>
                    <span className="font-medium">
                      {new Date(cliente.created_at).toLocaleDateString("pt-BR")}
                    </span>
                  </div>
                </div>
              ))}

            {/* Resumo Financeiro */}
            <div className="grid grid-cols-2 gap-2">
              <div className="rounded-[20px] bg-[#2c2c2e] p-3 text-center">
                <p className="font-heading text-[18px] font-semibold text-emerald-400 tabular-nums">
                  {formatBRL(metrics.totalGasto)}
                </p>
                <p className="font-body text-[10px] text-emerald-400/80 mt-0.5 uppercase tracking-wider">
                  Total pago
                </p>
              </div>
              <div className="rounded-[20px] bg-[#2c2c2e] p-3 text-center">
                <p className="font-heading text-[18px] font-semibold text-amber-400 tabular-nums">
                  {formatBRL(metrics.saldoDevedor)}
                </p>
                <p className="font-body text-[10px] text-amber-400/80 mt-0.5 uppercase tracking-wider">
                  Valor em aberto
                </p>
              </div>
            </div>

            {/* Crédito a Haver */}
            {cliente && (
              <div
                className={`rounded-[20px] p-3 border ${
                  creditoSaldo > 0
                    ? "bg-sky-500/15 border-sky-400/30 text-sky-200"
                    : "bg-white/[0.06] border-white/15 text-white/90"
                }`}
              >
                <div className="flex items-center justify-between mb-1">
                  <p className="font-body text-[11px] uppercase tracking-wider font-semibold">
                    Crédito a Haver
                  </p>
                  {canEditProfile &&
                    (!editingCredito ? (
                      <button
                        type="button"
                        onClick={() => {
                          setTempCredito(formatCurrencyValue(creditoSaldo));
                          setEditingCredito(true);
                        }}
                        className="px-2.5 py-0.5 rounded-lg bg-white/10 border border-white/15 text-white/90 hover:bg-white/20 font-body text-[10.5px] transition-all"
                      >
                        Ajustar
                      </button>
                    ) : (
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={handleSaveCredito}
                          disabled={savingCredito}
                          className="px-2.5 py-0.5 rounded-lg bg-sky-500/35 text-white font-body text-[10.5px] font-semibold hover:bg-sky-500/50 transition-all disabled:opacity-50"
                        >
                          {savingCredito ? "..." : "Salvar"}
                        </button>
                        <button
                          type="button"
                          onClick={() => setEditingCredito(false)}
                          className="px-2.5 py-0.5 rounded-lg bg-white/10 border border-white/15 text-white/90 font-body text-[10.5px] hover:bg-white/20 transition-all"
                        >
                          Cancelar
                        </button>
                      </div>
                    ))}
                </div>
                {editingCredito ? (
                  <div className="flex items-center gap-2">
                    <span className="font-body text-[13px] text-white/80">R$</span>
                    <input
                      type="text"
                      inputMode="numeric"
                      value={tempCredito}
                      onChange={(e) => setTempCredito(formatCurrencyMask(e.target.value))}
                      placeholder="0,00"
                      autoFocus
                      className="flex-1 px-2.5 py-1 rounded-xl bg-white/10 border border-white/25 text-white font-heading text-[16px] focus:outline-none focus:ring-1 focus:ring-white/50 tabular-nums"
                    />
                  </div>
                ) : (
                  <p
                    className={`font-heading text-[20px] font-semibold tabular-nums ${
                      creditoSaldo > 0 ? "text-sky-300" : "text-white"
                    }`}
                  >
                    {formatBRL(creditoSaldo)}
                  </p>
                )}
              </div>
            )}

            {/* Status financeiro */}
            {metrics.saldoDevedor > 0.01 ? (
              <div className="rounded-[20px] bg-amber-500/10 border border-amber-500/20 p-3 flex items-center justify-between">
                <div>
                  <p className="font-body text-[10px] uppercase tracking-wider text-amber-400/80 font-semibold">
                    Saldo devendo
                  </p>
                  <p className="font-heading text-[18px] font-semibold text-amber-300 leading-tight tabular-nums">
                    {formatBRL(metrics.saldoDevedor)}
                  </p>
                </div>
                <span className="font-body text-[11px] text-amber-300/80">
                  {metrics.pedidosDevendo}{" "}
                  {metrics.pedidosDevendo === 1 ? "atendimento em aberto" : "atendimentos em aberto"}
                </span>
              </div>
            ) : metrics.totalValor > 0 ? (
              <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/[0.05] p-3 flex items-center gap-2.5">
                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                <p className="font-body text-[12px] text-emerald-300/90 font-medium">
                  Cliente sem pendências financeiras.
                </p>
              </div>
            ) : null}

            {/* Contadores de frequência */}
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-[16px] bg-[#2c2c2e] p-2.5 text-center">
                <p className="font-heading text-[16px] font-semibold text-emerald-400 tabular-nums">
                  {metrics.realizadas}
                </p>
                <p className="font-body text-[9px] text-emerald-400/75 uppercase tracking-widest mt-0.5">
                  Realizadas
                </p>
              </div>
              <div className="rounded-[16px] bg-[#2c2c2e] p-2.5 text-center">
                <p className="font-heading text-[16px] font-semibold text-red-400 tabular-nums">
                  {metrics.faltas}
                </p>
                <p className="font-body text-[9px] text-red-400/75 uppercase tracking-widest mt-0.5">
                  Faltas
                </p>
              </div>
              <div className="rounded-[16px] bg-[#2c2c2e] p-2.5 text-center">
                <p className="font-heading text-[16px] font-semibold text-white/60 tabular-nums">
                  {metrics.canceladas}
                </p>
                <p className="font-body text-[9px] text-white/40 uppercase tracking-widest mt-0.5">
                  Canceladas
                </p>
              </div>
            </div>

            {/* Histórico */}
            <div className="space-y-2">
              <p className="font-body text-[11px] font-medium text-white/55 uppercase tracking-wider pl-1">
                Histórico de atendimentos
              </p>
              <div className="max-h-[190px] space-y-1.5 overflow-y-auto pr-1 custom-scrollbar">
                {sortedAgendamentos.length === 0 && (
                  <p className="py-4 text-center font-body text-[12px] text-white/35 italic">
                    Nenhum procedimento registrado ainda.
                  </p>
                )}
                {sortedAgendamentos.map((a) => {
                  const meta = STATUS_BADGE_MAP[a.status] || {
                    label: a.status,
                    cls: "text-white/70 bg-white/5 border-white/10",
                  };
                  const restante =
                    Number(a.valor || 0) -
                    Number(a.valor_pago || 0) -
                    Number(a.valor_desconto_credito || 0);
                  return (
                    <div
                      key={a.id}
                      className="flex flex-col gap-1.5 rounded-[16px] border border-white/10 bg-[#2c2c2e] p-3"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <p className="font-heading text-[13px] font-medium text-white truncate">
                            {a.servico}
                            {a.variacao ? ` - ${a.variacao}` : ""}
                          </p>
                          <p className="font-body text-[11px] text-white/45 mt-0.5 flex items-center gap-1.5">
                            <span>{formatDateShort(a.data_agendamento)}</span>
                            <span className="w-1 h-1 rounded-full bg-white/25" />
                            <span>{a.horario}</span>
                          </p>
                        </div>
                        <p className="font-body text-[13px] font-semibold text-white/95 shrink-0 tabular-nums">
                          {formatBRL(Number(a.valor_pago || 0))}
                        </p>
                      </div>

                      <div className="flex items-center justify-between gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full border font-body text-[10px] font-medium ${meta.cls}`}
                        >
                          {meta.label}
                        </span>
                        {a.status !== "cancelado" &&
                          a.status !== "falta" &&
                          restante > 0.01 && (
                            <span className="font-body text-[10px] text-amber-300 font-semibold tabular-nums">
                              Devendo {formatBRL(restante)}
                            </span>
                          )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {canEditProfile && cliente && (
              <div className="pt-1">
                <button
                  type="button"
                  onClick={() => setClienteParaExcluir(cliente)}
                  className="w-full flex items-center justify-center gap-2 rounded-2xl border border-transparent bg-transparent px-4 py-3 font-body text-[12.5px] font-semibold text-red-400/70 hover:bg-red-500/10 hover:border-red-500/30 hover:text-red-400 transition-all"
                >
                  <Trash2 className="h-4 w-4" />
                  Excluir cliente permanentemente
                </button>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmação de Exclusão */}
      <AlertDialog
        open={!!clienteParaExcluir}
        onOpenChange={(o) => !o && !excluindoCliente && setClienteParaExcluir(null)}
      >
        <AlertDialogContent className="w-[calc(100vw-1rem)] max-w-md rounded-2xl border-red-500/30 bg-charcoal">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-heading text-primary-foreground">
              Excluir {clienteParaExcluir?.nome}?
            </AlertDialogTitle>
            <AlertDialogDescription className="font-body text-[13px] text-primary-foreground/65">
              Esta ação é <strong className="text-red-400">permanente e não pode ser desfeita</strong>.
              Serão excluídos do sistema:
              <ul className="mt-2 list-disc pl-5 space-y-0.5 text-[12px]">
                <li>O perfil da cliente</li>
                <li>Todos os agendamentos dela</li>
                <li>A conta de login (quando vinculada)</li>
              </ul>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={excluindoCliente}
              className="bg-primary-foreground/[0.05] border-primary-foreground/[0.1] text-primary-foreground hover:bg-primary-foreground/[0.1]"
            >
              Cancelar
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={excluindoCliente}
              onClick={(e) => {
                e.preventDefault();
                handleExcluirCliente();
              }}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {excluindoCliente ? "Excluindo..." : "Excluir tudo"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

export default ClienteFichaModal;
