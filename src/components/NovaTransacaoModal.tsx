import { parseCurrencyStr, formatCurrencyMask } from "@/lib/utils";
import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ArrowDown, ArrowUp, DollarSign, FileText, Check } from "lucide-react";
import { notifyCaixaUpdated } from "@/lib/caixa";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
  initialTab?: "entrada" | "saida";
}

const CATEGORIAS_SAIDA = [
  "Aluguel",
  "Energia",
  "Água",
  "Internet",
  "Materiais/Insumos",
  "Marketing/Anúncios",
  "Equipamentos",
  "Manutenção",
  "Limpeza",
  "Pessoal/Pró-labore",
  "Impostos/Taxas",
  "Outros",
];

const FORMAS_PAGAMENTO = [
  { id: "pix", label: "PIX" },
  { id: "cartao", label: "Cartão" },
  { id: "dinheiro", label: "Dinheiro" },
];

export default function NovaTransacaoModal({ open, onOpenChange, onSuccess, initialTab = "entrada" }: Props) {
  const [tab, setTab] = useState<"entrada" | "saida">(initialTab);
  const [saving, setSaving] = useState(false);

  const [data, setData] = useState(
    new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split("T")[0]
  );
  const [valor, setValor] = useState("");
  const [descricao, setDescricao] = useState("");
  const [formaPagamento, setFormaPagamento] = useState("pix");
  const [categoria, setCategoria] = useState("Materiais/Insumos");
  const [tipoGasto, setTipoGasto] = useState<"estudio" | "pessoal">("estudio");

  useEffect(() => {
    if (open) {
      setTab(initialTab);
      setData(new Date(new Date().getTime() - new Date().getTimezoneOffset() * 60000).toISOString().split("T")[0]);
      setValor("");
      setDescricao("");
      setFormaPagamento("pix");
      setCategoria("Materiais/Insumos");
      setTipoGasto("estudio");
      setSaving(false);
    }
  }, [open, initialTab]);

  const handleSave = async () => {
    if (!descricao.trim()) return toast.error("Informe uma descrição");
    const valNum = parseCurrencyStr(valor);
    if (isNaN(valNum) || valNum <= 0) return toast.error("Informe um valor válido");

    setSaving(true);

    try {
      if (tab === "entrada") {
        const { data: userData } = await supabase.auth.getUser();
        const userId = userData.user?.id || null;

        const now = new Date();
        const horario = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
        const [year, month, day] = data.split("-").map(Number);
        const paidAt = new Date(
          year,
          month - 1,
          day,
          now.getHours(),
          now.getMinutes(),
          now.getSeconds(),
        ).toISOString();

        const payload = {
          user_id: userId,
          cliente_nome: descricao.trim() || "Registro de Pagamento",
          servico: "Entrada Manual",
          variacao: descricao.trim(),
          valor: valNum,
          valor_pago: valNum,
          paid_at: paidAt,
          data_agendamento: data,
          horario: horario,
          status: "concluido",
          forma_pagamento: formaPagamento,
          observacao: "",
          duracao_minutos: 0,
          origem: "manual",
        };

        const { error } = await supabase.from("agendamentos").insert([payload]);
        if (error) throw error;
        toast.success("Entrada registrada com sucesso!");

      } else {
        const payload = {
          descricao: descricao.trim(),
          observacao: "",
          valor: valNum,
          categoria: categoria,
          data_vencimento: data,
          pago: true,
          data_pagamento: data,
          tipo: tipoGasto,
        };

        const { error } = await supabase.from("despesas").insert([payload]);
        if (error) throw error;
        toast.success(`Gasto (${tipoGasto === "estudio" ? "Estúdio" : "Pessoal"}) contabilizado no Caixa!`);
      }

      notifyCaixaUpdated();
      onSuccess();
      onOpenChange(false);
    } catch (err: any) {
      console.error(err);
      toast.error("Erro ao salvar transação: " + (err.message || ""));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={undefined}
        className="sm:max-w-[380px] w-[calc(100vw-2rem)] p-0 border-primary-foreground/[0.12] overflow-hidden rounded-3xl bg-charcoal shadow-2xl"
      >
        <div className="relative flex flex-col max-h-[85dvh] overflow-hidden">
          <DialogHeader className="shrink-0 relative px-5 pt-5 pb-3 border-b border-primary-foreground/[0.08]">
            <DialogTitle className="font-heading text-[17px] font-semibold text-primary-foreground">
              {tab === "entrada" ? "Registrar Entrada no Caixa" : "Registrar Saída / Gasto"}
            </DialogTitle>
          </DialogHeader>

        {/* Tabs */}
        <div className="shrink-0 px-5 pt-3.5">
          <div className="flex p-1 rounded-2xl bg-primary-foreground/[0.04] border border-primary-foreground/[0.08]">
            <button
              type="button"
              onClick={() => setTab("entrada")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-body text-[12px] font-semibold transition-all ${
                tab === "entrada" ? "bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm" : "text-primary-foreground/60 hover:text-primary-foreground"
              }`}
            >
              <ArrowUp className="w-3.5 h-3.5" /> Entrada
            </button>
            <button
              type="button"
              onClick={() => setTab("saida")}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl font-body text-[12px] font-semibold transition-all ${
                tab === "saida" ? "bg-rose/15 text-rose border border-rose/30 shadow-sm" : "text-primary-foreground/60 hover:text-primary-foreground"
              }`}
            >
              <ArrowDown className="w-3.5 h-3.5" /> Saída (Gasto)
            </button>
          </div>
        </div>

        {/* Form */}
        <div className="flex-1 min-h-0 px-5 py-3.5 space-y-2.5 overflow-y-auto scrollbar-hide">
          <div className="space-y-1">
            <label className="font-body text-[10.5px] font-medium text-primary-foreground/75">Valor (R$)</label>
            <div className="relative">
              <DollarSign className={`absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 ${tab === "entrada" ? "text-emerald-400" : "text-rose"}`} />
              <input
                type="text"
                inputMode="numeric"
                placeholder="0,00"
                value={valor}
                onChange={(e) => setValor(formatCurrencyMask(e.target.value))}
                className="w-full bg-[#262523] border border-primary-foreground/[0.14] rounded-xl py-2.5 pl-9 pr-3 text-primary-foreground font-heading text-[16px] font-semibold tabular-nums focus:outline-none focus:border-gold"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="font-body text-[10.5px] font-medium text-primary-foreground/75">
              {tab === "entrada" ? "Descrição da entrada" : "Nome do gasto"}
            </label>
            <div className="relative">
              <FileText className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-primary-foreground/45" />
              <input
                type="text"
                placeholder={tab === "entrada" ? "Ex: Atendimento avulso" : "Ex: Compra de tintas"}
                value={descricao}
                onChange={(e) => setDescricao(e.target.value)}
                className="w-full bg-[#262523] border border-primary-foreground/[0.14] rounded-xl py-2 pl-9 pr-3 text-primary-foreground font-body text-[13px] focus:outline-none focus:border-gold placeholder:text-primary-foreground/40"
              />
            </div>
          </div>

          <div className="space-y-1">
            <label className="font-body text-[10.5px] font-medium text-primary-foreground/75">Data</label>
            <input
              type="date"
              value={data}
              onChange={(e) => setData(e.target.value)}
              className="w-full appearance-none block max-w-full bg-[#262523] border border-primary-foreground/[0.14] rounded-xl py-2 px-3 text-primary-foreground font-body text-[13px] [color-scheme:dark] focus:outline-none focus:border-gold"
            />
          </div>

          {tab === "entrada" && (
            <div className="space-y-1.5">
              <label className="font-body text-[10.5px] font-medium text-primary-foreground/75">Como recebeu?</label>
              <div className="grid grid-cols-3 gap-1.5">
                {FORMAS_PAGAMENTO.map(f => (
                  <button
                    key={f.id}
                    type="button"
                    onClick={() => setFormaPagamento(f.id)}
                    className={`py-2 px-2 text-[11.5px] font-body rounded-xl border transition-all ${
                      formaPagamento === f.id
                        ? "bg-gold/20 border-gold/50 text-gold font-semibold"
                        : "bg-[#262523] border-primary-foreground/[0.1] text-primary-foreground/65 hover:text-primary-foreground"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {tab === "saida" && (
            <>
              <div className="space-y-1">
                <label className="font-body text-[10px] text-primary-foreground/75 uppercase tracking-wider">Esse gasto é:</label>
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setTipoGasto("estudio")}
                    className={`py-2 px-2 text-[11px] font-body rounded-xl border transition-all ${
                      tipoGasto === "estudio"
                        ? "bg-amber-500/15 border-amber-500/40 text-amber-300 font-semibold"
                        : "bg-primary-foreground/[0.02] border-primary-foreground/[0.06] text-primary-foreground/65"
                    }`}
                  >
                    Do Estúdio
                  </button>
                  <button
                    type="button"
                    onClick={() => setTipoGasto("pessoal")}
                    className={`py-2 px-2 text-[11px] font-body rounded-xl border transition-all ${
                      tipoGasto === "pessoal"
                        ? "bg-pink-500/15 border-pink-500/40 text-pink-300 font-semibold"
                        : "bg-primary-foreground/[0.02] border-primary-foreground/[0.06] text-primary-foreground/65"
                    }`}
                  >
                    Pessoal
                  </button>
                </div>
              </div>

              <div className="space-y-1">
                <label className="font-body text-[10px] text-primary-foreground/75 uppercase tracking-wider">Categoria</label>
                <input
                  type="text"
                  list="categorias-saida-list"
                  value={categoria}
                  onChange={(e) => setCategoria(e.target.value)}
                  placeholder="Selecione ou digite"
                  className="w-full bg-primary-foreground/[0.03] border border-primary-foreground/[0.08] rounded-xl py-1.5 px-2.5 text-primary-foreground font-body text-[13px] focus:outline-none focus:border-gold/30"
                />
                <datalist id="categorias-saida-list">
                  {CATEGORIAS_SAIDA.map(c => <option key={c} value={c}>{c}</option>)}
                </datalist>
              </div>
            </>
          )}
        </div>

        <div className="shrink-0 px-5 py-3.5 border-t border-primary-foreground/[0.08] bg-charcoal">
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className={`w-full py-2.5 rounded-xl font-body text-[12px] font-bold uppercase tracking-wider transition-all flex items-center justify-center gap-2 ${
              saving ? "opacity-50 cursor-not-allowed bg-primary-foreground/10 text-primary-foreground/50" 
                     : tab === "entrada" 
                        ? "bg-emerald-500 text-charcoal hover:bg-emerald-400" 
                        : "bg-rose text-white hover:brightness-110"
            }`}
          >
            {saving ? (
              "Salvando..."
            ) : (
              <>
                <Check className="w-3.5 h-3.5" /> {tab === "entrada" ? "Salvar Entrada" : "Salvar Saída"}
              </>
            )}
          </button>
        </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
