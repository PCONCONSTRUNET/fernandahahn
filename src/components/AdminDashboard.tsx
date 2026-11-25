import { useMemo, useState, useEffect } from "react";
import {
  Calendar,
  Clock,
  Bell,
  ArrowUpRight,
  Plus,
  Wallet,
  CreditCard,
  Receipt,
  CheckCircle2,
  User,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import PushToggle from "@/components/PushToggle";

interface Agendamento {
  id: string;
  servico: string;
  variacao: string | null;
  data_agendamento: string;
  horario: string;
  valor: number;
  valor_pago: number | null;
  valor_desconto_credito?: number | null;
  status: string;
  created_at: string;
  user_id: string;
  duracao_minutos: number;
  foi_estendido?: boolean;
  cliente_nome?: string | null;
}

interface Props {
  agendamentos: Agendamento[];
  getClientName: (userId: string, clienteNome?: string | null) => string;
  notificationsEnabled: boolean;
  toggleNotifications: (val: boolean) => void;
  statusBadge: (s: string) => JSX.Element;
  onGoToAgenda: () => void;
  onNewBooking?: () => void;
  onNavigateTab?: (tab: "caixa" | "pagamentos" | "gastos") => void;
}

const getDateKey = (d: Date) =>
  new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0];

const formatCurrency = (v: number) =>
  `R$ ${v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const formatEndTime = (horario: string, duracaoMin: number) => {
  const [h, m] = horario.split(":").map(Number);
  const total = h * 60 + m + (duracaoMin || 60);
  const endH = Math.floor(total / 60) % 24;
  const endM = total % 60;
  return `${String(endH).padStart(2, "0")}:${String(endM).padStart(2, "0")}`;
};

const getPaymentPill = (a: Agendamento) => {
  const total = Number(a.valor || 0);
  const pago = Number(a.valor_pago || 0) + Number(a.valor_desconto_credito || 0);
  if (total > 0 && pago >= total - 0.01) {
    return { label: "Pago", className: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" };
  }
  if (pago > 0) {
    return { label: `Sinal ${formatCurrency(pago)}`, className: "text-amber-300 bg-amber-500/10 border-amber-500/20" };
  }
  return { label: "A receber", className: "text-primary-foreground/60 bg-primary-foreground/[0.04] border-primary-foreground/[0.08]" };
};

const AdminDashboard = ({
  agendamentos,
  getClientName,
  notificationsEnabled,
  toggleNotifications,
  statusBadge,
  onGoToAgenda,
  onNewBooking,
  onNavigateTab,
}: Props) => {
  const getBrasiliaTime = () => {
    const utc = new Date();
    return new Date(utc.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  };

  const [now, setNow] = useState(getBrasiliaTime);

  useEffect(() => {
    const interval = setInterval(() => setNow(getBrasiliaTime()), 30000);
    return () => clearInterval(interval);
  }, []);

  const today = getDateKey(now);
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  const todayItems = useMemo(
    () =>
      agendamentos
        .filter((a) => a.data_agendamento === today && a.status !== "cancelado")
        .sort((a, b) => a.horario.localeCompare(b.horario)),
    [agendamentos, today]
  );

  const upcomingItems = useMemo(
    () =>
      todayItems.filter((a) => {
        if (a.status === "concluido" || a.status === "falta") return false;
        const [h, m] = a.horario.split(":").map(Number);
        const endMin = h * 60 + m + (a.duracao_minutos || 60);
        return endMin >= currentMinutes;
      }),
    [todayItems, currentMinutes]
  );

  const nextAppointment = upcomingItems[0] || null;

  const statsHoje = useMemo(() => {
    const ativos = todayItems.filter((a) => a.status !== "falta");
    const feitos = todayItems.filter((a) => a.status === "concluido").length;
    const restantes = todayItems.filter((a) => a.status === "confirmado").length;
    const previsto = ativos.reduce((s, a) => s + Number(a.valor || 0), 0);
    const recebido = ativos.reduce((s, a) => s + Number(a.valor_pago || 0), 0);
    const aReceber = Math.max(0, previsto - recebido);

    return {
      total: todayItems.length,
      feitos,
      restantes,
      previsto,
      recebido,
      aReceber,
    };
  }, [todayItems]);

  const weeklyData = useMemo(() => {
    const days: { date: string; label: string; receita: number; atendimentos: number }[] = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(now);
      d.setDate(d.getDate() - i);
      const key = getDateKey(d);
      const dayItems = agendamentos.filter(
        (a) => a.data_agendamento === key && a.status !== "cancelado" && a.status !== "falta"
      );
      days.push({
        date: key,
        label: d.toLocaleDateString("pt-BR", { weekday: "short" }).replace(".", ""),
        receita: dayItems.reduce((s, a) => s + Number(a.valor_pago || 0), 0),
        atendimentos: dayItems.length,
      });
    }
    return days;
  }, [agendamentos, now]);

  const totalSemana = useMemo(
    () => weeklyData.reduce((s, d) => s + d.receita, 0),
    [weeklyData]
  );

  const atendimentosSemana = useMemo(
    () => weeklyData.reduce((s, d) => s + d.atendimentos, 0),
    [weeklyData]
  );

  const topServices = useMemo(() => {
    const thisMonth = today.slice(0, 7);
    const monthItems = agendamentos.filter(
      (a) => a.data_agendamento.startsWith(thisMonth) && a.status !== "cancelado" && a.status !== "falta"
    );
    const counts = new Map<string, { count: number; total: number }>();
    monthItems.forEach((a) => {
      if (!a.servico) return;
      const cur = counts.get(a.servico) || { count: 0, total: 0 };
      cur.count += 1;
      cur.total += Number(a.valor || 0);
      counts.set(a.servico, cur);
    });
    return Array.from(counts.entries())
      .map(([name, info]) => ({ name, ...info }))
      .sort((a, b) => b.count - a.count || b.total - a.total)
      .slice(0, 5);
  }, [agendamentos, today]);

  const greeting =
    now.getHours() < 12 ? "Bom dia" : now.getHours() < 18 ? "Boa tarde" : "Boa noite";

  const dateFormatted = now.toLocaleDateString("pt-BR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });

  const timeFormatted = now.toLocaleTimeString("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <div className="space-y-6">
      {/* Cabeçalho editorial + ações rápidas */}
      <div className="rounded-2xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.025] p-5 sm:p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="font-body text-[11px] uppercase tracking-[0.18em] text-gold/80 font-medium capitalize">
              {dateFormatted} · {timeFormatted}
            </p>
            <h2 className="font-heading text-2xl sm:text-3xl font-semibold text-primary-foreground tracking-tight mt-1">
              {greeting}, Fernanda
            </h2>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {onNewBooking && (
              <button
                type="button"
                onClick={onNewBooking}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-gold text-charcoal font-body text-[12px] font-semibold hover:brightness-105 transition-all"
              >
                <Plus className="w-3.5 h-3.5" /> Novo atendimento
              </button>
            )}
            <button
              type="button"
              onClick={onGoToAgenda}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl border border-primary-foreground/[0.1] bg-primary-foreground/[0.03] text-primary-foreground/85 hover:text-primary-foreground hover:border-gold/30 font-body text-[12px] font-medium transition-all"
            >
              <Calendar className="w-3.5 h-3.5 text-gold/80" /> Ver agenda
            </button>
          </div>
        </div>

        {/* Atalhos financeiros rápidos */}
        {onNavigateTab && (
          <div className="flex flex-wrap gap-2 pt-4 border-t border-primary-foreground/[0.06]">
            <button
              type="button"
              onClick={() => onNavigateTab("caixa")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-foreground/[0.03] hover:bg-primary-foreground/[0.06] border border-primary-foreground/[0.06] text-primary-foreground/75 hover:text-primary-foreground font-body text-[11px] transition-colors"
            >
              <Wallet className="w-3.5 h-3.5 text-teal-400" /> Abrir Caixa
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab("pagamentos")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-foreground/[0.03] hover:bg-primary-foreground/[0.06] border border-primary-foreground/[0.06] text-primary-foreground/75 hover:text-primary-foreground font-body text-[11px] transition-colors"
            >
              <CreditCard className="w-3.5 h-3.5 text-blue-400" /> Pagamentos
            </button>
            <button
              type="button"
              onClick={() => onNavigateTab("gastos")}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-primary-foreground/[0.03] hover:bg-primary-foreground/[0.06] border border-primary-foreground/[0.06] text-primary-foreground/75 hover:text-primary-foreground font-body text-[11px] transition-colors"
            >
              <Receipt className="w-3.5 h-3.5 text-rose" /> Registrar Gasto
            </button>
          </div>
        )}
      </div>

      {/* 4 números diretos do dia e semana */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="rounded-2xl border border-primary-foreground/[0.07] bg-primary-foreground/[0.02] p-4">
          <p className="font-body text-[11px] text-primary-foreground/55">Agenda de hoje</p>
          <p className="font-heading text-2xl font-semibold text-primary-foreground tabular-nums mt-1">
            {statsHoje.total} {statsHoje.total === 1 ? "cliente" : "clientes"}
          </p>
          <p className="font-body text-[11px] text-primary-foreground/50 mt-1">
            {statsHoje.feitos} concluído(s) · {statsHoje.restantes} restante(s)
          </p>
        </div>

        <div className="rounded-2xl border border-primary-foreground/[0.07] bg-primary-foreground/[0.02] p-4">
          <p className="font-body text-[11px] text-primary-foreground/55">Recebido hoje</p>
          <p className="font-heading text-2xl font-semibold text-emerald-400 tabular-nums mt-1">
            {formatCurrency(statsHoje.recebido)}
          </p>
          <p className="font-body text-[11px] text-primary-foreground/50 mt-1">
            de {formatCurrency(statsHoje.previsto)} previstos
          </p>
        </div>

        <div className="rounded-2xl border border-primary-foreground/[0.07] bg-primary-foreground/[0.02] p-4">
          <p className="font-body text-[11px] text-primary-foreground/55">A receber hoje</p>
          <p
            className={`font-heading text-2xl font-semibold tabular-nums mt-1 ${
              statsHoje.aReceber > 0 ? "text-amber-300" : "text-primary-foreground/70"
            }`}
          >
            {formatCurrency(statsHoje.aReceber)}
          </p>
          <p className="font-body text-[11px] text-primary-foreground/50 mt-1">
            {statsHoje.aReceber > 0 ? "sinais / pendentes do dia" : "tudo quitado hoje"}
          </p>
        </div>

        <div className="rounded-2xl border border-primary-foreground/[0.07] bg-primary-foreground/[0.02] p-4">
          <p className="font-body text-[11px] text-primary-foreground/55">Últimos 7 dias</p>
          <p className="font-heading text-2xl font-semibold text-gold tabular-nums mt-1">
            {formatCurrency(totalSemana)}
          </p>
          <p className="font-body text-[11px] text-primary-foreground/50 mt-1">
            {atendimentosSemana} {atendimentosSemana === 1 ? "atendimento" : "atendimentos"}
          </p>
        </div>
      </div>

      {/* Destaque único do próximo atendimento (sem repetir lista) */}
      {nextAppointment && (() => {
        const pay = getPaymentPill(nextAppointment);
        const endTime = formatEndTime(nextAppointment.horario, nextAppointment.duracao_minutos);
        const [h, m] = nextAppointment.horario.split(":").map(Number);
        const inProgress = currentMinutes >= h * 60 + m;

        return (
          <div className="rounded-2xl border border-gold/25 bg-gold/[0.04] p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-start gap-3.5 min-w-0">
              <div className="w-11 h-11 rounded-xl bg-gold/15 border border-gold/25 flex items-center justify-center shrink-0">
                <User className="w-5 h-5 text-gold" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-body text-[10px] font-semibold uppercase tracking-[0.14em] text-gold">
                    {inProgress ? "Em atendimento agora" : "Próximo horário"}
                  </span>
                  <span className={`px-2 py-0.5 rounded-full border font-body text-[10px] font-medium ${pay.className}`}>
                    {pay.label}
                  </span>
                </div>
                <p className="font-heading text-lg font-semibold text-primary-foreground truncate mt-0.5">
                  {getClientName(nextAppointment.user_id, nextAppointment.cliente_nome)}
                </p>
                <p className="font-body text-[12.5px] text-primary-foreground/70 truncate">
                  {nextAppointment.servico}
                  {nextAppointment.variacao ? ` — ${nextAppointment.variacao}` : ""}
                </p>
              </div>
            </div>

            <div className="flex sm:flex-col items-center sm:items-end justify-between gap-2 shrink-0 pt-3 sm:pt-0 border-t sm:border-t-0 border-primary-foreground/[0.06]">
              <p className="font-heading text-[15px] font-semibold text-gold tabular-nums">
                {nextAppointment.horario} – {endTime}
              </p>
              <p className="font-body text-[13px] font-medium text-primary-foreground/85 tabular-nums">
                {formatCurrency(Number(nextAppointment.valor || 0))}
              </p>
            </div>
          </div>
        );
      })()}

      {/* Agenda do dia — lista única e limpa */}
      <div className="rounded-2xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.02] overflow-hidden">
        <div className="px-5 py-4 border-b border-primary-foreground/[0.06] flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gold/80" />
            <h3 className="font-heading text-[15px] font-semibold text-primary-foreground">
              Horários de hoje
            </h3>
          </div>
          <button
            type="button"
            onClick={onGoToAgenda}
            className="inline-flex items-center gap-1 font-body text-[12px] text-gold hover:underline"
          >
            Abrir agenda <ArrowUpRight className="w-3.5 h-3.5" />
          </button>
        </div>

        {todayItems.length === 0 ? (
          <div className="py-10 px-5 text-center space-y-2">
            <Calendar className="w-7 h-7 text-primary-foreground/25 mx-auto" />
            <p className="font-body text-[13px] text-primary-foreground/65">
              Nenhum atendimento marcado para hoje.
            </p>
            {onNewBooking && (
              <button
                type="button"
                onClick={onNewBooking}
                className="mt-1 inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-gold/30 text-gold font-body text-[12px] hover:bg-gold/10 transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Agendar cliente
              </button>
            )}
          </div>
        ) : (
          <div className="divide-y divide-primary-foreground/[0.06]">
            {todayItems.map((a) => {
              const [h, m] = a.horario.split(":").map(Number);
              const startMin = h * 60 + m;
              const endMin = startMin + (a.duracao_minutos || 60);
              const isCurrent = currentMinutes >= startMin && currentMinutes < endMin && a.status === "confirmado";
              const isDone = a.status === "concluido" || currentMinutes > endMin;
              const pay = getPaymentPill(a);

              return (
                <div
                  key={a.id}
                  className={`px-5 py-3.5 flex items-center justify-between gap-3 transition-colors ${
                    isCurrent
                      ? "bg-gold/[0.05] border-l-2 border-l-gold"
                      : isDone
                      ? "opacity-65 hover:opacity-100"
                      : "hover:bg-primary-foreground/[0.02]"
                  }`}
                >
                  <div className="flex items-center gap-3.5 min-w-0">
                    <div className="w-14 shrink-0">
                      <p className={`font-heading text-[14px] font-semibold tabular-nums ${isCurrent ? "text-gold" : "text-primary-foreground"}`}>
                        {a.horario}
                      </p>
                      <p className="font-body text-[10px] text-primary-foreground/45 tabular-nums">
                        {a.duracao_minutos || 60} min
                      </p>
                    </div>

                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-body text-[13.5px] font-semibold text-primary-foreground truncate">
                          {getClientName(a.user_id, a.cliente_nome)}
                        </p>
                        {a.status === "concluido" && (
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        )}
                      </div>
                      <p className="font-body text-[11.5px] text-primary-foreground/60 truncate">
                        {a.servico}
                        {a.variacao ? ` · ${a.variacao}` : ""}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2.5 shrink-0">
                    <div className="text-right hidden sm:block">
                      <p className="font-heading text-[13px] font-semibold text-primary-foreground tabular-nums">
                        {formatCurrency(Number(a.valor || 0))}
                      </p>
                      <p className="font-body text-[10px] text-primary-foreground/50">{pay.label}</p>
                    </div>
                    <div className="scale-90 origin-right">{statusBadge(a.status)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Semana + Serviços mais procurados */}
      <div className="grid gap-4 lg:grid-cols-2">
        {/* Receita dos últimos 7 dias */}
        <div className="rounded-2xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.02] p-5 space-y-4">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <p className="font-body text-[11px] uppercase tracking-[0.14em] text-primary-foreground/55">
                Entradas dos últimos 7 dias
              </p>
              <p className="font-heading text-xl font-semibold text-primary-foreground tabular-nums mt-0.5">
                {formatCurrency(totalSemana)}
              </p>
            </div>
            <span className="font-body text-[11px] text-primary-foreground/50">
              {atendimentosSemana} atend.
            </span>
          </div>

          {totalSemana === 0 ? (
            <div className="h-[170px] flex items-center justify-center rounded-xl border border-dashed border-primary-foreground/[0.08]">
              <p className="font-body text-[12px] text-primary-foreground/45">
                Sem entradas registradas nos últimos 7 dias
              </p>
            </div>
          ) : (
            <div className="h-[170px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={weeklyData} margin={{ top: 6, right: 4, left: -18, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsla(0 0% 100% / 0.05)" vertical={false} />
                  <XAxis
                    dataKey="label"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: "hsla(0 0% 100% / 0.5)" }}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 10, fill: "hsla(0 0% 100% / 0.4)" }}
                    tickFormatter={(v) => (v >= 1000 ? `${(v / 1000).toFixed(1)}k` : `${v}`)}
                  />
                  <Tooltip
                    cursor={{ fill: "hsla(0 0% 100% / 0.04)" }}
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0].payload;
                      return (
                        <div className="rounded-xl border border-primary-foreground/15 bg-charcoal px-3 py-2 shadow-lg text-[11px] font-body">
                          <p className="font-semibold text-primary-foreground capitalize">{row.label}</p>
                          <p className="text-gold">{formatCurrency(row.receita)}</p>
                          <p className="text-primary-foreground/55">{row.atendimentos} atendimento(s)</p>
                        </div>
                      );
                    }}
                  />
                  <Bar dataKey="receita" fill="#c99b68" radius={[6, 6, 0, 0]} maxBarSize={36} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>

        {/* Serviços mais realizados no mês */}
        <div className="rounded-2xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.02] p-5 space-y-4">
          <div className="flex items-baseline justify-between gap-2">
            <div>
              <p className="font-body text-[11px] uppercase tracking-[0.14em] text-primary-foreground/55">
                Mais procurados no mês
              </p>
              <p className="font-heading text-xl font-semibold text-primary-foreground mt-0.5">
                Top serviços
              </p>
            </div>
            <span className="font-body text-[11px] text-primary-foreground/50 capitalize">
              {now.toLocaleDateString("pt-BR", { month: "long" })}
            </span>
          </div>

          {topServices.length === 0 ? (
            <div className="h-[170px] flex items-center justify-center rounded-xl border border-dashed border-primary-foreground/[0.08]">
              <p className="font-body text-[12px] text-primary-foreground/45">
                Ainda sem agendamentos neste mês
              </p>
            </div>
          ) : (
            <div className="space-y-3 pt-1">
              {topServices.map((item) => {
                const maxCount = Math.max(1, topServices[0].count);
                const pct = Math.round((item.count / maxCount) * 100);
                return (
                  <div key={item.name} className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-[12px] font-body">
                      <span className="text-primary-foreground/90 font-medium truncate">
                        {item.name}
                      </span>
                      <span className="text-primary-foreground/60 tabular-nums shrink-0">
                        {item.count}× · {formatCurrency(item.total)}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-primary-foreground/[0.06] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gold/80 transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Notificações — faixa simples e discreta */}
      <div className="rounded-2xl border border-primary-foreground/[0.08] bg-primary-foreground/[0.02] p-4 sm:p-5 space-y-3">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary-foreground/[0.05] flex items-center justify-center">
              <Bell className="w-4 h-4 text-gold/80" />
            </div>
            <div>
              <p className="font-body text-[13px] font-medium text-primary-foreground">
                Alertas na tela do painel
              </p>
              <p className="font-body text-[11px] text-primary-foreground/50">
                Mostra aviso sonoro e visual quando entra um novo agendamento
              </p>
            </div>
          </div>
          <Switch checked={notificationsEnabled} onCheckedChange={toggleNotifications} />
        </div>

        <div className="pt-3 border-t border-primary-foreground/[0.06] flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <PushToggle role="admin" variant="default" showTestButton />
        </div>
      </div>
    </div>
  );
};

export default AdminDashboard;
