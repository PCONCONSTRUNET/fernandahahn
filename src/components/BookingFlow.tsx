import { useState, useEffect } from "react";
import { ArrowLeft, Calendar, Clock, CheckCircle2, Copy, Check, CreditCard, FileText, Loader2, ExternalLink } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import pixIcon from "@/assets/pix-icon.png";
import WhatsAppIcon from "@/components/icons/WhatsAppIcon";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { sendPush, showLocalNotification } from "@/lib/push-notify";
import {
  DEFAULT_COMPROVANTE_WHATSAPP,
  DEFAULT_PIX_MERCHANT_NAME,
  buildPixComprovanteWhatsappUrl,
  generatePixPayload,
} from "@/lib/pix";

interface BookingFlowProps {
  service: string;
  variation?: string;
  onBack: () => void;
  onConfirm: (bookingData?: { date: string; time: string; price: number; paidAmount: number; durationMinutes: number }) => void;
}

interface PaymentResponse {
  gateway: string;
  method: string;
  qr_code?: string;
  qr_code_base64?: string;
  qr_code_image?: string;
  payment_id?: string;
  charge_id?: string;
  init_point?: string;
  barcode?: string;
  boleto_url?: string;
  ticket_url?: string;
  expiration?: string;
  status?: string;
  message?: string;
  error?: string;
}

interface GatewayInfo {
  gateway: string;
  pix_enabled: boolean;
  cartao_enabled: boolean;
  boleto_enabled: boolean;
}

