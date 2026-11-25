// Envia lembretes pre-atendimento (X horas antes) via Push Notification (OneSignal).
// - Le configuracoes_lembretes WHERE tipo='lembrete' AND ativo=true
// - Busca agendamentos confirmados na janela [horas_antes - 30min, horas_antes + 30min]
// - Envia push via send-push e marca o agendamento em lembretes_enviados para idempotencia.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const fallbackTemplate =
  "Lembrete: seu atendimento com Fernanda Hahn é em {data} às {horario}.";

const formatDate = (iso: string) => {
  try {
    const [y, m, d] = iso.split("-");
    return `${d}/${m}/${y}`;
  } catch {
    return iso;
  }
};

const interpolate = (
  template: string,
  p: { nome: string; data: string; horario: string; servico?: string; valor?: number },
) => {
  const valorStr =
    typeof p.valor === "number"
      ? p.valor.toLocaleString("pt-BR", { style: "currency", currency: "BRL" })
      : "";
  const map: Record<string, string> = {
    nome: p.nome || "cliente",
    cliente: p.nome || "cliente",
    nome_do_cliente: p.nome || "cliente",
    data: formatDate(p.data),
    data_do_agendamento: formatDate(p.data),
    horario: p.horario,
    hora: p.horario,
    tempo: p.horario,
    servico: p.servico || "",
    valor: valorStr,
  };
  let out = template.replace(/\{([a-zA-Z_]+)\}/g, (_, k) => map[k.toLowerCase()] ?? `{${k}}`);
  out = out.replace(/\[([a-zA-Z_]+)\]/g, (_, k) => map[k.toLowerCase()] ?? `[${k}]`);
  return out;
};

const nowBrasilia = () => {
  const now = new Date();
  return new Date(now.getTime() + (-3 * 60 + now.getTimezoneOffset()) * 60000);
};

const parseBrasilia = (data: string, horario: string): Date => {
  const [y, mo, d] = data.split("-").map(Number);
  const [h, mi] = horario.split(":").map(Number);
  return new Date(Date.UTC(y, mo - 1, d, h + 3, mi));
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    const { data: cfg } = await supabase
      .from("configuracoes_lembretes")
      .select("ativo, mensagem, horas_antes")
      .eq("tipo", "lembrete")
      .maybeSingle();

    if (!cfg || cfg.ativo === false) {
      return new Response(
        JSON.stringify({ skipped: true, reason: "lembrete desativado ou nao configurado" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    const horasAntes = cfg.horas_antes ?? 24;
    const template = (cfg.mensagem && cfg.mensagem.trim()) || fallbackTemplate;

    const agora = nowBrasilia();
    const MARGEM_MS = 30 * 60 * 1000;
    const alvoMs = horasAntes * 60 * 60 * 1000;
    const limiteMin = new Date(agora.getTime() + alvoMs - MARGEM_MS);
    const limiteMax = new Date(agora.getTime() + alvoMs + MARGEM_MS);

    const datesToCheck = new Set<string>([
      limiteMin.toISOString().split("T")[0],
      limiteMax.toISOString().split("T")[0],
    ]);

    const inWindow = (data: string, horario: string) => {
      const dt = parseBrasilia(data, horario);
      return dt >= limiteMin && dt <= limiteMax;
    };

    const { data: ags, error } = await supabase
      .from("agendamentos")
      .select("id, user_id, cliente_nome, data_agendamento, horario, servico, valor, status")
      .eq("status", "confirmado")
      .in("data_agendamento", Array.from(datesToCheck));

    if (error) throw error;

    const elegiveis = (ags || []).filter((a) => a.user_id && inWindow(a.data_agendamento, a.horario));

    if (elegiveis.length === 0) {
      return new Response(
        JSON.stringify({ enviados: 0, motivo: "nenhum agendamento na janela" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
      );
    }

    const ids = elegiveis.map((a) => a.id);
    const { data: jaEnviados } = await supabase
      .from("lembretes_enviados")
      .select("agendamento_id")
      .in("agendamento_id", ids);
    const enviadosSet = new Set((jaEnviados || []).map((r) => r.agendamento_id));

    const pendentes = elegiveis.filter((a) => !enviadosSet.has(a.id));

    let enviados = 0;
    const erros: string[] = [];

    for (const a of pendentes) {
      const mensagem = interpolate(template, {
        nome: a.cliente_nome || "cliente",
        data: a.data_agendamento,
        horario: a.horario,
        servico: a.servico || undefined,
        valor: typeof a.valor === "number" ? a.valor : undefined,
      });

      try {
        const { error: flagError } = await supabase
          .from("lembretes_enviados")
          .insert({ agendamento_id: a.id });

        if (flagError) continue;

        const { error: pushErr } = await supabase.functions.invoke("send-push", {
          body: {
            role: "cliente",
            user_id: a.user_id,
            title: "⏰ Lembrete de atendimento",
            message: mensagem,
            url: "/",
          },
        });

        if (pushErr) {
          await supabase
            .from("lembretes_enviados")
            .delete()
            .eq("agendamento_id", a.id);
          erros.push(`${a.id}: ${pushErr.message}`);
          continue;
        }

        enviados += 1;
      } catch (e) {
        await supabase
          .from("lembretes_enviados")
          .delete()
          .eq("agendamento_id", a.id);
        erros.push(`${a.id}: ${(e as Error).message}`);
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        elegiveis: elegiveis.length,
        ja_enviados: elegiveis.length - pendentes.length,
        enviados,
        erros,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 },
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 },
    );
  }
});
