import React, { useState, useEffect } from "react";
import { supabase, SUPABASE_URL } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Save, Eye, EyeOff, Copy, Check, CreditCard, QrCode, FileText, ExternalLink, ChevronDown, ChevronUp } from "lucide-react";
import pixIconImg from "@/assets/pix-icon.png";
import WhatsAppIcon from "@/components/icons/WhatsAppIcon";
import { formatWhatsappMask } from "@/lib/utils";
import {
  DEFAULT_COMPROVANTE_WHATSAPP,
  DEFAULT_PIX_MERCHANT_NAME,
  PixKeyType,
  detectPixKeyType,
  normalizePixKey,
} from "@/lib/pix";

const PixIcon = ({ className, style }: { className?: string; style?: React.CSSProperties }) => (
  <img src={pixIconImg} alt="PIX" className={className} style={style} />
);

interface GatewayConfig {
  id: string;
  gateway: string;
  access_token: string;
  public_key: string;
  webhook_url: string;
  whatsapp_comprovante?: string | null;
  ativo: boolean;
  pix_enabled: boolean;
  cartao_enabled: boolean;
  boleto_enabled: boolean;
}

interface GatewayMeta {
  key: string;
  label: string;
  color: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  tokenPlaceholder: string;
  publicKeyPlaceholder: string;
  publicKeyLabel: string;
  helpSteps: string[];
  helpLink: string;
  helpLinkLabel: string;
  supportsCartao: boolean;
  supportsBoleto: boolean;
}

const GATEWAYS: GatewayMeta[] = [
  {
    key: "mercadopago",
    label: "Mercado Pago",
    color: "#009ee3",
    icon: CreditCard,
    tokenPlaceholder: "APP_USR-...",
    publicKeyPlaceholder: "APP_USR-...",
    publicKeyLabel: "Public Key",
    helpSteps: [
      'Acesse mercadopago.com.br/developers',
      'Vá em "Suas integrações" → Criar aplicação',
      'Copie o Access Token e Public Key',
      'Cole a URL do Webhook acima nas notificações',
      'Ative o gateway e escolha os métodos de pagamento',
    ],
    helpLink: "https://www.mercadopago.com.br/developers/panel/app",
    helpLinkLabel: "Abrir painel Mercado Pago",
    supportsCartao: true,
    supportsBoleto: true,
  },
];

const PIX_KEY_TYPES: { id: PixKeyType; label: string; placeholder: string }[] = [
  { id: "telefone", label: "Telefone", placeholder: "(48) 99999-9999 ou +5548999999999" },
  { id: "cpf", label: "CPF", placeholder: "000.000.000-00" },
  { id: "cnpj", label: "CNPJ", placeholder: "00.000.000/0000-00" },
  { id: "email", label: "E-mail", placeholder: "seuemail@exemplo.com" },
  { id: "aleatoria", label: "Aleatória", placeholder: "Chave aleatória EVP" },
];

