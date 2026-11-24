import { useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, User } from 'firebase/auth';
import {
  Check,
  CheckCircle2,
  Clapperboard,
  Copy,
  Expand,
  ExternalLink,
  KeyRound,
  Lock,
  LogOut,
  Maximize2,
  MessageCircle,
  Minimize2,
  Play,
  QrCode,
  Radio,
  Square,
  Tv,
  UserCheck,
  Volume2,
  VolumeX,
  Wifi,
} from 'lucide-react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import {
  setAdminPasscodeToken,
  subscribeAdminPasscodeToken,
} from '../lib/adminMemorySession';
import {
  auth,
  isAuthorizedAdminUser,
  signInWithGoogleAccount,
  signOutGoogleAccount,
} from '../lib/firebase';
import {
  buildCustomerPaymentWhatsappHref,
  buildWhatsappSendCodeHref,
  getSavedCustomerPreRegistration,
  getSavedOfflineLicenseState,
  OfflineLicenseState,
  reportDeviceHeartbeat,
  saveCustomerPreRegistration,
  verifyAndSaveOfflineKey,
} from '../lib/offlineLicense';
import { AppSettingsDoc, PlanItem, sanitizePixQrCodeUrl } from '../lib/storeCatalog';
import { formatDatePtBr } from '../types';
import { AdminPasscodeForm } from './AdminPasscodeForm';
import { CinemaAdminSection, CinemaSessionItem } from './CinemaAdminSection';
import { CinemaClientView } from './CinemaClientView';
import { DeveloperMessageBox } from './DeveloperMessageBox';
import { DistributionCard } from './DistributionCard';
import { LiveBroadcastPanel } from './LiveBroadcastPanel';
import { MengaoShield } from './MengaoShield';
import { SubscriberView } from './SubscriberView';
import { TvAutoInstallBanner } from './TvAutoInstallModal';

interface AppShellViewProps {
  settings: AppSettingsDoc;
  plans: PlanItem[];
}

type ScreenSizeMode = 'small' | 'medium' | 'large';
type ScreenFitMode = 'contain' | 'cover';

interface LiveStatusSnapshot {
  isLive: boolean;
  title: string;
  matchMode?: 'flamengo' | 'outro_jogo';
  sourceApp: string;
  hasAudio: boolean;
  sampleRate: number;
  startedAt?: string | null;
  viewerCount: number;
}

