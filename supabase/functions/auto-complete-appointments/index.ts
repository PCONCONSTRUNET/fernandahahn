import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-connection-encrypted, x-supabase-client-platform, x-supabase-api-version",
};

const SITE_URL = Deno.env.get("PUBLIC_SITE_URL") || "https://fernandahahn.vercel.app";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const now = new Date();
    const brasiliaOffset = -3 * 60;
    const brasiliaTime = new Date(now.getTime() + (brasiliaOffset + now.getTimezoneOffset()) * 60000);

    const todayStr = brasiliaTime.toISOString().split("T")[0];
    const currentHour = brasiliaTime.getHours();
    const currentMinute = brasiliaTime.getMinutes();
    const currentTotalMinutes = currentHour * 60 + currentMinute;

    const { data: agendamentos, error } = await supabase
      .from("agendamentos")
      .select("id, data_agendamento, horario, duracao_minutos, servico, cliente_nome, user_id")
      .eq("status", "confirmado")
      .lte("data_agendamento", todayStr);

    if (error) throw error;

    const toComplete: typeof agendamentos = [];

    for (const a of agendamentos || []) {
      const [h, m] = a.horario.split(":").map(Number);
      const endMinutes = h * 60 + m + (a.duracao_minutos || 60);

      if (a.data_agendamento < todayStr) {
        toComplete.push(a);
      } else if (a.data_agendamento === todayStr && currentTotalMinutes >= endMinutes) {
        toComplete.push(a);
      }
    }

    if (toComplete.length > 0) {
      const ids = toComplete.map((a) => a.id);
      const { error: updateError } = await supabase
        .from("agendamentos")
        .update({ status: "concluido" })
        .in("id", ids);

      if (updateError) throw updateError;

      // Dispara push de avaliação pós-atendimento para clientes com conta
      for (const a of toComplete) {
        if (!a.user_id) continue;
        try {
          await supabase.functions.invoke("send-push", {
            body: {
              role: "cliente",
              user_id: a.user_id,
              title: "⭐ Como foi seu atendimento?",
              message: `Obrigado pela visita${a.cliente_nome ? `, ${a.cliente_nome}` : ""}! Toque para avaliar seu ${a.servico || "atendimento"}.`,
              url: `${SITE_URL}/avaliar`,
            },
          });
        } catch (e) {
          console.warn("[auto-complete] send-push falhou:", e);
        }
      }
    }

    return new Response(
      JSON.stringify({ completed: toComplete.length }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 200 }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({ error: (err as Error).message }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" }, status: 500 }
    );
  }
});