const GatewayTab = () => {
  const [configs, setConfigs] = useState<Record<string, GatewayConfig>>({});
  const [loading, setLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [showToken, setShowToken] = useState<Record<string, boolean>>({});
  const [copied, setCopied] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({
    pix_direto: true,
    mercadopago: false,
  });

  // Form state para PIX Direto (sem gateway)
  const [pixForm, setPixForm] = useState({
    chavePix: "",
    tipoChave: "telefone" as PixKeyType,
    titular: DEFAULT_PIX_MERCHANT_NAME,
    whatsappComprovante: formatWhatsappMask(DEFAULT_COMPROVANTE_WHATSAPP.replace(/^55/, "")),
    ativo: false,
    touchedAtivo: false,
  });

  // Form state per online gateway
  const [forms, setForms] = useState<Record<string, {
    accessToken: string; publicKey: string; ativo: boolean;
    pixEnabled: boolean; cartaoEnabled: boolean; boletoEnabled: boolean;
  }>>({});

  useEffect(() => { loadAll(); }, []);

  const loadAll = async () => {
    setLoading(true);
    try {
      const { data } = await (supabase.from as any)("gateway_configs").select("*");
      if (data) {
        const map: Record<string, GatewayConfig> = {};
        const formMap: Record<string, any> = {};

        for (const d of data as GatewayConfig[]) {
          if (d.gateway === "pix_direto") {
            map.pix_direto = d;
            const rawKey = d.access_token || "";
            const rawWpp = (d.whatsapp_comprovante || DEFAULT_COMPROVANTE_WHATSAPP).replace(/^55/, "");
            setPixForm({
              chavePix: rawKey,
              tipoChave: detectPixKeyType(rawKey),
              titular: d.public_key || DEFAULT_PIX_MERCHANT_NAME,
              whatsappComprovante: formatWhatsappMask(rawWpp),
              ativo: !!d.ativo,
              touchedAtivo: false,
            });
            continue;
          }

          if (SUPABASE_URL && (!d.webhook_url || !d.webhook_url.startsWith("https://"))) {
            const webhookFn = d.gateway === "woovi" ? "woovi-webhook" : "mercadopago-webhook";
            const generatedUrl = `${SUPABASE_URL}/functions/v1/${webhookFn}`;
            await (supabase.from as any)("gateway_configs")
              .update({ webhook_url: generatedUrl })
              .eq("id", d.id);
            d.webhook_url = generatedUrl;
          }
          map[d.gateway] = d;
          formMap[d.gateway] = {
            accessToken: d.access_token || "",
            publicKey: d.public_key || "",
            ativo: d.ativo,
            pixEnabled: d.pix_enabled,
            cartaoEnabled: d.cartao_enabled,
            boletoEnabled: d.boleto_enabled,
          };
        }
        setConfigs(map);
        setForms(formMap);
      }
    } catch (err) {
      console.error("Erro ao carregar gateways:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleSavePixDireto = async () => {
    const normalizedKey = normalizePixKey(pixForm.chavePix, pixForm.tipoChave);
    const cleanTitular = (pixForm.titular || DEFAULT_PIX_MERCHANT_NAME).trim().toUpperCase().slice(0, 25);
    const wppDigitsRaw = pixForm.whatsappComprovante.replace(/\D/g, "").replace(/^0+/, "");
    const wppFull = wppDigitsRaw
      ? (wppDigitsRaw.length <= 11 ? `55${wppDigitsRaw}` : wppDigitsRaw)
      : DEFAULT_COMPROVANTE_WHATSAPP;

    // Se a pessoa acabou de cadastrar uma chave PIX pela primeira vez e não desligou o toggle manualmente, ativa direto.
    const existingKey = (configs.pix_direto?.access_token || "").trim();
    const shouldActivate = normalizedKey
      ? (!existingKey && !pixForm.touchedAtivo ? true : pixForm.ativo)
      : false;

    if (!normalizedKey && pixForm.ativo) {
      toast.error("Informe uma Chave PIX válida antes de ativar");
      return;
    }

    setSavingKey("pix_direto");
    const payload = {
      gateway: "pix_direto",
      access_token: normalizedKey,
      public_key: cleanTitular || DEFAULT_PIX_MERCHANT_NAME,
      whatsapp_comprovante: wppFull,
      ativo: shouldActivate,
      pix_enabled: true,
      cartao_enabled: false,
      boleto_enabled: false,
      updated_at: new Date().toISOString(),
    };

    let error: any = null;
    if (configs.pix_direto?.id) {
      const res = await (supabase.from as any)("gateway_configs")
        .update(payload)
        .eq("id", configs.pix_direto.id);
      error = res.error;
    } else {
      const res = await (supabase.from as any)("gateway_configs").insert(payload);
      error = res.error;
    }

    if (error) {
      toast.error("Erro ao salvar Chave PIX");
    } else {
      toast.success(
        shouldActivate
          ? "Chave PIX salva e ativada no agendamento!"
          : "Configuração do PIX Direto salva!"
      );
      await loadAll();
    }
    setSavingKey(null);
  };

  const handleSave = async (gatewayKey: string) => {
    const cfg = configs[gatewayKey];
    const form = forms[gatewayKey];
    if (!cfg || !form) return;
    setSavingKey(gatewayKey);
    const { error } = await (supabase.from as any)("gateway_configs")
      .update({
        access_token: form.accessToken,
        public_key: form.publicKey,
        ativo: form.ativo,
        pix_enabled: form.pixEnabled,
        cartao_enabled: form.cartaoEnabled,
        boleto_enabled: form.boletoEnabled,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cfg.id);
    if (error) {
      toast.error("Erro ao salvar configuração");
    } else {
      toast.success("Configuração salva!");
      loadAll();
    }
    setSavingKey(null);
  };

  const updateForm = (gatewayKey: string, field: string, value: any) => {
    setForms((prev) => ({
      ...prev,
      [gatewayKey]: { ...prev[gatewayKey], [field]: value },
    }));
  };

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text);
    setCopied(label);
    toast.success(`${label} copiada!`);
    setTimeout(() => setCopied(null), 2000);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gold border-t-transparent" />
      </div>
    );
  }

  const normalizedPreview = normalizePixKey(pixForm.chavePix, pixForm.tipoChave);
  const isPixExpanded = expanded.pix_direto !== false;

  return (
    <div className="space-y-4 animate-fade-in">
      <h2 className="font-heading text-lg font-semibold text-primary-foreground lg:hidden">
        Pagamentos & Chave PIX
      </h2>

      {/* Card principal: PIX Direto (Sem Gateway) */}
      <div className="rounded-2xl border border-gold/25 bg-gradient-to-br from-gold/[0.06] via-primary-foreground/[0.02] to-transparent overflow-hidden">
        <button
          type="button"
          onClick={() => setExpanded((p) => ({ ...p, pix_direto: !isPixExpanded }))}
          className="w-full flex items-center justify-between p-4 border-b border-primary-foreground/[0.06] hover:bg-primary-foreground/[0.02] transition-all"
        >
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-500/15 border border-emerald-500/25">
              <QrCode className="h-5 w-5 text-emerald-400" />
            </div>
            <div className="text-left">
              <h3 className="font-heading text-[14px] font-semibold text-primary-foreground">
                PIX Direto (Sem Gateway)
              </h3>
              <p className="font-body text-[11px] text-primary-foreground/75">
                {pixForm.ativo && normalizedPreview ? "Ativo · QR Code + Comprovante WhatsApp" : "Desativado ou sem chave"}
                {pixForm.ativo && normalizedPreview && (
                  <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                )}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <div
              onClick={(e) => {
                e.stopPropagation();
                setPixForm((p) => ({ ...p, ativo: !p.ativo, touchedAtivo: true }));
              }}
              className={`w-11 h-6 rounded-full relative transition-all duration-200 cursor-pointer ${pixForm.ativo ? "bg-green-500" : "bg-primary-foreground/10"}`}
            >
              <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${pixForm.ativo ? "left-5" : "left-0.5"}`} />
            </div>
            {isPixExpanded ? <ChevronUp className="h-4 w-4 text-primary-foreground/75" /> : <ChevronDown className="h-4 w-4 text-primary-foreground/75" />}
          </div>
        </button>

        {isPixExpanded && (
          <div className="p-4 space-y-4">
            {/* Tipo da Chave PIX */}
            <div>
              <label className="font-body text-[11px] text-primary-foreground/75 mb-1.5 block">
                Tipo da Chave PIX
              </label>
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-1.5">
                {PIX_KEY_TYPES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => setPixForm((p) => ({ ...p, tipoChave: t.id }))}
                    className={`rounded-xl px-2 py-2 font-body text-[11px] font-medium border transition-all ${
                      pixForm.tipoChave === t.id
                        ? "bg-gold/20 text-gold border-gold/45"
                        : "bg-primary-foreground/[0.03] text-primary-foreground/70 border-primary-foreground/[0.07] hover:text-primary-foreground"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Chave PIX */}
            <div>
              <label className="font-body text-[11px] text-primary-foreground/75 mb-1.5 block">
                Chave PIX *
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={pixForm.chavePix}
                  onChange={(e) => setPixForm((p) => ({ ...p, chavePix: e.target.value }))}
                  placeholder={PIX_KEY_TYPES.find((t) => t.id === pixForm.tipoChave)?.placeholder}
                  className="w-full rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.08] py-2.5 pl-3 pr-12 text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/45 focus:outline-none focus:ring-2 focus:ring-gold/25"
                />
                {normalizedPreview && (
                  <button
                    type="button"
                    onClick={() => copyToClipboard(normalizedPreview, "Chave PIX")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-primary-foreground/75 hover:text-gold transition-all"
                  >
                    {copied === "Chave PIX" ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                  </button>
                )}
              </div>
              {normalizedPreview && normalizedPreview !== pixForm.chavePix.trim() && (
                <p className="font-body text-[10.5px] text-gold/80 mt-1">
                  Formato no QR Code: <span className="font-semibold">{normalizedPreview}</span>
                </p>
              )}
            </div>

            {/* Nome do Titular */}
            <div>
              <label className="font-body text-[11px] text-primary-foreground/75 mb-1.5 block">
                Nome do Titular / Recebedor (aparece no banco da cliente)
              </label>
              <input
                type="text"
                maxLength={25}
                value={pixForm.titular}
                onChange={(e) => setPixForm((p) => ({ ...p, titular: e.target.value }))}
                placeholder={DEFAULT_PIX_MERCHANT_NAME}
                className="w-full rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.08] py-2.5 px-3 text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/45 focus:outline-none focus:ring-2 focus:ring-gold/25"
              />
            </div>

            {/* WhatsApp para receber comprovantes */}
            <div>
              <label className="font-body text-[11px] text-primary-foreground/75 mb-1.5 flex items-center gap-1.5">
                <WhatsAppIcon className="h-3.5 w-3.5 text-[#25d366]" />
                WhatsApp para enviar o comprovante
              </label>
              <input
                type="tel"
                value={pixForm.whatsappComprovante}
                onChange={(e) => setPixForm((p) => ({ ...p, whatsappComprovante: formatWhatsappMask(e.target.value) }))}
                placeholder="(48) 99977-9829"
                className="w-full rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.08] py-2.5 px-3 text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/45 focus:outline-none focus:ring-2 focus:ring-gold/25"
              />
              <p className="font-body text-[10px] text-primary-foreground/60 mt-1">
                Ao escolher PIX no agendamento, o horário já fica confirmado como pagamento pendente e aparece o botão "Enviar comprovante no WhatsApp" para este número.
              </p>
            </div>

            <button
              type="button"
              onClick={handleSavePixDireto}
              disabled={savingKey === "pix_direto"}
              className="w-full flex items-center justify-center gap-2 rounded-xl bg-gold py-3 font-body text-[13px] font-semibold text-charcoal transition-all hover:bg-gold/90 disabled:opacity-50"
            >
              <Save className="h-4 w-4" />
              {savingKey === "pix_direto" ? "Salvando..." : "Salvar Chave PIX"}
            </button>
          </div>
        )}
      </div>

      {/* Gateways automáticos (opcionais para futuro) */}
      {GATEWAYS.map((gw) => {
        const cfg = configs[gw.key];
        const form = forms[gw.key];
        if (!cfg || !form) return null;
        const isExpanded = expanded[gw.key] === true;
        const tokenVisible = showToken[gw.key] || false;

        return (
          <div key={gw.key} className="rounded-2xl border border-primary-foreground/[0.06] bg-primary-foreground/[0.03] overflow-hidden">
            <button
              type="button"
              onClick={() => setExpanded((p) => ({ ...p, [gw.key]: !isExpanded }))}
              className="w-full flex items-center justify-between p-4 border-b border-primary-foreground/[0.06] hover:bg-primary-foreground/[0.02] transition-all"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${gw.color}15` }}>
                  <gw.icon className="h-5 w-5" style={{ color: gw.color }} />
                </div>
                <div className="text-left">
                  <h3 className="font-heading text-[14px] font-semibold text-primary-foreground">{gw.label} (Gateway)</h3>
                  <p className="font-body text-[11px] text-primary-foreground/75">
                    {form.ativo ? "Ativo" : "Inativo · Opcional"}
                    {form.ativo && (
                      <span className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-green-400 animate-pulse" />
                    )}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div
                  onClick={(e) => { e.stopPropagation(); updateForm(gw.key, "ativo", !form.ativo); }}
                  className={`w-11 h-6 rounded-full relative transition-all duration-200 cursor-pointer ${form.ativo ? "bg-green-500" : "bg-primary-foreground/10"}`}
                >
                  <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${form.ativo ? "left-5" : "left-0.5"}`} />
                </div>
                {isExpanded ? <ChevronUp className="h-4 w-4 text-primary-foreground/75" /> : <ChevronDown className="h-4 w-4 text-primary-foreground/75" />}
              </div>
            </button>

            {isExpanded && (
              <div className="p-4 space-y-4">
                <div>
                  <label className="font-body text-[11px] text-primary-foreground/75 mb-1.5 block">Access Token *</label>
                  <div className="relative">
                    <input
                      type={tokenVisible ? "text" : "password"}
                      value={form.accessToken}
                      onChange={(e) => updateForm(gw.key, "accessToken", e.target.value)}
                      placeholder={gw.tokenPlaceholder}
                      className="w-full rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.06] py-2.5 pl-3 pr-20 text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/45 focus:outline-none focus:ring-2 focus:ring-gold/20"
                    />
                    <div className="absolute right-2 top-1/2 -translate-y-1/2 flex gap-1">
                      <button type="button" onClick={() => setShowToken((p) => ({ ...p, [gw.key]: !tokenVisible }))}
                        className="p-1.5 rounded-lg text-primary-foreground/75 hover:text-primary-foreground transition-all">
                        {tokenVisible ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                      {form.accessToken && (
                        <button type="button" onClick={() => copyToClipboard(form.accessToken, `Token ${gw.label}`)}
                          className="p-1.5 rounded-lg text-primary-foreground/75 hover:text-primary-foreground transition-all">
                          {copied === `Token ${gw.label}` ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                <div>
                  <label className="font-body text-[11px] text-primary-foreground/75 mb-1.5 block">{gw.publicKeyLabel}</label>
                  <input
                    value={form.publicKey}
                    onChange={(e) => updateForm(gw.key, "publicKey", e.target.value)}
                    placeholder={gw.publicKeyPlaceholder}
                    className="w-full rounded-xl bg-primary-foreground/[0.05] border border-primary-foreground/[0.06] py-2.5 px-3 text-primary-foreground font-body text-[13px] placeholder:text-primary-foreground/45 focus:outline-none focus:ring-2 focus:ring-gold/20"
                  />
                </div>

                <div>
                  <label className="font-body text-[11px] text-primary-foreground/75 mb-1.5 block">URL do Webhook</label>
                  <div className="relative">
                    <input
                      readOnly
                      value={cfg.webhook_url || ""}
                      className="w-full rounded-xl bg-primary-foreground/[0.02] border border-primary-foreground/[0.06] py-2.5 pl-3 pr-10 text-primary-foreground/85 font-body text-[12px] cursor-default"
                    />
                    <button
                      type="button"
                      onClick={() => copyToClipboard(cfg.webhook_url || "", `Webhook ${gw.label}`)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-lg text-primary-foreground/75 hover:text-primary-foreground transition-all"
                    >
                      {copied === `Webhook ${gw.label}` ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <p className="font-body text-[10px] text-primary-foreground/60 mt-1">
                    Cole esta URL nas configurações de webhook do {gw.label}
                  </p>
                </div>

                <div>
                  <label className="font-body text-[11px] text-primary-foreground/75 mb-2 block">Métodos de Pagamento</label>
                  <div className="space-y-2">
                    {([
                      { field: "pixEnabled", label: "PIX", desc: "Pagamento instantâneo", icon: PixIcon, show: true },
                      { field: "cartaoEnabled", label: "Cartão de Crédito", desc: "Visa, Master, Elo, etc.", icon: CreditCard, show: gw.supportsCartao },
                      { field: "boletoEnabled", label: "Boleto Bancário", desc: "Compensação em até 3 dias", icon: FileText, show: gw.supportsBoleto },
                    ] as const).filter(m => m.show).map((m) => {
                      const enabled = form[m.field];
                      return (
                        <div key={m.field}
                          className={`flex items-center justify-between rounded-xl border p-3 transition-all ${enabled ? "bg-primary-foreground/[0.04] border-gold/20" : "bg-primary-foreground/[0.02] border-primary-foreground/[0.06]"}`}>
                          <div className="flex items-center gap-2.5">
                            <m.icon className={`h-4 w-4 ${enabled ? "text-gold" : "text-primary-foreground/75"}`} />
                            <div>
                              <p className={`font-body text-[12px] font-medium ${enabled ? "text-primary-foreground" : "text-primary-foreground/75"}`}>{m.label}</p>
                              <p className="font-body text-[10px] text-primary-foreground/60">{m.desc}</p>
                            </div>
                          </div>
                          <button type="button" onClick={() => updateForm(gw.key, m.field, !enabled)}
                            className={`w-10 h-6 rounded-full relative transition-all duration-200 ${enabled ? "bg-gold" : "bg-primary-foreground/10"}`}>
                            <div className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${enabled ? "left-4" : "left-0.5"}`} />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="rounded-xl border border-primary-foreground/[0.06] bg-primary-foreground/[0.02] p-3">
                  <p className="font-body text-[11px] font-medium text-primary-foreground/85 mb-2">📋 Como configurar:</p>
                  <ol className="font-body text-[10px] text-primary-foreground/75 space-y-1 list-decimal list-inside">
                    {gw.helpSteps.map((step, i) => (
                      <li key={i}>{step}</li>
                    ))}
                  </ol>
                  <a href={gw.helpLink} target="_blank" rel="noopener noreferrer"
                    className="mt-2 inline-flex items-center gap-1 font-body text-[10px] hover:text-gold transition-all"
                    style={{ color: `${gw.color}cc` }}>
                    <ExternalLink className="h-3 w-3" /> {gw.helpLinkLabel}
                  </a>
                </div>

                <button type="button" onClick={() => handleSave(gw.key)} disabled={savingKey === gw.key}
                  className="w-full flex items-center justify-center gap-2 rounded-xl bg-gold py-3 font-body text-[13px] font-semibold text-charcoal transition-all hover:bg-gold/90 disabled:opacity-50">
                  <Save className="h-4 w-4" />
                  {savingKey === gw.key ? "Salvando..." : "Salvar Configuração"}
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

export default GatewayTab;