const BookingFlow = ({ service, variation, onBack, onConfirm }: BookingFlowProps) => {
  const [selectedDate, setSelectedDate] = useState<string>("");
  const [selectedTime, setSelectedTime] = useState<string>("");
  const [step, setStep] = useState<"date" | "confirm" | "payment" | "waiting">("date");
  const [copied, setCopied] = useState(false);
  const [paymentMode, setPaymentMode] = useState<"deposit" | "full">("full");
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState<"pix" | "cartao" | "boleto">("pix");
  const [paymentChoice, setPaymentChoice] = useState<"pix" | "recepcao">("pix");
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [paymentData, setPaymentData] = useState<PaymentResponse | null>(null);
  const [availableMethods, setAvailableMethods] = useState<{ pix: boolean; cartao: boolean; boleto: boolean }>({ pix: true, cartao: false, boleto: false });
  const [gatewayInfo, setGatewayInfo] = useState<GatewayInfo | null>(null);
  const [agendamentoId, setAgendamentoId] = useState<string | null>(null);
  const [paymentExpiry, setPaymentExpiry] = useState<number>(0);
  const [timeLeft, setTimeLeft] = useState<number>(300); // 5 min in seconds
  const [observacao, setObservacao] = useState<string>("");
  const [hasOnlineGateway, setHasOnlineGateway] = useState(false);
  const [pixDiretoConfig, setPixDiretoConfig] = useState<{
    enabled: boolean;
    key: string;
    merchantName: string;
    whatsappComprovante: string;
  }>({
    enabled: false,
    key: "",
    merchantName: DEFAULT_PIX_MERCHANT_NAME,
    whatsappComprovante: DEFAULT_COMPROVANTE_WHATSAPP,
  });
  const [clientDisplayName, setClientDisplayName] = useState<string>("");


  const [businessHours, setBusinessHours] = useState<Record<number, { open: string; close: string } | null>>({});
  const [hoursLoaded, setHoursLoaded] = useState(false);
  const [bookedSlots, setBookedSlots] = useState<Record<string, string[]>>({});
  const [serviceDuration, setServiceDuration] = useState(60);
  const [servicePrice, setServicePrice] = useState<number | null>(null);
  const [serviceDescricao, setServiceDescricao] = useState<string>("");
  const [serviceCategoria, setServiceCategoria] = useState<string>("");

  const loadBusinessHours = async () => {
    const { data } = await supabase.from("horarios_funcionamento").select("*");
    if (data) {
      const map: Record<number, { open: string; close: string } | null> = {};
      data.forEach(d => {
        map[d.dia_semana] = d.aberto ? { open: d.hora_inicio, close: d.hora_fim } : null;
      });
      setBusinessHours(map);
    }
    setHoursLoaded(true);
  };

  useEffect(() => {
    loadBusinessHours();
    // Load service duration
    supabase.from("servicos_app").select("duracao_minutos, nome, preco, descricao, categoria").eq("nome", service).maybeSingle().then(({ data }) => {
      if (data?.duracao_minutos) setServiceDuration(data.duracao_minutos);
      if (data?.preco) setServicePrice(data.preco);
      if ((data as any)?.descricao) setServiceDescricao((data as any).descricao);
      if ((data as any)?.categoria) setServiceCategoria((data as any).categoria);
    });
    // Load gateway configs (online gateways + PIX Direto)
    (supabase.from as any)("gateway_configs")
      .select("gateway, access_token, public_key, whatsapp_comprovante, ativo, pix_enabled, cartao_enabled, boleto_enabled")
      .then(({ data }: any) => {
        if (!data || data.length === 0) return;

        const pixDiretoRow = data.find((r: any) => r.gateway === "pix_direto");
        const pixKey = (pixDiretoRow?.access_token || "").trim();
        const pixEnabled = Boolean(pixDiretoRow?.ativo && pixKey);
        setPixDiretoConfig({
          enabled: pixEnabled,
          key: pixKey,
          merchantName: (pixDiretoRow?.public_key || "").trim() || DEFAULT_PIX_MERCHANT_NAME,
          whatsappComprovante: (pixDiretoRow?.whatsapp_comprovante || "").trim() || DEFAULT_COMPROVANTE_WHATSAPP,
        });

        const activeOnline = data.filter(
          (r: any) => r.gateway !== "pix_direto" && r.ativo && (r.access_token || "").trim()
        );
        if (activeOnline.length > 0) {
          setHasOnlineGateway(true);
          const methods = { pix: false, cartao: false, boleto: false };
          (activeOnline as GatewayInfo[]).forEach((gw) => {
            if (gw.pix_enabled) methods.pix = true;
            if (gw.cartao_enabled) methods.cartao = true;
            if (gw.boleto_enabled) methods.boleto = true;
          });
          setAvailableMethods(methods);
          setGatewayInfo(activeOnline[0]);
          if (!methods.pix) setPaymentChoice("recepcao");
        } else {
          setHasOnlineGateway(false);
          setAvailableMethods({ pix: pixEnabled, cartao: false, boleto: false });
          if (!pixEnabled) setPaymentChoice("recepcao");
        }
      });
    loadBookedSlots();

    const ch = supabase
      .channel("public-booking-hours-sync")
      .on("postgres_changes", { event: "*", schema: "public", table: "horarios_funcionamento" }, () => {
        loadBusinessHours();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "horarios_bloqueados" }, () => {
        loadBookedSlots();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "agendamentos" }, () => {
        loadBookedSlots();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(ch);
    };
  }, []);

  const loadBookedSlots = async () => {
    const today = new Date();
    const futureDate = new Date(today);
    futureDate.setDate(futureDate.getDate() + 35);
    const todayStr = new Date(today.getTime() - today.getTimezoneOffset() * 60000).toISOString().split("T")[0];
    const futureStr = new Date(futureDate.getTime() - futureDate.getTimezoneOffset() * 60000).toISOString().split("T")[0];

    // Load agendamentos + manual blocks in parallel
    const [agRes, blockRes] = await Promise.all([
      supabase.from("agendamentos").select("data_agendamento, horario, status, duracao_minutos")
        .gte("data_agendamento", todayStr).lte("data_agendamento", futureStr).in("status", ["pendente", "confirmado", "concluido"]),
      supabase.from("horarios_bloqueados").select("data, horario")
        .gte("data", todayStr).lte("data", futureStr),
    ]);

    const map: Record<string, string[]> = {};

    // Add booked slots (with duration)
    agRes.data?.forEach(a => {
      if (!map[a.data_agendamento]) map[a.data_agendamento] = [];
      const dur = a.duracao_minutos || 60;
      const [h, m] = a.horario.split(":").map(Number);
      const startMin = h * 60 + m;
      for (let t = 0; t < dur; t += 30) {
        const slotMin = startMin + t;
        const slotStr = `${String(Math.floor(slotMin / 60)).padStart(2, "0")}:${String(slotMin % 60).padStart(2, "0")}`;
        if (!map[a.data_agendamento].includes(slotStr)) map[a.data_agendamento].push(slotStr);
      }
    });

    // Add manually blocked slots
    blockRes.data?.forEach(b => {
      if (!map[b.data]) map[b.data] = [];
      if (!map[b.data].includes(b.horario)) map[b.data].push(b.horario);
    });

    setBookedSlots(map);
  };

  const generateTimes = (open: string, close: string) => {
    const result: string[] = [];
    const [oh, om] = open.split(":").map(Number);
    const [ch, cm] = close.split(":").map(Number);
    const startMin = oh * 60 + om;
    const endMin = ch * 60 + (cm || 0);
    for (let m = startMin; m < endMin; m += 30) {
      result.push(`${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`);
    }
    return result;
  };

  const today = new Date();
  
  // Find exactly the next 3 open days configured in Admin -> Horários
  const getNextOpenDates = (count: number) => {
    if (!hoursLoaded) return [];
    const openDates: Date[] = [];
    let offset = 1;
    // We check up to 30 days ahead to find the open ones, but stop as soon as we reach the desired count
    while (openDates.length < count && offset <= 30) {
      const d = new Date(today);
      d.setDate(d.getDate() + offset);
      // Check if this day of week is explicitly configured as open
      if (Boolean(businessHours[d.getDay()])) {
        openDates.push(d);
      }
      offset++;
    }
    return openDates;
  };

  const dates = getNextOpenDates(3);

  const isDayOpen = (d: Date) => hoursLoaded && Boolean(businessHours[d.getDay()]);

  const getTimesForDate = (dateStr: string) => {
    const d = new Date(dateStr + "T12:00:00");
    const hours = businessHours[d.getDay()];
    if (!hours) return [];
    const allTimes = generateTimes(hours.open, hours.close);
    const booked = bookedSlots[dateStr] || [];
    // Filter: slot is available only if all consecutive slots needed by this service's duration are free
    return allTimes.filter(t => {
      const [h, m] = t.split(":").map(Number);
      const startMin = h * 60 + m;
      const [closeH, closeM] = hours.close.split(":").map(Number);
      const closeMin = closeH * 60 + (closeM || 0);
      // Check service fits before closing time
      if (startMin + serviceDuration > closeMin) return false;
      // Check no overlap with booked slots (30-min increments)
      for (let offset = 0; offset < serviceDuration; offset += 30) {
        const checkMin = startMin + offset;
        const checkStr = `${String(Math.floor(checkMin / 60)).padStart(2, "0")}:${String(checkMin % 60).padStart(2, "0")}`;
        if (booked.includes(checkStr)) return false;
      }
      return true;
    });
  };

  const times = selectedDate ? getTimesForDate(selectedDate) : [];

  const formatDate = (d: Date) => {
    const days = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];
    const months = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];
    return {
      day: days[d.getDay()],
      date: d.getDate().toString(),
      month: months[d.getMonth()],
      full: new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().split("T")[0],
    };
  };

  const getPrice = () => {
    if (servicePrice !== null) return `R$ ${servicePrice}`;
    if (variation === "Básica") return "R$ 170";
    if (variation === "Padrão") return "R$ 180";
    if (variation === "Premium") return "R$ 300";
    if (service.includes("Fio")) return "R$ 550";
    if (service.includes("Labial")) return "R$ 480";
    return "R$ 170";
  };

  const price = getPrice();
  const numericPrice = parseInt(price.replace(/\D/g, ""));
  const requiresDeposit = numericPrice > 300;
  const depositAmount = requiresDeposit ? `R$ ${Math.round(numericPrice * 0.3)}` : null;

  const getPaymentAmount = () => {
    if (!requiresDeposit) return numericPrice;
    return paymentMode === "deposit" ? Math.round(numericPrice * 0.3) : numericPrice;
  };

  const paymentAmount = getPaymentAmount();
  const pixPayload = generatePixPayload({
    key: pixDiretoConfig.key,
    amount: paymentAmount,
    merchantName: pixDiretoConfig.merchantName,
  });

  const handleCopyCode = async (text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  // Countdown timer for payment expiry
  useEffect(() => {
    if (step !== "payment" && step !== "waiting") return;
    if (paymentExpiry <= 0) return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((paymentExpiry - Date.now()) / 1000));
      setTimeLeft(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
        toast.error("Tempo de pagamento expirado. Agendamento cancelado.");
        // Cancel the agendamento
        if (agendamentoId) {
          supabase.from("agendamentos").update({ status: "cancelado" }).eq("id", agendamentoId);
        }
        setStep("confirm");
        setPaymentData(null);
        setAgendamentoId(null);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [step, paymentExpiry, agendamentoId]);

  // Poll for payment confirmation via webhook
  useEffect(() => {
    if (step !== "payment" && step !== "waiting") return;
    if (!agendamentoId) return;
    const isLocal = !paymentData || paymentData.gateway === "local";
    if (isLocal) return; // local PIX doesn't poll

    let active = true;
    const poll = setInterval(async () => {
      if (!active || document.visibilityState === "hidden") return; // pausa em background
      const { data } = await supabase.from("agendamentos").select("status").eq("id", agendamentoId).maybeSingle();
      if (data?.status === "confirmado") {
        clearInterval(poll);
        toast.success("Pagamento confirmado! ✅");
        onConfirm({ date: selectedDate, time: selectedTime, price: numericPrice, paidAmount: paymentAmount, durationMinutes: serviceDuration });
      }
    }, 5000); // 5s é suficiente — o webhook precisa de tempo para atualizar
    return () => { active = false; clearInterval(poll); };
  }, [step, agendamentoId, paymentData]);

  const handleCreatePayment = async () => {
    setPaymentLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        toast.error("Faça login para continuar");
        setPaymentLoading(false);
        return;
      }

      // 1. Create agendamento with status "aguardando_pagamento".
      // Esse status reserva o slot na agenda (via trigger), mas é OCULTADO
      // do painel admin e do histórico do cliente até o webhook do gateway
      // confirmar o pagamento — só então vira "confirmado" e aparece no sistema.
      const { data: agData, error: agError } = await supabase.from("agendamentos").insert({
        user_id: user.id,
        servico: service,
        variacao: variation || null,
        data_agendamento: selectedDate,
        horario: selectedTime,
        valor: numericPrice,
        valor_pago: 0,
        forma_pagamento: selectedPaymentMethod,
        status: "aguardando_pagamento",
        duracao_minutos: serviceDuration,
        observacao: observacao.trim(),
      }).select("id").single();

      if (agError || !agData) {
        toast.error("Erro ao criar agendamento");
        setPaymentLoading(false);
        return;
      }

      const realAgendamentoId = agData.id;
      setAgendamentoId(realAgendamentoId);

      // ⚠️ NÃO dispara push/webhook de confirmação aqui — o agendamento está PENDENTE.
      // O admin e o cliente só serão notificados depois que o webhook do gateway
      // (mercadopago-webhook / woovi-webhook) confirmar o pagamento de fato.

      // 2. Create payment with real agendamento_id
      const res = await supabase.functions.invoke("create-payment", {
        body: {
          amount: paymentAmount,
          description: `${service}${variation ? ` — ${variation}` : ""}`,
          agendamento_id: realAgendamentoId,
          payment_method: selectedPaymentMethod,
          customer_email: user.email,
          customer_name: user.user_metadata?.nome,
        },
      });

      const result = res.data as PaymentResponse;
      if (result?.error) {
        toast.error(result.error);
        // Cancel the pending agendamento
        await supabase.from("agendamentos").update({ status: "cancelado" }).eq("id", realAgendamentoId);
        setPaymentLoading(false);
        return;
      }

      setPaymentData(result);
      const gatewayExpiration = result?.expiration ? new Date(result.expiration).getTime() : 0;
      const expiresAt = Number.isFinite(gatewayExpiration) && gatewayExpiration > Date.now()
        ? gatewayExpiration
        : Date.now() + 30 * 60 * 1000;
      setPaymentExpiry(expiresAt);
      setTimeLeft(Math.max(0, Math.floor((expiresAt - Date.now()) / 1000)));
      setStep("payment");
    } catch (err) {
      console.error("Payment error:", err);
      toast.error("Erro ao criar pagamento");
    }
    setPaymentLoading(false);
  };

  const handleGoToPayment = async () => {
    // Serviço gratuito (R$ 0): cria o agendamento já confirmado.
    if (numericPrice === 0 || paymentAmount === 0) {
      setPaymentLoading(true);
      const id = await createAgendamento("pix");
      setPaymentLoading(false);
      if (!id) return;
      onConfirm({
        date: selectedDate,
        time: selectedTime,
        price: numericPrice,
        paidAmount: 0,
        durationMinutes: serviceDuration,
      });
      return;
    }

    // Sem gateway online → usa PIX Direto com a chave configurada na aba Gateway:
    // o agendamento já entra como "confirmado" com valor_pago = 0 (pagamento pendente)
    // e abre a tela com QR Code + Copia e Cola + "Enviar comprovante no WhatsApp".
    if (!hasOnlineGateway) {
      await handleConfirmPixAgora();
      return;
    }

    handleCreatePayment();
  };

  // Cria agendamento e dispara notificações; status sempre "confirmado" e valor_pago = 0 (pendente).
  // forma: "pendente" → pagar na recepção. forma: "pix" → PIX Direto (comprovante via WhatsApp).
  const createAgendamento = async (forma: "pix" | "pendente") => {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      toast.error("Faça login para continuar");
      return null;
    }
    const { data: agData, error: agError } = await supabase.from("agendamentos").insert({
      user_id: user.id,
      servico: service,
      variacao: variation || null,
      data_agendamento: selectedDate,
      horario: selectedTime,
      valor: numericPrice,
      valor_pago: 0,
      forma_pagamento: forma,
      status: "confirmado",
      duracao_minutos: serviceDuration,
      observacao: observacao.trim(),
    }).select("id").single();

    if (agError || !agData) {
      toast.error("Erro ao criar agendamento");
      return null;
    }

    setAgendamentoId(agData.id);

    try {
      const { data: prof } = await supabase
        .from("profiles")
        .select("nome, whatsapp")
        .eq("id", user.id)
        .maybeSingle();
      const nomeCli = prof?.nome || user.user_metadata?.nome || "Cliente";
      setClientDisplayName(nomeCli);
      const formaTxt = forma === "pix" ? "(PIX Direto · pendente)" : "(pagar na recepção)";
      void sendPush({
        role: "admin",
        title: "🔔 Novo Agendamento!",
        message: `${nomeCli} — ${service} em ${selectedDate} às ${selectedTime} ${formaTxt}`,
        url: "/admin/",
      }).catch((e) => console.warn("admin push failed", e));

      const clienteMsg = forma === "pix"
        ? `${service} em ${selectedDate} às ${selectedTime}. Envie o comprovante do PIX pelo WhatsApp.`
        : `${service} em ${selectedDate} às ${selectedTime}. Pagamento na recepção.`;
      await sendPush({
        role: "cliente",
        user_id: user.id,
        title: "✅ Agendamento confirmado!",
        message: clienteMsg,
        url: "/",
      });
      showLocalNotification("✅ Agendamento confirmado!", clienteMsg);
    } catch (e) {
      console.log("notify skipped", e);
    }

    return agData.id;
  };

  const handleConfirmRecepcao = async () => {
    setPaymentLoading(true);
    const id = await createAgendamento("pendente");
    setPaymentLoading(false);
    if (!id) return;
    onConfirm({
      date: selectedDate,
      time: selectedTime,
      price: numericPrice,
      paidAmount: 0,
      durationMinutes: serviceDuration,
    });
  };

  const handleConfirmPixAgora = async () => {
    if (!pixDiretoConfig.key) {
      toast.error("Chave PIX não configurada. Escolha pagar na recepção.");
      return;
    }
    setPaymentLoading(true);
    const id = await createAgendamento("pix");
    if (!id) {
      setPaymentLoading(false);
      return;
    }
    setPaymentData({ gateway: "local", method: "pix" });
    setPaymentExpiry(0); // Não expira nem cancela: agendamento já está confirmado (pagamento pendente)
    setStep("payment");
    setPaymentLoading(false);
  };


  if (step === "confirm") {
    return (
      <section className="min-h-screen bg-background px-6 py-8 flex flex-col lg:items-center lg:px-8">
        <div className="w-full lg:max-w-2xl">
        <button
          onClick={() => setStep("date")}
          className="ios-press flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="font-body text-[14px]">Voltar</span>
        </button>

        <div className="flex-1 flex flex-col items-center justify-center text-center animate-fade-in">
          <div className="w-16 h-16 rounded-full bg-gold/10 flex items-center justify-center mb-6">
            <CheckCircle2 className="w-8 h-8 text-gold" />
          </div>
          <h2 className="font-heading text-3xl font-semibold text-foreground mb-2">
            Quase lá!
          </h2>
          <p className="font-body text-[13px] text-muted-foreground mb-8 max-w-xs">
            Confirme os detalhes do seu agendamento
          </p>

          <div className="w-full max-w-sm bg-card/80 backdrop-blur-sm rounded-3xl border border-border/60 p-6 space-y-4 text-left">
            <div>
              <p className="font-body text-[11px] text-muted-foreground uppercase tracking-widest font-medium">Serviço</p>
              <p className="font-body text-[14px] font-medium text-foreground mt-0.5">
                {service}{variation ? ` — ${variation}` : ""}
              </p>
              {serviceDescricao && (
                <p className="font-body text-[12px] text-muted-foreground mt-1.5 leading-relaxed whitespace-pre-line">
                  {serviceDescricao}
                </p>
              )}
            </div>
            <div className="flex gap-8">
              <div>
                <p className="font-body text-[11px] text-muted-foreground uppercase tracking-widest font-medium">Data</p>
                <p className="font-body text-[14px] font-medium text-foreground mt-0.5">{selectedDate}</p>
              </div>
              <div>
                <p className="font-body text-[11px] text-muted-foreground uppercase tracking-widest font-medium">Horário</p>
                <p className="font-body text-[14px] font-medium text-foreground mt-0.5">{selectedTime}</p>
              </div>
            </div>
            <div className="pt-3 border-t border-border/40">
              <div className="flex justify-between items-center">
                <p className="font-body text-[13px] text-muted-foreground">Valor total</p>
                <p className="font-heading text-xl font-bold text-foreground">{price}</p>
              </div>
            </div>
          </div>

          <div className="mt-4 p-3.5 rounded-2xl bg-secondary/30 backdrop-blur-sm border border-border/30 max-w-sm">
            <p className="font-body text-[12px] text-muted-foreground leading-relaxed">
              ⚠ Cancelamentos devem ser feitos com no mínimo 24h de antecedência.
            </p>
          </div>
        </div>

        {/* Observações do cliente */}
        <div className="w-full max-w-sm mt-6 lg:mx-auto">
          <label className="font-body text-[11px] text-muted-foreground uppercase tracking-widest font-medium mb-2.5 block text-left">
            Observações <span className="normal-case tracking-normal text-[11px] text-muted-foreground/60">(opcional)</span>
          </label>
          <textarea
            value={observacao}
            onChange={(e) => setObservacao(e.target.value.slice(0, 500))}
            placeholder="Ex: alergia a algum produto, gestante, sensibilidade na pele, preferências..."
            rows={3}
            className="w-full p-3 rounded-2xl border-2 border-border/60 bg-card text-foreground font-body text-[13px] placeholder:text-muted-foreground/50 focus:outline-none focus:border-gold/60 resize-none"
          />
          {observacao.length > 0 && (
            <p className="font-body text-[10px] text-muted-foreground/60 mt-1 text-right">{observacao.length}/500</p>
          )}
        </div>

        <div className="w-full max-w-sm mt-6 lg:mx-auto">
          <p className="font-body text-[11px] text-muted-foreground uppercase tracking-widest font-medium mb-2.5 text-left">
            Como deseja pagar? <span className="text-rose normal-case tracking-normal text-[11px] font-normal">(toque para escolher)</span>
          </p>
          <div className="space-y-2.5">
            {(hasOnlineGateway ? availableMethods.pix : pixDiretoConfig.enabled) && (
              <button
                type="button"
                onClick={() => setPaymentChoice("pix")}
                aria-pressed={paymentChoice === "pix"}
                className={`ios-press w-full flex items-center gap-3 p-3.5 rounded-2xl border-2 transition-all ${
                  paymentChoice === "pix"
                    ? "border-gold bg-gold/10 shadow-[0_4px_18px_-6px_hsl(22_58%_63%/0.45)]"
                    : "border-border/60 bg-card hover:border-gold/40 hover:bg-gold/5"
                }`}
              >
                <img src={pixIcon} alt="PIX" className="w-6 h-6" />
                <div className="text-left">
                  <p className="font-body text-[13px] font-semibold text-foreground">Pagar agora por PIX</p>
                  <p className="font-body text-[11px] text-muted-foreground">QR Code + Copia e Cola</p>
                </div>
                <div className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center ${paymentChoice === "pix" ? "border-gold bg-gold" : "border-muted-foreground/40"}`}>
                  {paymentChoice === "pix" && <Check className="w-3 h-3 text-charcoal" strokeWidth={3} />}
                </div>
              </button>
            )}

            {paymentChoice === "pix" && requiresDeposit && (hasOnlineGateway ? availableMethods.pix : pixDiretoConfig.enabled) && (
              <div className="grid grid-cols-2 gap-2 pt-0.5">
                <button
                  type="button"
                  onClick={() => setPaymentMode("deposit")}
                  className={`rounded-xl border p-2.5 text-left transition-all ${
                    paymentMode === "deposit"
                      ? "border-gold bg-gold/10 text-foreground"
                      : "border-border/60 bg-card text-muted-foreground"
                  }`}
                >
                  <p className="font-body text-[11px] font-semibold">Sinal (30%)</p>
                  <p className="font-heading text-[13px] font-bold text-gold">{depositAmount}</p>
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentMode("full")}
                  className={`rounded-xl border p-2.5 text-left transition-all ${
                    paymentMode === "full"
                      ? "border-gold bg-gold/10 text-foreground"
                      : "border-border/60 bg-card text-muted-foreground"
                  }`}
                >
                  <p className="font-body text-[11px] font-semibold">Valor total</p>
                  <p className="font-heading text-[13px] font-bold text-gold">{price}</p>
                </button>
              </div>
            )}

            <button
              type="button"
              onClick={() => setPaymentChoice("recepcao")}
              aria-pressed={paymentChoice === "recepcao"}
              className={`ios-press w-full flex items-center gap-3 p-3.5 rounded-2xl border-2 transition-all ${
                paymentChoice === "recepcao"
                  ? "border-gold bg-gold/10 shadow-[0_4px_18px_-6px_hsl(22_58%_63%/0.45)]"
                  : "border-border/60 bg-card hover:border-gold/40 hover:bg-gold/5"
              }`}
            >
              <span className="text-xl">💰</span>
              <div className="text-left">
                <p className="font-body text-[13px] font-semibold text-foreground">Pagar na recepção</p>
                <p className="font-body text-[11px] text-muted-foreground">No dia do atendimento</p>
              </div>
              <div className={`ml-auto w-5 h-5 rounded-full border-2 flex items-center justify-center ${paymentChoice === "recepcao" ? "border-gold bg-gold" : "border-muted-foreground/40"}`}>
                {paymentChoice === "recepcao" && <Check className="w-3 h-3 text-charcoal" strokeWidth={3} />}
              </div>
            </button>
          </div>
        </div>

        <div className="pt-6 pb-4">
          <button
            onClick={paymentChoice === "pix" ? handleGoToPayment : handleConfirmRecepcao}
            disabled={paymentLoading}
            className="ios-press w-full py-4 rounded-full bg-rose text-primary-foreground font-body font-semibold text-[15px] tracking-wide shadow-[0_4px_20px_-4px_hsl(340_30%_50%/0.4)] transition-all flex items-center justify-center gap-2.5 disabled:opacity-50"
          >
            {paymentLoading ? (
              <><Loader2 className="w-5 h-5 animate-spin" /> Confirmando...</>
            ) : paymentChoice === "pix" ? (
              <><img src={pixIcon} alt="PIX" className="w-5 h-5" /> Gerar PIX — R$ {paymentAmount}</>
            ) : (
              <><CheckCircle2 className="w-5 h-5" /> Confirmar Agendamento</>
            )}
          </button>
        </div>
        </div>
      </section>
    );
  }


  // Payment screen
  if (step === "payment") {
    const isLocalPix = !paymentData || paymentData.gateway === "local";
    const pixCode = isLocalPix ? pixPayload : (paymentData?.qr_code || pixPayload);
    const paymentLabel = requiresDeposit
      ? (paymentMode === "deposit" ? `Sinal: ${depositAmount}` : `Total: ${price}`)
      : `Total: ${price}`;
    const timerMin = Math.floor(timeLeft / 60);
    const timerSec = timeLeft % 60;
    const timerStr = `${timerMin}:${String(timerSec).padStart(2, "0")}`;
    const timerUrgent = timeLeft <= 60;

    if (paymentData?.method === "cartao" && paymentData.init_point) {
      return (
        <section className="min-h-screen bg-background px-6 py-8 flex flex-col items-center lg:px-8">
          <button onClick={async () => {
            if (agendamentoId) {
              await supabase.from("agendamentos").update({ status: "cancelado" }).eq("id", agendamentoId);
            }
            setAgendamentoId(null);
            setPaymentData(null);
            setStep("confirm");
          }} className="ios-press self-start flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8">
            <ArrowLeft className="w-4 h-4" /><span className="font-body text-[14px]">Voltar</span>
          </button>
          <div className="flex-1 flex flex-col items-center justify-center text-center animate-fade-in">
            {/* Timer */}
            <div className={`mb-4 px-4 py-2 rounded-full font-body text-[13px] font-semibold ${timerUrgent ? "bg-destructive/20 text-destructive animate-pulse" : "bg-gold/10 text-gold"}`}>
              ⏱ Expira em {timerStr}
            </div>
            <CreditCard className="w-12 h-12 text-gold mb-4" />
            <h2 className="font-heading text-2xl font-semibold text-foreground mb-2">Pagamento com Cartão</h2>
            <p className="font-body text-[13px] text-muted-foreground mb-6 max-w-xs">Você será redirecionado para o checkout seguro</p>
            <a href={paymentData.init_point} target="_blank" rel="noopener noreferrer"
              className="ios-press w-full max-w-sm py-4 rounded-full bg-rose text-primary-foreground font-body font-semibold text-[15px] flex items-center justify-center gap-2">
              <ExternalLink className="w-5 h-5" /> Ir para o Checkout
            </a>
            <p className="mt-4 font-body text-[12px] text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Aguardando confirmação do pagamento...
            </p>
          </div>
        </section>
      );
    }

    if (paymentData?.method === "boleto") {
      return (
        <section className="min-h-screen bg-background px-6 py-8 flex flex-col items-center lg:px-8">
          <button onClick={async () => {
            if (agendamentoId) {
              await supabase.from("agendamentos").update({ status: "cancelado" }).eq("id", agendamentoId);
            }
            setAgendamentoId(null);
            setPaymentData(null);
            setStep("confirm");
          }} className="ios-press self-start flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8">
            <ArrowLeft className="w-4 h-4" /><span className="font-body text-[14px]">Voltar</span>
          </button>
          <div className="flex-1 flex flex-col items-center justify-center text-center animate-fade-in">
            <div className={`mb-4 px-4 py-2 rounded-full font-body text-[13px] font-semibold ${timerUrgent ? "bg-destructive/20 text-destructive animate-pulse" : "bg-gold/10 text-gold"}`}>
              ⏱ Expira em {timerStr}
            </div>
            <FileText className="w-12 h-12 text-gold mb-4" />
            <h2 className="font-heading text-2xl font-semibold text-foreground mb-2">Boleto Gerado</h2>
            <p className="font-body text-[13px] text-muted-foreground mb-4">{paymentLabel}</p>
            {paymentData.barcode && (
              <div className="w-full max-w-sm space-y-3 mb-6">
                <p className="font-body text-[11px] text-muted-foreground uppercase tracking-widest font-medium">Código de barras</p>
                <div className="relative">
                  <div className="w-full px-4 py-3.5 rounded-2xl bg-card border border-border text-left font-body text-[12px] text-foreground/70 break-all pr-14">{paymentData.barcode}</div>
                  <button onClick={() => handleCopyCode(paymentData.barcode!)}
                    className="ios-press absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-gold/10 flex items-center justify-center text-gold">
                    {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  </button>
                </div>
              </div>
            )}
            {paymentData.boleto_url && (
              <a href={paymentData.boleto_url} target="_blank" rel="noopener noreferrer"
                className="ios-press w-full max-w-sm py-4 rounded-full bg-rose text-primary-foreground font-body font-semibold text-[15px] flex items-center justify-center gap-2 mb-4">
                <ExternalLink className="w-5 h-5" /> Abrir Boleto
              </a>
            )}
            <p className="mt-4 font-body text-[12px] text-muted-foreground flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" /> Aguardando confirmação do pagamento...
            </p>
          </div>
        </section>
      );
    }

    // PIX (gateway or PIX Direto)
    const comprovanteWhatsappUrl = buildPixComprovanteWhatsappUrl({
      whatsappDestino: pixDiretoConfig.whatsappComprovante,
      clienteNome: clientDisplayName,
      servico: service,
      variacao: variation,
      data: selectedDate,
      horario: selectedTime,
      valor: paymentAmount,
    });

    return (
      <section className="min-h-screen bg-background px-6 py-8 flex flex-col lg:items-center lg:px-8">
        {!isLocalPix && (
          <button onClick={async () => {
              if (agendamentoId) {
                await supabase.from("agendamentos").update({ status: "cancelado" }).eq("id", agendamentoId);
              }
              setAgendamentoId(null);
              setPaymentData(null);
              setStep("confirm");
            }} className="ios-press flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-6">
            <ArrowLeft className="w-4 h-4" /><span className="font-body text-[14px]">Voltar</span>
          </button>
        )}
        <div className="flex-1 flex flex-col items-center text-center animate-fade-in">
          <div className="w-14 h-14 rounded-full bg-gold/10 flex items-center justify-center mb-4">
            <img src={pixIcon} alt="PIX" className="w-7 h-7" />
          </div>
          <h2 className="font-heading text-2xl font-semibold text-foreground mb-1">Pagamento PIX</h2>
          {isLocalPix ? (
            <div className="mt-2 mb-3 px-4 py-1.5 rounded-full font-body text-[12px] font-semibold bg-emerald-500/15 border border-emerald-500/30 text-emerald-500">
              ✓ Agendamento Confirmado · Pagamento Pendente
            </div>
          ) : (
            <div className={`mt-2 mb-3 px-4 py-2 rounded-full font-body text-[13px] font-semibold ${timerUrgent ? "bg-destructive/20 text-destructive animate-pulse" : "bg-gold/10 text-gold"}`}>
              ⏱ Expira em {timerStr}
            </div>
          )}
          <p className="font-body text-[13px] text-muted-foreground mb-5">{paymentLabel}</p>
          <div className="bg-white p-5 rounded-3xl shadow-[0_4px_24px_-6px_rgba(0,0,0,0.1)] mb-6">
            {paymentData?.qr_code_base64 ? (
              <img src={`data:image/png;base64,${paymentData.qr_code_base64}`} alt="QR Code" className="w-[220px] h-[220px]" />
            ) : paymentData?.qr_code_image ? (
              <img src={paymentData.qr_code_image} alt="QR Code" className="w-[220px] h-[220px]" />
            ) : (
              <QRCodeSVG value={pixCode} size={220} level="M" bgColor="#FFFFFF" fgColor="#1C1C1C" />
            )}
          </div>
          <div className="w-full max-w-sm space-y-3">
            <p className="font-body text-[11px] text-muted-foreground uppercase tracking-widest font-medium">PIX Copia e Cola</p>
            <div className="relative">
              <div className="w-full px-4 py-3.5 rounded-2xl bg-card border border-border text-left font-body text-[12px] text-foreground/70 break-all leading-relaxed pr-14 max-h-24 overflow-y-auto scrollbar-hide">{pixCode}</div>
              <button onClick={() => handleCopyCode(pixCode)}
                className="ios-press absolute right-2 top-1/2 -translate-y-1/2 w-10 h-10 rounded-xl bg-gold/10 flex items-center justify-center text-gold hover:bg-gold/20 transition-all">
                {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
              </button>
            </div>
            {copied && <p className="font-body text-[12px] text-gold font-medium animate-fade-in">✓ Código copiado!</p>}
          </div>

          {!isLocalPix ? (
            <div className="mt-6 p-3.5 rounded-2xl bg-secondary/30 backdrop-blur-sm border border-border/30 max-w-sm">
              <p className="font-body text-[12px] text-muted-foreground leading-relaxed flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin flex-shrink-0" />
                Aguardando confirmação do pagamento... O sistema validará automaticamente.
              </p>
            </div>
          ) : (
            <div className="mt-6 p-3.5 rounded-2xl bg-secondary/30 backdrop-blur-sm border border-border/30 max-w-sm">
              <p className="font-body text-[12px] text-muted-foreground leading-relaxed">
                Seu horário já está confirmado! Após realizar o PIX, envie o comprovante no WhatsApp para darmos baixa no pagamento.
              </p>
            </div>
          )}
        </div>
        <div className="pt-6 pb-4 w-full max-w-sm mx-auto space-y-2.5">
          {isLocalPix ? (
            <>
              <a
                href={comprovanteWhatsappUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ios-press w-full py-4 rounded-full bg-[#25d366] text-white font-body font-semibold text-[15px] tracking-wide shadow-[0_4px_20px_-4px_rgba(37,211,102,0.45)] transition-all flex items-center justify-center gap-2.5 hover:brightness-105"
              >
                <WhatsAppIcon className="w-5 h-5" />
                Enviar comprovante no WhatsApp
              </a>
              <button
                type="button"
                onClick={() =>
                  onConfirm({
                    date: selectedDate,
                    time: selectedTime,
                    price: numericPrice,
                    paidAmount: 0,
                    durationMinutes: serviceDuration,
                  })
                }
                className="ios-press w-full py-3.5 rounded-full bg-card border border-border text-foreground font-body font-medium text-[14px] transition-all hover:bg-secondary/40"
              >
                Concluir agendamento
              </button>
            </>
          ) : (
            <p className="text-center font-body text-[12px] text-muted-foreground">
              O agendamento será confirmado automaticamente após o pagamento
            </p>
          )}
        </div>
      </section>
    );
  }

  return (
    <section className="min-h-screen bg-background px-6 py-8 lg:flex lg:flex-col lg:items-center lg:px-8">
      <button
        onClick={onBack}
        className="ios-press flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors mb-8"
      >
        <ArrowLeft className="w-4 h-4" />
        <span className="font-body text-[14px]">Voltar</span>
      </button>

      <div className="space-y-2 mb-6">
        <p className="font-body text-[11px] tracking-widest uppercase text-gold font-medium">Agendamento</p>
        <h2 className="font-heading text-3xl font-semibold text-foreground">
          Escolha a data
        </h2>
        <p className="font-body text-[13px] text-muted-foreground">
          {service}{variation ? ` — ${variation}` : ""}
        </p>
      </div>

      {/* Date picker */}
      <div className="mb-8">
        <div className="flex items-center gap-2 mb-4">
          <Calendar className="w-4 h-4 text-gold" />
          <span className="font-body text-[11px] uppercase tracking-widest text-muted-foreground font-medium">Selecione o dia</span>
        </div>
        {!hoursLoaded ? (
          <div className="flex items-center gap-2 py-4 text-muted-foreground font-body text-[13px]">
            <Loader2 className="w-4 h-4 animate-spin text-gold" /> Carregando horários disponíveis...
          </div>
        ) : dates.length === 0 ? (
          <p className="py-4 font-body text-[13px] text-muted-foreground">
            Nenhum dia disponível para agendamento no momento.
          </p>
        ) : (
        <div className="flex gap-2.5 overflow-x-auto pb-2 -mx-2 px-2 scrollbar-hide">
          {dates.map((d) => {
            const info = formatDate(d);
            if (!isDayOpen(d)) return null;
            const isSelected = selectedDate === info.full;
            return (
              <button
                key={info.full}
                onClick={() => {
                  setSelectedDate(info.full);
                  setSelectedTime("");
                }}
                className={`ios-press flex-shrink-0 w-[68px] py-3.5 rounded-2xl border text-center transition-all duration-200 ${
                  isSelected
                    ? "border-rose/60 bg-rose/10 text-foreground shadow-[0_2px_12px_-3px_hsl(340_30%_50%/0.25)]"
                    : "border-border/50 bg-card/60 backdrop-blur-sm text-muted-foreground hover:border-gold/30 hover:bg-card/80"
                }`}
              >
                <p className="font-body text-[11px] font-medium">{info.day}</p>
                <p className="font-heading text-lg font-semibold mt-0.5">{info.date}</p>
                <p className="font-body text-[10px] mt-0.5">{info.month}</p>
              </button>
            );
          })}
        </div>
        )}
      </div>

      {/* Time picker */}
      {selectedDate && (
        <div className="animate-fade-in">
          <div className="flex items-center gap-2 mb-4">
            <Clock className="w-4 h-4 text-gold" />
            <span className="font-body text-[11px] uppercase tracking-widest text-muted-foreground font-medium">Selecione o horário</span>
          </div>
          {times.length === 0 ? (
            <p className="py-4 font-body text-[13px] text-muted-foreground">
              Todos os horários deste dia já estão ocupados ou bloqueados.
            </p>
          ) : (
          <div className="grid grid-cols-4 gap-2.5">
            {times.map((t) => {
              const isSelected = selectedTime === t;
              return (
                <button
                  key={t}
                  onClick={() => setSelectedTime(t)}
                  className={`ios-press py-3 rounded-2xl border text-center font-body text-[14px] transition-all duration-200 ${
                    isSelected
                      ? "border-rose/60 bg-rose/10 text-foreground font-semibold shadow-[0_2px_12px_-3px_hsl(340_30%_50%/0.25)]"
                      : "border-border/50 bg-card/60 backdrop-blur-sm text-muted-foreground hover:border-gold/30 hover:bg-card/80"
                  }`}
                >
                  {t}
                </button>
              );
            })}
          </div>
          )}
        </div>
      )}

      {/* Continue button */}
      {selectedDate && selectedTime && (
        <div className="mt-8 animate-fade-in">
          <button
            onClick={() => setStep("confirm")}
            className="ios-press w-full py-4 rounded-2xl bg-rose text-primary-foreground font-body font-semibold text-[15px] tracking-wide shadow-[0_4px_20px_-4px_hsl(340_30%_50%/0.4)] transition-all duration-200"
          >
            Continuar
          </button>
        </div>
      )}
    </section>
  );
};

export default BookingFlow;