export function AppShellView({ settings, plans }: AppShellViewProps) {
  const { detectedPlatform, isSmartTv, isAndroidTV, isWebOS, openTvAppMode } = usePWAInstall();
  const isTvDevice = isSmartTv || isAndroidTV || isWebOS;
  const activePlans = plans.filter((p) => p.active);

  const [appTab, setAppTab] = useState<'player' | 'cinema' | 'conta' | 'admin'>(() => {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      if (params.get('admin') === '1') return 'admin';
      if (params.get('tab') === 'cinema') return 'cinema';
    }
    return 'player';
  });
  const [sourceMode, setSourceMode] = useState<'live_server' | 'lan_wifi'>('live_server');
  const [showTvLanDrawer, setShowTvLanDrawer] = useState(false);
  const [hostAddress, setHostAddress] = useState('http://192.168.1.50:8080');
  const [streamToken, setStreamToken] = useState('');
  const [streamMode, setStreamMode] = useState<'idle' | 'live' | 'error'>('idle');
  const [streamError, setStreamError] = useState<string | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [screenSizeMode, setScreenSizeMode] = useState<ScreenSizeMode>(() => {
    try {
      const saved = localStorage.getItem('mengao_player_screen_size');
      if (saved === 'small' || saved === 'medium' || saved === 'large') return saved;
    } catch {
      // ignore
    }
    return 'large';
  });
  const [screenFitMode, setScreenFitMode] = useState<ScreenFitMode>(() => {
    try {
      const saved = localStorage.getItem('mengao_player_screen_fit');
      if (saved === 'contain' || saved === 'cover') return saved;
    } catch {
      // ignore
    }
    return 'contain';
  });
  const [controlsVisible, setControlsVisible] = useState(true);
  const [audioMuted, setAudioMuted] = useState(false);
  const [audioSuspended, setAudioSuspended] = useState(false);
  const [userStoppedLive, setUserStoppedLive] = useState(false);

  const [liveStatus, setLiveStatus] = useState<LiveStatusSnapshot | null>(null);
  const [cinemaSessions, setCinemaSessions] = useState<CinemaSessionItem[]>([]);

  // Admin auth state inside App (Google OR Senha Admin)
  const [googleUser, setGoogleUser] = useState<User | null>(null);
  const [adminIdToken, setAdminIdToken] = useState<string | null>(null);
  const [passcodeToken, setPasscodeToken] = useState<string | null>(null);
  const [adminAuthLoading, setAdminAuthLoading] = useState(false);
  const [adminAuthError, setAdminAuthError] = useState<string | null>(null);
  const isGoogleAdmin = isAuthorizedAdminUser(googleUser);
  const isAuthorizedAdmin = isGoogleAdmin || Boolean(passcodeToken);

  async function getAdminToken(): Promise<string | null> {
    if (googleUser && isGoogleAdmin) {
      try {
        return await googleUser.getIdToken();
      } catch {
        return passcodeToken;
      }
    }
    return passcodeToken;
  }

  const [offlineLicense, setOfflineLicense] = useState<OfflineLicenseState | null>(null);
  const [selectedRenewalPlan, setSelectedRenewalPlan] = useState<string>(
    activePlans[0]?.name || '1 Mês'
  );
  const [customValidity, setCustomValidity] = useState('');
  const [customerName, setCustomerName] = useState('');
  const [customerWhatsapp, setCustomerWhatsapp] = useState('');
  const [paymentSending, setPaymentSending] = useState(false);
  const [paymentError, setPaymentError] = useState<string | null>(null);
  const [paymentSentHref, setPaymentSentHref] = useState<string | null>(null);

  const [keyInput, setKeyInput] = useState('');
  const [keyError, setKeyError] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);
  const [copiedPix, setCopiedPix] = useState(false);

  const stageRef = useRef<HTMLDivElement | null>(null);
  const hideControlsTimerRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const wsViewerRef = useRef<WebSocket | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const nextAudioTimeRef = useRef<number>(0);
  const sampleRateRef = useRef<number>(24000);
  const audioMutedRef = useRef<boolean>(false);
  audioMutedRef.current = audioMuted;
  const lastAutoStartedAtRef = useRef<string | null>(null);
  const streamModeRef = useRef<'idle' | 'live' | 'error'>('idle');
  streamModeRef.current = streamMode;

  function updateScreenSize(mode: ScreenSizeMode) {
    setScreenSizeMode(mode);
    try {
      localStorage.setItem('mengao_player_screen_size', mode);
    } catch {
      // ignore
    }
    pingPlayerControls();
  }

  function updateScreenFit(fit: ScreenFitMode) {
    setScreenFitMode(fit);
    try {
      localStorage.setItem('mengao_player_screen_fit', fit);
    } catch {
      // ignore
    }
    pingPlayerControls();
  }

  function pingPlayerControls(forceShow = true) {
    if (forceShow) setControlsVisible(true);
    if (hideControlsTimerRef.current) {
      window.clearTimeout(hideControlsTimerRef.current);
    }
    hideControlsTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 3600);
  }

  useEffect(() => {
    void getSavedCustomerPreRegistration().then((saved) => {
      if (saved.customerName) setCustomerName((prev) => prev || saved.customerName);
      if (saved.customerWhatsapp) setCustomerWhatsapp((prev) => prev || saved.customerWhatsapp);
    });
    const unsubPasscode = subscribeAdminPasscodeToken(setPasscodeToken);
    const unsub = onAuthStateChanged(auth, (user) => {
      setGoogleUser(user);
      if (user && isAuthorizedAdminUser(user)) {
        void user.getIdToken().then(setAdminIdToken).catch(() => setAdminIdToken(null));
      } else {
        setAdminIdToken(null);
      }
    });
    return () => {
      unsubPasscode();
      unsub();
    };
  }, []);

  useEffect(() => {
    const loadLiveStatus = () => {
      fetch('/api/live/status')
        .then((res) => (res.ok ? res.json() : null))
        .then((data: LiveStatusSnapshot | null) => {
          if (data) setLiveStatus(data);
        })
        .catch(() => undefined);
    };
    const loadCinemaSchedule = () => {
      fetch('/api/cinema/schedule', { cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: { sessions?: CinemaSessionItem[] } | null) => {
          if (data && Array.isArray(data.sessions)) {
            setCinemaSessions(data.sessions);
          }
        })
        .catch(() => undefined);
    };

    loadLiveStatus();
    loadCinemaSchedule();
    const liveId = window.setInterval(loadLiveStatus, 2500);
    const cinemaPollId = window.setInterval(loadCinemaSchedule, 25000);
    window.addEventListener('mengao-catalog-refresh', loadCinemaSchedule);
    return () => {
      window.clearInterval(liveId);
      window.clearInterval(cinemaPollId);
      window.removeEventListener('mengao-catalog-refresh', loadCinemaSchedule);
      if (hideControlsTimerRef.current) {
        window.clearTimeout(hideControlsTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const refreshLicense = () => {
      getSavedOfflineLicenseState().then((state) => {
        setOfflineLicense(state);
        if (!state.ativo && !isAuthorizedAdmin) {
          disconnectStream();
        }
        void reportDeviceHeartbeat({
          deviceCode: state.deviceCode,
          platform: detectedPlatform,
          isTv: isTvDevice,
          licenseActive: state.ativo,
          planName: state.plano,
          isStreaming: streamModeRef.current === 'live',
        });
      });
    };

    refreshLicense();

    const intervalId = window.setInterval(refreshLicense, 30000);
    window.addEventListener('focus', refreshLicense);
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      window.clearInterval(intervalId);
      window.removeEventListener('focus', refreshLicense);
      document.removeEventListener('fullscreenchange', onFsChange);
      disconnectStream();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detectedPlatform, isTvDevice, isAuthorizedAdmin]);

  const isAppUnlocked = Boolean(offlineLicense?.ativo) || isAuthorizedAdmin;
  const chosenPlan = activePlans.find((p) => p.name === selectedRenewalPlan) || activePlans[0];
  const retransmissionBlockedForNonTv =
    settings.tvOnlyAntiRetransmission && !isTvDevice && !isAuthorizedAdmin;

  // Entra automaticamente na live (vídeo + áudio, sem comentários) quando o admin inicia transmissão
  useEffect(() => {
    if (!liveStatus?.isLive) {
      lastAutoStartedAtRef.current = null;
      setUserStoppedLive(false);
      return;
    }
    if (liveStatus.sampleRate) {
      sampleRateRef.current = liveStatus.sampleRate;
    }
    const broadcastKey = liveStatus.startedAt || 'active';
    if (lastAutoStartedAtRef.current !== broadcastKey) {
      lastAutoStartedAtRef.current = broadcastKey;
      setUserStoppedLive(false);
    }
    if (
      isAppUnlocked &&
      appTab === 'player' &&
      sourceMode === 'live_server' &&
      streamMode === 'idle' &&
      !userStoppedLive
    ) {
      void connectToLiveServerStream();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAppUnlocked, appTab, sourceMode, liveStatus?.isLive, liveStatus?.startedAt, streamMode, userStoppedLive]);

  async function handleAdminSignIn() {
    setAdminAuthError(null);
    setAdminAuthLoading(true);
    try {
      const user = await signInWithGoogleAccount();
      if (!isAuthorizedAdminUser(user)) {
        setAdminAuthError(
          `A conta ${user.email || 'selecionada'} não é a conta administradora autorizada.`
        );
      }
    } catch (err) {
      setAdminAuthError(err instanceof Error ? err.message : 'Falha ao conectar com Google.');
    } finally {
      setAdminAuthLoading(false);
    }
  }

  async function handleAdminSignOut() {
    setAdminPasscodeToken(null);
    if (googleUser) {
      await signOutGoogleAccount().catch(() => undefined);
    }
  }

  async function handleConfirmLockPayment() {
    setPaymentError(null);
    const cleanName = customerName.trim();
    const cleanDigits = customerWhatsapp.replace(/\D/g, '');
    if (cleanName.length < 2) {
      setPaymentError('Informe seu nome completo no pré-cadastro antes de confirmar.');
      return;
    }
    if (cleanDigits.length < 10) {
      setPaymentError('Informe seu WhatsApp com DDD (ex: 21999999999) para receber a chave.');
      return;
    }
    if (!offlineLicense?.deviceCode) {
      setPaymentError('Aguarde a geração do código exclusivo deste aparelho.');
      return;
    }

    const whatsappHref = buildCustomerPaymentWhatsappHref({
      customerName: cleanName,
      customerWhatsapp: cleanDigits,
      deviceCode: offlineLicense.deviceCode,
      adminWhatsapp: settings.whatsappNumber,
      expired: Boolean(offlineLicense.expira_em),
      selectedPlan: selectedRenewalPlan,
      customValidity,
      priceText: chosenPlan?.priceText,
    });

    setPaymentSending(true);
    try {
      await saveCustomerPreRegistration({
        customerName: cleanName,
        customerWhatsapp: cleanDigits,
      });

      const res = await fetch('/api/clientes/pagamento-informado', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        keepalive: true,
        body: JSON.stringify({
          customerName: cleanName,
          customerWhatsapp: cleanDigits,
          deviceCode: offlineLicense.deviceCode,
          planName: selectedRenewalPlan,
          planPrice: chosenPlan?.priceText || 'Sob consulta',
          customValidity,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPaymentError(data.erro || 'Não foi possível registrar seu pagamento.');
        return;
      }

      setPaymentSentHref(whatsappHref);

      const anchor = document.createElement('a');
      anchor.href = whatsappHref;
      anchor.target = '_blank';
      anchor.rel = 'noopener noreferrer';
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } catch {
      setPaymentError('Falha de rede ao registrar seu pedido. Tente novamente.');
    } finally {
      setPaymentSending(false);
    }
  }

  async function handleOfflineUnlock(e: React.FormEvent) {
    e.preventDefault();
    setKeyError(null);
    const result = await verifyAndSaveOfflineKey(keyInput);
    setOfflineLicense(result);
    if (result.ativo) {
      setKeyInput('');
      void reportDeviceHeartbeat({
        deviceCode: result.deviceCode,
        platform: detectedPlatform,
        isTv: isTvDevice,
        licenseActive: true,
        planName: result.plano,
        isStreaming: false,
      });
    } else {
      setKeyError(result.motivo || 'Chave inválida para este aparelho.');
    }
  }

  async function toggleFullscreenGameMode(targetEl?: HTMLElement | null) {
    const el = targetEl || stageRef.current;
    if (!document.fullscreenElement) {
      await el?.requestFullscreen?.();
      try {
        const orientation = screen.orientation as unknown as {
          lock?: (mode: string) => Promise<void>;
        };
        await orientation?.lock?.('landscape');
      } catch {
        // Ignorado em dispositivos desktop
      }
    } else {
      await document.exitFullscreen?.();
      try {
        const orientation = screen.orientation as unknown as { unlock?: () => void };
        orientation?.unlock?.();
      } catch {
        // ignore
      }
    }
    pingPlayerControls();
  }

  function disconnectStream() {
    abortRef.current?.abort();
    abortRef.current = null;
    if (wsViewerRef.current) {
      try {
        wsViewerRef.current.close();
      } catch {
        // ignore
      }
      wsViewerRef.current = null;
    }
    if (gainNodeRef.current) {
      try {
        gainNodeRef.current.disconnect();
      } catch {
        // ignore
      }
      gainNodeRef.current = null;
    }
    if (audioCtxRef.current) {
      void audioCtxRef.current.close().catch(() => undefined);
      audioCtxRef.current = null;
    }
    nextAudioTimeRef.current = 0;
    setAudioSuspended(false);
    setStreamMode('idle');
    setStreamError(null);
  }

  async function unlockAndToggleMute(forceUnmute = false) {
    const ctx = audioCtxRef.current;
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume().catch(() => undefined);
      setAudioSuspended(ctx.state === 'suspended');
      if (forceUnmute) {
        setAudioMuted(false);
        if (gainNodeRef.current) {
          gainNodeRef.current.gain.value = 1;
        }
        return;
      }
    }
    const nextMuted = forceUnmute ? false : !audioMuted;
    setAudioMuted(nextMuted);
    if (gainNodeRef.current) {
      gainNodeRef.current.gain.value = nextMuted ? 0 : 1;
    }
  }

  async function connectToLiveServerStream() {
    disconnectStream();
    setStreamError(null);
    setUserStoppedLive(false);

    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}/ws/live`);
    ws.binaryType = 'arraybuffer';
    wsViewerRef.current = ws;
    setStreamMode('live');

    const freshAdminToken = await getAdminToken();
    sampleRateRef.current = liveStatus?.sampleRate || 24000;

    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      const ctx = new AudioCtx({ sampleRate: sampleRateRef.current });
      const gain = ctx.createGain();
      gain.gain.value = audioMutedRef.current ? 0 : 1;
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      gainNodeRef.current = gain;
      nextAudioTimeRef.current = 0;
      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => undefined);
      }
      setAudioSuspended(ctx.state === 'suspended');
    }

    ws.onopen = () => {
      ws.send(
        JSON.stringify({
          type: 'auth:viewer',
          adminToken: freshAdminToken || '',
          deviceCode: offlineLicense?.deviceCode || '',
          activationKey: offlineLicense?.activationKey || '',
        })
      );
    };

    ws.onmessage = async (event) => {
      if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data) as {
            type?: string;
            erro?: string;
            state?: LiveStatusSnapshot;
          };
          if (msg.type === 'app:update') {
            window.dispatchEvent(new Event('mengao-catalog-refresh'));
            return;
          }
          if (msg.type === 'auth:error') {
            setStreamMode('error');
            setStreamError(msg.erro || 'Assinatura necessária para assistir ao vivo.');
            return;
          }
          if (msg.state) {
            setLiveStatus(msg.state);
            if (msg.state.sampleRate) {
              sampleRateRef.current = msg.state.sampleRate;
            }
          }
        } catch {
          // ignore
        }
        return;
      }

      const buf = new Uint8Array(event.data as ArrayBuffer);
      if (buf.length < 2) return;
      const kind = buf[0];

      if (kind === 0x01) {
        const jpegSlice = buf.slice(1);
        const blob = new Blob([jpegSlice], { type: 'image/jpeg' });
        try {
          const bitmap = await createImageBitmap(blob);
          const canvas = canvasRef.current;
          if (canvas) {
            if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
              canvas.width = bitmap.width;
              canvas.height = bitmap.height;
            }
            canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
          }
          bitmap.close();
        } catch {
          // ignore corrupted frame
        }
      } else if (kind === 0x02 && audioCtxRef.current) {
        const ctx = audioCtxRef.current;
        if (ctx.state === 'suspended') {
          setAudioSuspended(true);
          return;
        }
        if (audioSuspended) {
          setAudioSuspended(false);
        }
        const pcmBytes = buf.slice(1);
        const samplesCount = Math.floor(pcmBytes.byteLength / 2);
        if (samplesCount === 0) return;
        const view = new DataView(pcmBytes.buffer, pcmBytes.byteOffset, pcmBytes.byteLength);
        const audioBuffer = ctx.createBuffer(1, samplesCount, sampleRateRef.current || 24000);
        const channel = audioBuffer.getChannelData(0);
        for (let i = 0; i < samplesCount; i += 1) {
          channel[i] = view.getInt16(i * 2, true) / 32768;
        }
        const src = ctx.createBufferSource();
        src.buffer = audioBuffer;
        src.connect(gainNodeRef.current || ctx.destination);
        const now = ctx.currentTime;
        const startAt = Math.max(now, nextAudioTimeRef.current);
        src.start(startAt);
        nextAudioTimeRef.current = startAt + audioBuffer.duration;
      }
    };

    ws.onerror = () => {
      setStreamMode('error');
      setStreamError('Não foi possível conectar à transmissão ao vivo do servidor.');
    };

    ws.onclose = () => {
      if (streamModeRef.current === 'live') {
        setStreamMode('idle');
      }
    };
  }

  async function connectToHostStream() {
    disconnectStream();
    setStreamError(null);

    if (retransmissionBlockedForNonTv) {
      setStreamMode('error');
      setStreamError(
        'Proteção Anti-Retransmissão ativa: a retransmissão entre aparelhos é permitida apenas para Smart TVs (Android TV ou LG webOS).'
      );
      return;
    }

    const cleanHost = hostAddress.trim().replace(/\/$/, '');
    const cleanToken = streamToken.trim();
    if (!cleanHost || !cleanToken) {
      setStreamError('Informe o IP local do aparelho transmissor e o token da sessão.');
      setStreamMode('error');
      return;
    }

    const controller = new AbortController();
    abortRef.current = controller;
    setStreamMode('live');

    if (offlineLicense?.deviceCode) {
      void reportDeviceHeartbeat({
        deviceCode: offlineLicense.deviceCode,
        platform: detectedPlatform,
        isTv: isTvDevice,
        licenseActive: Boolean(offlineLicense.ativo),
        planName: offlineLicense.plano,
        isStreaming: true,
      });
    }

    try {
      const url = `${cleanHost}/stream?token=${encodeURIComponent(cleanToken)}`;
      const res = await fetch(url, {
        headers: {
          'X-TelaCast-App': isWebOS ? 'TelaCast-LG-webOS/1.0' : 'TelaCast-TV-App/1.0',
          'X-Device-Type': isTvDevice ? 'tv' : 'mobile',
        },
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        setStreamMode('error');
        setStreamError(
          `Conexão recusada (HTTP ${res.status}). Verifique o IP, o token e se este aparelho é uma TV autorizada.`
        );
        return;
      }

      const reader = res.body.getReader();
      let buffer = new Uint8Array(0);

      while (!controller.signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value) continue;

        const merged = new Uint8Array(buffer.length + value.length);
        merged.set(buffer);
        merged.set(value, buffer.length);
        buffer = merged;

        let start = -1;
        for (let i = 0; i < buffer.length - 1; i += 1) {
          if (buffer[i] === 0xff && buffer[i + 1] === 0xd8) {
            start = i;
            break;
          }
        }
        if (start === -1) continue;

        let end = -1;
        for (let i = start + 2; i < buffer.length - 1; i += 1) {
          if (buffer[i] === 0xff && buffer[i + 1] === 0xd9) {
            end = i + 2;
            break;
          }
        }
        if (end === -1) continue;

        const jpegSlice = buffer.slice(start, end);
        buffer = buffer.slice(end);

        const blob = new Blob([jpegSlice], { type: 'image/jpeg' });
        const bitmap = await createImageBitmap(blob);
        const canvas = canvasRef.current;
        if (canvas) {
          if (canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
            canvas.width = bitmap.width;
            canvas.height = bitmap.height;
          }
          canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
        }
        bitmap.close();
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        setStreamMode('error');
        setStreamError('Não foi possível conectar ao transmissor na rede Wi-Fi.');
      }
    }
  }

  const hasCinemaInCartaz = cinemaSessions.length > 0;

  const stageSizeClasses = isFullscreen
    ? 'h-[100dvh] w-screen rounded-none border-0'
    : screenSizeMode === 'small'
      ? 'mx-auto w-full max-w-md h-[29dvh] min-h-[195px] rounded-2xl border border-zinc-800'
      : screenSizeMode === 'medium'
        ? 'mx-auto w-full max-w-4xl h-[46dvh] min-h-[260px] sm:h-[58dvh] rounded-2xl border border-zinc-800'
        : 'w-full h-[68dvh] min-h-[340px] sm:h-[78dvh] rounded-xl border border-zinc-800/80';

  return (
    <div
      className="min-h-[100dvh] flex flex-col bg-[#050507] text-zinc-100 select-none"
      onContextMenu={(e) => e.preventDefault()}
    >
      <TvAutoInstallBanner onOpenAppMode={openTvAppMode} />
      <header className="sticky top-0 z-30 border-b border-zinc-900 bg-[#050507]/95 backdrop-blur">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6 h-14">
          <div className="flex items-center gap-2.5 shrink-0">
            <MengaoShield className="h-7 w-7 shrink-0" />
            <span className="font-display text-lg font-bold tracking-tight text-white whitespace-nowrap">
              {settings.appName}
            </span>
          </div>

          <nav className="flex items-center gap-5 overflow-x-auto text-sm font-medium">
            <button
              type="button"
              onClick={() => setAppTab('player')}
              className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                appTab === 'player'
                  ? 'border-[#C8102E] text-white font-semibold'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              Ao Vivo
            </button>
            <button
              type="button"
              onClick={() => setAppTab('cinema')}
              className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer ${
                appTab === 'cinema'
                  ? 'border-[#C8102E] text-white font-semibold'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              <Clapperboard className="h-3.5 w-3.5" />
              Cinema
            </button>
            <button
              type="button"
              onClick={() => setAppTab('conta')}
              className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                appTab === 'conta'
                  ? 'border-[#C8102E] text-white font-semibold'
                  : 'border-transparent text-zinc-400 hover:text-white'
              }`}
            >
              {isAppUnlocked ? 'Minha Conta' : 'Ativar Acesso'}
            </button>
            {isAuthorizedAdmin && (
              <button
                type="button"
                onClick={() => setAppTab('admin')}
                className={`py-1.5 border-b-2 transition-colors whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 cursor-pointer ${
                  appTab === 'admin'
                    ? 'border-[#C8102E] text-white font-semibold'
                    : 'border-transparent text-zinc-400 hover:text-white'
                }`}
              >
                <Radio className="h-3.5 w-3.5 text-[#C8102E]" />
                Admin
              </button>
            )}
          </nav>

          <div className="flex items-center gap-3 shrink-0">
            {offlineLicense?.ativo && (
              <span className="hidden sm:inline font-mono text-xs text-zinc-400 tabular-nums">
                {offlineLicense.dias_restantes}d restantes
              </span>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        {appTab === 'admin' ? (
          <div className="mx-auto max-w-5xl px-4 py-6 sm:px-5 sm:py-8 space-y-6">
            {!isAuthorizedAdmin ? (
              <AdminPasscodeForm
                title="Função Admin · Transmitir Ao Vivo"
                subtitle="Entre com sua Conta Google Admin ou Senha de Administrador"
                googleUser={googleUser}
                authLoading={adminAuthLoading}
                authError={adminAuthError}
                onGoogleSignIn={handleAdminSignIn}
              />
            ) : (
              <>
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-800 pb-4">
                  <div>
                    <h1 className="font-display text-2xl font-bold text-white">
                      Central Admin de Transmissão no App
                    </h1>
                    <p className="text-xs text-zinc-400">
                      {isGoogleAdmin
                        ? `Admin conectado via Google: ${googleUser?.email}`
                        : 'Admin conectado via Senha de Administrador'}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {!isGoogleAdmin && (
                      <button
                        type="button"
                        onClick={handleAdminSignIn}
                        disabled={adminAuthLoading}
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 cursor-pointer"
                      >
                        {adminAuthLoading ? 'Conectando...' : 'Conectar também conta Google'}
                      </button>
                    )}
                    {!isGoogleAdmin && typeof window !== 'undefined' && window.self !== window.top && (
                      <a
                        href={window.location.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-[#C8102E]" />
                        Abrir em nova aba
                      </a>
                    )}
                    <button
                      type="button"
                      onClick={handleAdminSignOut}
                      className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                    >
                      <LogOut className="h-3.5 w-3.5" />
                      Sair
                    </button>
                  </div>
                </div>

                {adminAuthError && (
                  <div className="flex flex-col gap-2 rounded-xl border border-red-900/60 bg-red-950/60 p-3.5 text-xs text-red-200 sm:flex-row sm:items-center sm:justify-between">
                    <span>{adminAuthError}</span>
                    {typeof window !== 'undefined' && (
                      <a
                        href={window.location.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-red-800/80 bg-zinc-950 px-3 py-1.5 font-semibold text-white hover:bg-zinc-900"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-[#C8102E]" />
                        Abrir em nova aba para Login Google
                      </a>
                    )}
                  </div>
                )}

                <LiveBroadcastPanel getAdminToken={getAdminToken} appName={settings.appName} />
                <CinemaAdminSection getAdminToken={getAdminToken} />
                <DistributionCard
                  appName={settings.appName}
                  adminToken={adminIdToken || passcodeToken}
                />
              </>
            )}
          </div>
        ) : appTab === 'conta' ? (
          <div className="space-y-6">
            <SubscriberView settings={settings} plans={plans} />
            <div className="mx-auto max-w-5xl px-6 pb-8 flex justify-end">
              <button
                type="button"
                onClick={() => setAppTab('admin')}
                className="inline-flex items-center gap-1.5 text-xs text-zinc-500 hover:text-zinc-300 cursor-pointer"
              >
                <Lock className="h-3 w-3" />
                Acesso Administrativo
              </button>
            </div>
          </div>
        ) : appTab === 'cinema' ? (
          <CinemaClientView
            settings={settings}
            isAdmin={isAuthorizedAdmin}
            getAdminToken={getAdminToken}
          />
        ) : !isAppUnlocked ? (
          <div className="mx-auto max-w-lg px-6 py-10 space-y-6">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-7 space-y-5">
              <div className="flex items-center gap-3">
                <MengaoShield className="h-9 w-9 shrink-0" />
                <div>
                  <h1 className="font-display text-xl font-bold text-white">
                    Ativação Offline · {settings.appName}
                  </h1>
                  <p className="text-xs text-zinc-400">
                    Liberação exclusiva vinculada a este aparelho
                  </p>
                </div>
              </div>

              <p className="text-sm text-zinc-300">
                {offlineLicense?.expira_em
                  ? `Sua assinatura venceu em ${formatDatePtBr(offlineLicense.expira_em)}. Preencha seu pré-cadastro, pague via Pix (chave ou QR Code), toque em Já efetuei o pagamento e cole a nova chave.`
                  : 'Este aparelho possui um código único que impede repasse a terceiros. Preencha seu pré-cadastro, faça o Pix e confirme o pagamento para receber sua chave no WhatsApp.'}
              </p>

              {/* Pré-Cadastro Obrigatório */}
              <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5 space-y-2.5">
                <div className="flex items-center gap-2 text-xs font-semibold text-white">
                  <UserCheck className="h-4 w-4 text-[#C8102E]" />
                  <span>Pré-Cadastro (Nome e WhatsApp para liberação)</span>
                </div>
                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={80}
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    placeholder="Seu nome completo"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white focus:border-[#C8102E] focus:outline-none"
                  />
                  <input
                    type="tel"
                    required
                    maxLength={20}
                    value={customerWhatsapp}
                    onChange={(e) => setCustomerWhatsapp(e.target.value)}
                    placeholder="WhatsApp com DDD"
                    className="w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-white focus:border-[#C8102E] focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-2.5">
                <p className="text-xs font-medium text-zinc-300">
                  Escolha o plano desejado
                </p>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {activePlans.map((plan) => (
                    <button
                      key={plan.id}
                      type="button"
                      onClick={() => setSelectedRenewalPlan(plan.name)}
                      className={`rounded-lg border px-2.5 py-2 text-left text-xs transition-colors ${
                        selectedRenewalPlan === plan.name
                          ? 'border-[#C8102E] bg-[#C8102E]/20 text-white'
                          : 'border-zinc-700 bg-zinc-950 text-zinc-300 hover:border-zinc-500'
                      }`}
                    >
                      <div className="font-semibold">{plan.name}</div>
                      <div className="font-mono text-[11px] text-zinc-300 tabular-nums">
                        {plan.priceText}
                      </div>
                    </button>
                  ))}
                </div>

                {selectedRenewalPlan === 'Outros' && (
                  <div className="pt-1">
                    <label className="block text-[11px] font-medium text-zinc-300">
                      Qual validade você deseja? (ex: 15 dias, 2 meses ou até 20/01/2027)
                    </label>
                    <input
                      type="text"
                      value={customValidity}
                      onChange={(e) => setCustomValidity(e.target.value)}
                      placeholder="Ex: 45 dias ou até 20/01/2027"
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-xs text-white focus:border-[#C8102E] focus:outline-none"
                    />
                  </div>
                )}
              </div>

              {(settings.pixKey || sanitizePixQrCodeUrl(settings.pixQrCodeDataUrl)) && (
                <div className="rounded-lg border border-zinc-800 bg-zinc-950 p-3.5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-start gap-3 min-w-0">
                    {sanitizePixQrCodeUrl(settings.pixQrCodeDataUrl) && (
                      <div className="shrink-0 rounded-md bg-white p-1.5 border border-zinc-700">
                        <img
                          src={sanitizePixQrCodeUrl(settings.pixQrCodeDataUrl)}
                          alt="QR Code Pix"
                          className="h-24 w-24 object-contain"
                        />
                      </div>
                    )}
                    <div className="min-w-0 space-y-1">
                      <p className="flex items-center gap-1.5 text-[11px] text-zinc-400">
                        <QrCode className="h-3.5 w-3.5 text-[#C8102E]" />
                        Pix ({settings.pixType}) · {settings.pixReceiverName}
                      </p>
                      {settings.pixKey && (
                        <p className="font-mono text-xs text-white break-all">{settings.pixKey}</p>
                      )}
                    </div>
                  </div>
                  {settings.pixKey && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(settings.pixKey);
                        setCopiedPix(true);
                        window.setTimeout(() => setCopiedPix(false), 1800);
                      }}
                      className="rounded-md border border-zinc-700 bg-zinc-800 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-zinc-700 shrink-0 self-start sm:self-auto"
                    >
                      {copiedPix ? 'Copiado' : 'Copiar Pix'}
                    </button>
                  )}
                </div>
              )}

              <div className="rounded-lg border border-zinc-700 bg-zinc-950 p-4 space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-[11px] text-zinc-400">Código único deste aparelho</p>
                    <p className="mt-1 font-mono text-lg font-bold text-white tabular-nums">
                      {offlineLicense?.deviceCode || 'Gerando...'}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      if (!offlineLicense?.deviceCode) return;
                      navigator.clipboard?.writeText(offlineLicense.deviceCode);
                      setCopiedCode(true);
                      window.setTimeout(() => setCopiedCode(false), 1800);
                    }}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-800 px-3 py-2 text-xs font-semibold text-white hover:bg-zinc-700"
                  >
                    {copiedCode ? <Check className="h-3.5 w-3.5 text-emerald-400" /> : <Copy className="h-3.5 w-3.5" />}
                    {copiedCode ? 'Copiado' : 'Copiar'}
                  </button>
                </div>

                {paymentError && (
                  <p className="rounded-lg bg-red-950/80 px-3 py-2 text-xs text-red-300">
                    {paymentError}
                  </p>
                )}

                <button
                  type="button"
                  disabled={paymentSending || !offlineLicense?.deviceCode}
                  onClick={handleConfirmLockPayment}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  {paymentSending
                    ? 'Registrando pagamento...'
                    : `Já efetuei o pagamento (${selectedRenewalPlan})`}
                </button>

                {paymentSentHref && (
                  <div className="rounded-lg border border-emerald-800 bg-emerald-950/60 p-3 space-y-2 text-xs text-emerald-100">
                    <p className="font-semibold text-emerald-300">
                      Pedido enviado para a aba Ativação e Renovação do Admin!
                    </p>
                    <a
                      href={paymentSentHref}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-700 py-2 text-xs font-semibold text-white hover:bg-emerald-600"
                    >
                      <MessageCircle className="h-4 w-4" />
                      Enviar comprovante e dados no WhatsApp
                    </a>
                  </div>
                )}

                {offlineLicense?.deviceCode && (
                  <a
                    href={buildWhatsappSendCodeHref(
                      offlineLicense.deviceCode,
                      settings.whatsappNumber,
                      Boolean(offlineLicense.expira_em),
                      selectedRenewalPlan,
                      customValidity,
                      chosenPlan?.priceText
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                  >
                    <MessageCircle className="h-3.5 w-3.5 text-emerald-400" />
                    Dúvidas antes do Pix? Falar no WhatsApp
                  </a>
                )}
              </div>

              <form onSubmit={handleOfflineUnlock} className="space-y-3">
                <label className="block text-xs font-medium text-zinc-300">
                  Chave de liberação
                </label>
                <textarea
                  required
                  rows={3}
                  value={keyInput}
                  onChange={(e) => setKeyInput(e.target.value)}
                  placeholder="Cole a chave TC1... recebida"
                  className="w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-white focus:border-[#C8102E] focus:outline-none"
                />
                {keyError && (
                  <p className="rounded-lg bg-red-950/80 px-3 py-2 text-xs text-red-300">
                    {keyError}
                  </p>
                )}
                <button
                  type="submit"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#C8102E] py-2.5 text-sm font-semibold text-white hover:bg-red-700"
                >
                  <KeyRound className="h-4 w-4" />
                  Liberar aplicativo offline
                </button>
              </form>
            </div>

            <DeveloperMessageBox compact />
          </div>
        ) : (
          <div className="mx-auto max-w-7xl px-2 py-3 sm:px-5 sm:py-5 space-y-4">
            {streamError && (
              <p className="rounded-lg border border-red-900/60 bg-red-950/60 px-4 py-2.5 text-xs text-red-300">
                {streamError}
              </p>
            )}

            {/* Player limpo estilo Netflix com escolha de tamanho de tela pelo cliente */}
            <div
              ref={stageRef}
              onMouseMove={() => pingPlayerControls()}
              onClick={() => pingPlayerControls()}
              className={`relative flex items-center justify-center overflow-hidden bg-black ${stageSizeClasses}`}
            >
              {streamMode === 'live' ? (
                <>
                  <canvas
                    ref={canvasRef}
                    className={
                      screenFitMode === 'cover'
                        ? 'h-full w-full object-cover'
                        : 'h-full w-full object-contain'
                    }
                  />
                  {sourceMode === 'live_server' && audioSuspended && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        void unlockAndToggleMute(true);
                      }}
                      className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-30 inline-flex items-center gap-2 rounded-full bg-[#C8102E] px-5 py-2.5 text-xs font-bold text-white shadow-xl hover:bg-red-700 cursor-pointer"
                    >
                      <Volume2 className="h-4 w-4" />
                      Tocar para ativar o áudio
                    </button>
                  )}

                  {/* Controles flutuantes auto-ocultáveis (somente player do cliente) */}
                  <div
                    className={`absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-t from-black/95 via-black/65 to-transparent px-4 pb-3 pt-10 transition-opacity duration-200 ${
                      controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setUserStoppedLive(true);
                          disconnectStream();
                        }}
                        className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-xs font-semibold text-white hover:bg-white/25 cursor-pointer"
                      >
                        <Square className="h-3.5 w-3.5" />
                        Parar
                      </button>
                      {sourceMode === 'live_server' && (
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            void unlockAndToggleMute(false);
                          }}
                          className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-xs font-semibold text-white hover:bg-white/25 cursor-pointer"
                        >
                          {audioMuted || audioSuspended ? (
                            <>
                              <VolumeX className="h-4 w-4 text-red-400" />
                              <span className="hidden sm:inline">
                                {audioSuspended ? 'Ativar áudio' : 'Sem som'}
                              </span>
                            </>
                          ) : (
                            <>
                              <Volume2 className="h-4 w-4" />
                              <span className="hidden sm:inline">Som</span>
                            </>
                          )}
                        </button>
                      )}
                      {liveStatus?.isLive && (
                        <span className="truncate text-xs font-semibold text-white/90 pl-1">
                          {liveStatus.matchMode === 'outro_jogo' ? 'Outro Jogo · ' : ''}
                          {liveStatus.title}
                        </span>
                      )}
                    </div>

                    <div className="flex items-center gap-1.5 flex-wrap">
                      {(['small', 'medium', 'large'] as const).map((sz) => (
                        <button
                          key={sz}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            updateScreenSize(sz);
                          }}
                          className={`h-9 rounded-lg px-2.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                            screenSizeMode === sz && !isFullscreen
                              ? 'bg-[#C8102E] text-white'
                              : 'bg-white/10 text-zinc-200 hover:bg-white/20'
                          }`}
                        >
                          {sz === 'small' ? 'Pequena' : sz === 'medium' ? 'Média' : 'Grande'}
                        </button>
                      ))}
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          updateScreenFit(screenFitMode === 'cover' ? 'contain' : 'cover');
                        }}
                        className={`inline-flex h-9 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold whitespace-nowrap cursor-pointer ${
                          screenFitMode === 'cover'
                            ? 'bg-white text-black'
                            : 'bg-white/10 text-zinc-200 hover:bg-white/20'
                        }`}
                      >
                        <Expand className="h-3.5 w-3.5" />
                        {screenFitMode === 'cover' ? 'Ajustar' : 'Preencher'}
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleFullscreenGameMode(stageRef.current);
                        }}
                        className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-xs font-semibold text-white hover:bg-white/25 whitespace-nowrap cursor-pointer"
                      >
                        {isFullscreen ? (
                          <>
                            <Minimize2 className="h-3.5 w-3.5" />
                            Sair
                          </>
                        ) : (
                          <>
                            <Maximize2 className="h-3.5 w-3.5" />
                            Tela cheia
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="p-6 sm:p-10 text-center space-y-4 max-w-lg">
                  <Tv className="mx-auto h-11 w-11 text-[#C8102E]" />
                  <h2 className="font-display text-2xl font-bold text-white">
                    {liveStatus?.isLive ? liveStatus.title : settings.appName}
                  </h2>
                  <p className="text-xs sm:text-sm text-zinc-400">
                    {liveStatus?.isLive
                      ? 'Transmissão ao vivo disponível agora.'
                      : 'Quando a transmissão começar, o vídeo inicia automaticamente na sua tela.'}
                  </p>
                  <div className="flex flex-wrap items-center justify-center gap-2.5 pt-1">
                    <button
                      type="button"
                      onClick={() => void connectToLiveServerStream()}
                      className="inline-flex h-11 items-center gap-2 rounded-lg bg-[#C8102E] px-5 text-xs font-semibold text-white hover:bg-red-700 cursor-pointer"
                    >
                      <Play className="h-4 w-4" />
                      {liveStatus?.isLive ? 'Assistir Ao Vivo' : 'Conectar Ao Vivo'}
                    </button>
                    {hasCinemaInCartaz && (
                      <button
                        type="button"
                        onClick={() => setAppTab('cinema')}
                        className="inline-flex h-11 items-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 px-4 text-xs font-semibold text-white hover:bg-zinc-800 cursor-pointer"
                      >
                        <Clapperboard className="h-4 w-4 text-[#C8102E]" />
                        Ver Cinema (CPF)
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Barra simples de tamanho de tela e acesso TV sem poluição visual */}
            <div className="flex flex-wrap items-center justify-between gap-3 px-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs text-zinc-400 mr-1">Tamanho da tela:</span>
                {(['small', 'medium', 'large'] as const).map((sz) => (
                  <button
                    key={sz}
                    type="button"
                    onClick={() => updateScreenSize(sz)}
                    className={`h-9 rounded-lg px-3 text-xs font-semibold transition-colors cursor-pointer ${
                      screenSizeMode === sz && !isFullscreen
                        ? 'bg-[#C8102E] text-white'
                        : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                    }`}
                  >
                    {sz === 'small' ? 'Pequena' : sz === 'medium' ? 'Média' : 'Grande'}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => updateScreenFit(screenFitMode === 'cover' ? 'contain' : 'cover')}
                  className={`h-9 rounded-lg px-3 text-xs font-semibold transition-colors cursor-pointer ${
                    screenFitMode === 'cover'
                      ? 'bg-zinc-100 text-zinc-950'
                      : 'border border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
                  }`}
                >
                  {screenFitMode === 'cover' ? 'Modo Preencher' : 'Preencher Tela'}
                </button>
                <button
                  type="button"
                  onClick={() => void toggleFullscreenGameMode(stageRef.current)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                >
                  <Maximize2 className="h-3.5 w-3.5" />
                  Tela Cheia
                </button>
              </div>

              {(isTvDevice || isAuthorizedAdmin) && (
                <button
                  type="button"
                  onClick={() => setShowTvLanDrawer((prev) => !prev)}
                  className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-900 px-3 text-xs font-medium text-zinc-300 hover:bg-zinc-800 cursor-pointer"
                >
                  <Wifi className="h-3.5 w-3.5" />
                  Wi-Fi Local (TV)
                </button>
              )}
            </div>

            {showTvLanDrawer && (isTvDevice || isAuthorizedAdmin) && (
              <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-4 space-y-3">
                {sourceMode === 'lan_wifi' && retransmissionBlockedForNonTv && (
                  <div className="rounded-lg border border-amber-700/60 bg-amber-950/40 p-3 flex items-start gap-2.5 text-xs text-amber-200">
                    <Lock className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                    <span>
                      Retransmissão Wi-Fi local liberada somente para Smart TVs (Android TV ou LG webOS).
                    </span>
                  </div>
                )}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
                  <div className="md:col-span-5">
                    <label className="block text-xs font-medium text-zinc-400">
                      IP local da TV
                    </label>
                    <input
                      type="url"
                      value={hostAddress}
                      onChange={(e) => setHostAddress(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-white focus:border-[#C8102E] focus:outline-none"
                    />
                  </div>
                  <div className="md:col-span-3">
                    <label className="block text-xs font-medium text-zinc-400">Token</label>
                    <input
                      type="text"
                      value={streamToken}
                      onChange={(e) => setStreamToken(e.target.value)}
                      placeholder="TC-8F4A21"
                      className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 font-mono text-xs text-white focus:border-[#C8102E] focus:outline-none"
                    />
                  </div>
                  <div className="md:col-span-4 flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setSourceMode('lan_wifi');
                        if (streamMode === 'live') {
                          disconnectStream();
                        } else {
                          void connectToHostStream();
                        }
                      }}
                      className="flex-1 inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-[#C8102E] px-4 text-xs font-semibold text-white hover:bg-red-700 cursor-pointer"
                    >
                      <Play className="h-3.5 w-3.5" />
                      Conectar na TV
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
