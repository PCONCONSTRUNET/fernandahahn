import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { Clock, Save, Lock, Unlock, Calendar, Copy, Check } from "lucide-react";
import { supabase, isSupabaseConfigured } from "@/integrations/supabase/client";

interface DayHour {
  id: string;
  day: number;
  open: boolean;
  start: string;
  end: string;
  persisted?: boolean;
}

interface BlockedSlot {
  id: string;
  data: string;
  horario: string;
  motivo: string;
}

const DAY_NAMES: Record<number, string> = {
  0: "Domingo",
  1: "Segunda-feira",
  2: "Terça-feira",
  3: "Quarta-feira",
  4: "Quinta-feira",
  5: "Sexta-feira",
  6: "Sábado",
};

// Ordem natural da semana comercial (Segunda a Domingo)
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const LOCAL_HOURS_KEY = "admin_horarios_preview";
const LOCAL_BLOCKS_KEY = "admin_horarios_bloqueios_preview";

function buildDefaultWeek(): DayHour[] {
  return DISPLAY_ORDER.map((day) => ({
    id: `default-${day}`,
    day,
    open: day !== 0,
    start: "09:00",
    end: day === 6 ? "17:00" : "19:00",
    persisted: false,
  }));
}

function mergeWithDefaultWeek(rows: any[]): DayHour[] {
  const byDay = new Map<number, DayHour>();
  for (const d of rows || []) {
    byDay.set(d.dia_semana, {
      id: d.id,
      day: d.dia_semana,
      open: Boolean(d.aberto),
      start: d.hora_inicio?.slice(0, 5) || "09:00",
      end: d.hora_fim?.slice(0, 5) || "19:00",
      persisted: true,
    });
  }
  return buildDefaultWeek().map((def) => byDay.get(def.day) || def);
}

function getLocalTodayISO(): string {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000)
    .toISOString()
    .split("T")[0];
}

/**
 * Tela simplificada de Horários de Funcionamento e Bloqueio de Folgas.
 */
const HorariosTab = () => {
  const [hours, setHours] = useState<DayHour[]>(buildDefaultWeek);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  const [blockDate, setBlockDate] = useState(getLocalTodayISO);
  const [blockedSlots, setBlockedSlots] = useState<BlockedSlot[]>([]);
  const [loadingBlocks, setLoadingBlocks] = useState(false);

  useEffect(() => {
    let active = true;
    const loadHours = async () => {
      if (!isSupabaseConfigured) {
        try {
          const cached = localStorage.getItem(LOCAL_HOURS_KEY);
          if (cached) {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && parsed.length > 0 && active) {
              setHours(parsed);
              setLoading(false);
              return;
            }
          }
        } catch {
          /* ignore */
        }
        if (active) {
          setHours(buildDefaultWeek());
          setLoading(false);
        }
        return;
      }

      try {
        const { data } = await supabase
          .from("horarios_funcionamento")
          .select("*")
          .order("dia_semana");
        if (active && data) {
          setHours(mergeWithDefaultWeek(data));
        }
      } catch (err) {
        console.error("Erro ao carregar horários:", err);
      } finally {
        if (active) setLoading(false);
      }
    };

    loadHours();
    return () => {
      active = false;
    };
  }, []);

  const loadBlocks = useCallback(async () => {
    setLoadingBlocks(true);
    try {
      if (!isSupabaseConfigured) {
        const raw = localStorage.getItem(LOCAL_BLOCKS_KEY);
        const all: BlockedSlot[] = raw ? JSON.parse(raw) : [];
        setBlockedSlots(all.filter((b) => b.data === blockDate));
        return;
      }
      const { data } = await supabase
        .from("horarios_bloqueados")
        .select("*")
        .eq("data", blockDate);
      setBlockedSlots(
        data?.map((d) => ({
          id: d.id,
          data: d.data,
          horario: d.horario,
          motivo: d.motivo || "",
        })) || []
      );
    } catch (err) {
      console.error("Erro ao carregar bloqueios:", err);
      setBlockedSlots([]);
    } finally {
      setLoadingBlocks(false);
    }
  }, [blockDate]);

  useEffect(() => {
    loadBlocks();
  }, [loadBlocks]);

  const toggleDay = (day: number) => {
    setHours((prev) => prev.map((h) => (h.day === day ? { ...h, open: !h.open } : h)));
  };

  const updateTime = (day: number, field: "start" | "end", val: string) => {
    setHours((prev) => prev.map((h) => (h.day === day ? { ...h, [field]: val } : h)));
  };

  const copyMondayToWeekdays = () => {
    const monday = hours.find((h) => h.day === 1);
    if (!monday) return;
    setHours((prev) =>
      prev.map((h) =>
        h.day >= 2 && h.day <= 5
          ? { ...h, open: monday.open, start: monday.start, end: monday.end }
          : h
      )
    );
    toast.success("Horário de segunda aplicado de terça a sexta");
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      if (!isSupabaseConfigured) {
        localStorage.setItem(LOCAL_HOURS_KEY, JSON.stringify(hours));
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        toast.success("Horários salvos!");
        return;
      }

      let hasError = false;
      for (const h of hours) {
        const start = h.start || "09:00";
        const end = h.end || "19:00";
        if (h.persisted) {
          const { error } = await supabase
            .from("horarios_funcionamento")
            .update({
              aberto: h.open,
              hora_inicio: start,
              hora_fim: end,
              updated_at: new Date().toISOString(),
            })
            .eq("id", h.id);
          if (error) {
            console.error("Erro ao salvar horário", h, error);
            hasError = true;
          }
        } else {
          const { data, error } = await supabase
            .from("horarios_funcionamento")
            .insert({
              dia_semana: h.day,
              aberto: h.open,
              hora_inicio: start,
              hora_fim: end,
            })
            .select()
            .single();
          if (error) {
            console.error("Erro ao criar horário", h, error);
            hasError = true;
          } else if (data) {
            setHours((prev) =>
              prev.map((item) =>
                item.day === h.day ? { ...item, id: data.id, persisted: true } : item
              )
            );
          }
        }
      }

      if (hasError) {
        toast.error("Erro ao salvar alguns horários.");
      } else {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
        toast.success("Horários salvos com sucesso!");
      }
    } finally {
      setSaving(false);
    }
  };

  const getBlockDateSlots = () => {
    const d = new Date(blockDate + "T12:00:00");
    const dayHours = hours.find((h) => h.day === d.getDay());
    if (!dayHours || !dayHours.open) return [];
    const result: string[] = [];
    const [oh, om] = dayHours.start.split(":").map(Number);
    const [ch, cm] = dayHours.end.split(":").map(Number);
    const startMin = (oh || 0) * 60 + (om || 0);
    const endMin = (ch || 0) * 60 + (cm || 0);
    for (let m = startMin; m < endMin; m += 30) {
      const hh = Math.floor(m / 60);
      const mm = m % 60;
      result.push(`${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`);
    }
    return result;
  };

  const persistLocalBlocks = (nextForDate: BlockedSlot[]) => {
    try {
      const raw = localStorage.getItem(LOCAL_BLOCKS_KEY);
      const all: BlockedSlot[] = raw ? JSON.parse(raw) : [];
      const others = all.filter((b) => b.data !== blockDate);
      localStorage.setItem(LOCAL_BLOCKS_KEY, JSON.stringify([...others, ...nextForDate]));
    } catch {
      /* ignore */
    }
  };

  const toggleBlock = async (horario: string) => {
    const existing = blockedSlots.find((b) => b.horario === horario);
    if (!isSupabaseConfigured) {
      const next = existing
        ? blockedSlots.filter((b) => b.horario !== horario)
        : [
            ...blockedSlots,
            {
              id: `local-${blockDate}-${horario}`,
              data: blockDate,
              horario,
              motivo: "",
            },
          ];
      setBlockedSlots(next);
      persistLocalBlocks(next);
      return;
    }

    if (existing) {
      await supabase.from("horarios_bloqueados").delete().eq("id", existing.id);
      setBlockedSlots((prev) => prev.filter((b) => b.id !== existing.id));
    } else {
      const { data } = await supabase
        .from("horarios_bloqueados")
        .insert({ data: blockDate, horario, motivo: "" })
        .select()
        .single();
      if (data) {
        setBlockedSlots((prev) => [
          ...prev,
          { id: data.id, data: data.data, horario: data.horario, motivo: data.motivo || "" },
        ]);
      }
    }
  };

  const blockAllDay = async () => {
    const slots = getBlockDateSlots();
    if (slots.length === 0) return;
    const unblockedSlots = slots.filter((s) => !blockedSlots.some((b) => b.horario === s));

    if (!isSupabaseConfigured) {
      const next: BlockedSlot[] =
        unblockedSlots.length === 0
          ? []
          : slots.map((s) => ({
              id: `local-${blockDate}-${s}`,
              data: blockDate,
              horario: s,
              motivo: "",
            }));
      setBlockedSlots(next);
      persistLocalBlocks(next);
      toast.success(next.length === 0 ? "Dia liberado!" : "Dia fechado para agendamentos!");
      return;
    }

    if (unblockedSlots.length === 0) {
      for (const b of blockedSlots) {
        await supabase.from("horarios_bloqueados").delete().eq("id", b.id);
      }
      setBlockedSlots([]);
      toast.success("Dia liberado!");
    } else {
      const created: BlockedSlot[] = [];
      for (const s of unblockedSlots) {
        const { data } = await supabase
          .from("horarios_bloqueados")
          .insert({ data: blockDate, horario: s, motivo: "" })
          .select()
          .single();
        if (data) {
          created.push({
            id: data.id,
            data: data.data,
            horario: data.horario,
            motivo: data.motivo || "",
          });
        }
      }
      setBlockedSlots((prev) => [...prev, ...created]);
      toast.success("Dia fechado para agendamentos!");
    }
  };

  const slots = getBlockDateSlots();
  const allBlocked = slots.length > 0 && slots.every((s) => blockedSlots.some((b) => b.horario === s));
  const openDaysCount = hours.filter((h) => h.open).length;
  const selectedDayName = DAY_NAMES[new Date(blockDate + "T12:00:00").getDay()] || "";

  if (loading) {
    return (
      <p className="font-body text-[13px] text-primary-foreground/40 text-center py-8">
        Carregando horários...
      </p>
    );
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Cabeçalho simples */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-xl font-semibold text-primary-foreground">
              Horários
            </h2>
            <span className="px-2 py-0.5 rounded-full bg-gold/15 border border-gold/25 font-body text-[11px] font-semibold text-gold">
              {openDaysCount} {openDaysCount === 1 ? "dia aberto" : "dias abertos"}
            </span>
          </div>
          <p className="font-body text-[11.5px] text-primary-foreground/55 mt-0.5">
            Defina em quais dias e horários o estúdio aceita agendamentos
          </p>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-br from-gold to-nude text-charcoal font-body text-[12.5px] font-bold shadow-[0_6px_20px_-6px_hsl(23_52%_52%/0.5)] hover:brightness-105 active:scale-[0.98] transition-all disabled:opacity-50"
        >
          {saved ? <Check className="w-4 h-4" /> : <Save className="w-4 h-4" />}
          {saving ? "Salvando..." : saved ? "Salvo!" : "Salvar Horários"}
        </button>
      </div>

      {/* Dias da semana */}
      <div className="rounded-2xl border border-primary-foreground/[0.08] bg-[#1b1a1b] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-gold" />
            <h3 className="font-body text-[13px] font-semibold text-primary-foreground">
              Funcionamento da Semana
            </h3>
          </div>
          <button
            type="button"
            onClick={copyMondayToWeekdays}
            className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-primary-foreground/[0.05] border border-primary-foreground/[0.08] text-primary-foreground/75 font-body text-[11px] hover:border-gold/30 hover:text-gold transition-all"
          >
            <Copy className="w-3 h-3" />
            Repetir Segunda em Ter–Sex
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
          {hours.map((h) => (
            <div
              key={h.day}
              className={`rounded-xl border p-3 transition-all ${
                h.open
                  ? "bg-primary-foreground/[0.03] border-primary-foreground/[0.1]"
                  : "bg-primary-foreground/[0.015] border-primary-foreground/[0.05] opacity-75"
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="font-body text-[13.5px] font-semibold text-primary-foreground">
                    {DAY_NAMES[h.day]}
                  </span>
                  <span
                    className={`px-2 py-0.5 rounded-full font-body text-[10px] font-medium ${
                      h.open
                        ? "bg-emerald-500/15 text-emerald-300"
                        : "bg-primary-foreground/[0.06] text-primary-foreground/45"
                    }`}
                  >
                    {h.open ? "Aberto" : "Fechado"}
                  </span>
                </div>

                <button
                  type="button"
                  aria-label={`Alternar ${DAY_NAMES[h.day]}`}
                  onClick={() => toggleDay(h.day)}
                  className={`shrink-0 w-10 h-6 rounded-full relative transition-all duration-200 ${
                    h.open ? "bg-gold" : "bg-primary-foreground/15"
                  }`}
                >
                  <div
                    className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${
                      h.open ? "left-4" : "left-0.5"
                    }`}
                  />
                </button>
              </div>

              {h.open && (
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mt-2.5">
                  <input
                    type="time"
                    value={h.start}
                    onChange={(e) => updateTime(h.day, "start", e.target.value)}
                    aria-label={`Abertura ${DAY_NAMES[h.day]}`}
                    className="w-full min-w-0 px-3 py-2 rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.09] text-primary-foreground font-body text-[13px] focus:outline-none focus:border-gold/45 [color-scheme:dark] tabular-nums"
                  />
                  <span className="font-body text-[11.5px] text-primary-foreground/45">até</span>
                  <input
                    type="time"
                    value={h.end}
                    onChange={(e) => updateTime(h.day, "end", e.target.value)}
                    aria-label={`Fechamento ${DAY_NAMES[h.day]}`}
                    className="w-full min-w-0 px-3 py-2 rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.09] text-primary-foreground font-body text-[13px] focus:outline-none focus:border-gold/45 [color-scheme:dark] tabular-nums"
                  />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Folgas e Bloqueios pontuais */}
      <div className="rounded-2xl border border-primary-foreground/[0.08] bg-[#1b1a1b] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-body text-[13px] font-semibold text-primary-foreground flex items-center gap-2">
              <Calendar className="w-4 h-4 text-gold" />
              Folgas e Horários Bloqueados
            </h3>
            <p className="font-body text-[11px] text-primary-foreground/50 mt-0.5">
              Escolha um dia para fechar a agenda inteira ou clicar só nos horários que não vai atender
            </p>
          </div>
          {blockedSlots.length > 0 && (
            <span className="px-2.5 py-0.5 rounded-full bg-rose/15 border border-rose/25 font-body text-[10.5px] font-medium text-rose">
              {blockedSlots.length} bloqueado{blockedSlots.length > 1 ? "s" : ""}
            </span>
          )}
        </div>

        <div className="flex flex-col sm:flex-row gap-2">
          <input
            type="date"
            value={blockDate}
            onChange={(e) => setBlockDate(e.target.value)}
            aria-label="Data para bloquear horários"
            className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.09] text-primary-foreground font-body text-[13px] focus:outline-none focus:border-gold/45 [color-scheme:dark]"
          />
          {slots.length > 0 && (
            <button
              type="button"
              onClick={blockAllDay}
              className={`inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl font-body text-[12px] font-semibold transition-all whitespace-nowrap ${
                allBlocked
                  ? "bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 hover:bg-emerald-500/25"
                  : "bg-rose/15 border border-rose/25 text-rose hover:bg-rose/25"
              }`}
            >
              {allBlocked ? <Unlock className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
              {allBlocked ? "Liberar dia inteiro" : "Fechar o dia todo"}
            </button>
          )}
        </div>

        {loadingBlocks ? (
          <p className="font-body text-[12px] text-primary-foreground/40 text-center py-4">
            Carregando horários do dia...
          </p>
        ) : slots.length === 0 ? (
          <div className="rounded-xl border border-dashed border-primary-foreground/[0.08] py-4 px-3 text-center">
            <p className="font-body text-[12px] text-primary-foreground/50">
              {selectedDayName} está marcado como fechado acima — ative o dia caso queira liberar horários.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-2">
            {slots.map((slot) => {
              const isBlocked = blockedSlots.some((b) => b.horario === slot);
              return (
                <button
                  key={slot}
                  type="button"
                  onClick={() => toggleBlock(slot)}
                  className={`py-2.5 px-2 rounded-xl font-body text-[12.5px] font-medium transition-all border flex items-center justify-center gap-1 ${
                    isBlocked
                      ? "bg-rose/15 text-rose border-rose/30 line-through"
                      : "bg-primary-foreground/[0.03] text-primary-foreground/80 border-primary-foreground/[0.08] hover:border-gold/35 hover:text-gold"
                  }`}
                >
                  {isBlocked && <Lock className="w-3 h-3 shrink-0" />}
                  <span className="tabular-nums">{slot}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <p className="font-body text-[11px] text-primary-foreground/45 text-center">
        Alterações nos horários valem apenas para novos agendamentos — horários já marcados permanecem intactos.
      </p>
    </div>
  );
};

export default HorariosTab;
