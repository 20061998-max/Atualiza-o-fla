import { useEffect, useRef, useState } from 'react';
import {
  Check,
  CheckCircle2,
  Clapperboard,
  Clock,
  Copy,
  Expand,
  Lock,
  Maximize2,
  MessageCircle,
  Minimize2,
  Pause,
  Play,
  QrCode,
  Ticket,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { AppSettingsDoc, sanitizePixQrCodeUrl } from '../lib/storeCatalog';
import { CinemaSessionItem, formatCpfInput } from './CinemaAdminSection';

interface CinemaClientViewProps {
  settings: AppSettingsDoc;
  isAdmin?: boolean;
  getAdminToken?: () => Promise<string | null>;
}

interface CinemaTicketSummary {
  id: string;
  sessionId: string;
  movieTitle: string;
  ticketPrice: string;
  status: 'pendente' | 'liberado' | 'revogado';
  expiresAt: string;
}

type ScreenSizeMode = 'small' | 'medium' | 'large';
type ScreenFitMode = 'contain' | 'cover';

function extractYoutubeId(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    const host = parsed.hostname.replace(/^www\./, '').toLowerCase();
    if (host === 'youtu.be') {
      return parsed.pathname.slice(1).split('/')[0] || null;
    }
    if (host === 'youtube.com' || host === 'm.youtube.com') {
      if (parsed.pathname === '/watch') return parsed.searchParams.get('v');
      if (parsed.pathname.startsWith('/embed/')) return parsed.pathname.split('/')[2] || null;
      if (parsed.pathname.startsWith('/shorts/')) return parsed.pathname.split('/')[2] || null;
      if (parsed.pathname.startsWith('/live/')) return parsed.pathname.split('/')[2] || null;
    }
  } catch {
    return null;
  }
  return null;
}

function formatClockTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

function formatDateTimeShort(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatScheduleCountdown(startIso: string, nowMs: number): string {
  const diffMin = Math.max(0, Math.ceil((new Date(startIso).getTime() - nowMs) / 60_000));
  if (diffMin < 60) return `Começa em ${diffMin} min`;
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  return m > 0 ? `Começa em ${h}h ${m}m` : `Começa em ${h}h`;
}

export function CinemaClientView({
  settings,
  isAdmin = false,
  getAdminToken,
}: CinemaClientViewProps) {
  const [sessions, setSessions] = useState<CinemaSessionItem[]>([]);
  const [unlockedSessions, setUnlockedSessions] = useState<CinemaSessionItem[]>([]);
  const [cpfTickets, setCpfTickets] = useState<CinemaTicketSummary[]>([]);
  const [serverClockOffsetMs, setServerClockOffsetMs] = useState(0);
  const [nowTickMs, setNowTickMs] = useState(() => Date.now());

  const [cpfInput, setCpfInput] = useState(() => {
    try {
      return localStorage.getItem('mengao_cinema_cpf') || '';
    } catch {
      return '';
    }
  });
  const [verifiedCpfMasked, setVerifiedCpfMasked] = useState<string | null>(null);
  const [checkingCpf, setCheckingCpf] = useState(false);
  const [requestingPix, setRequestingPix] = useState(false);
  const [cpfMsg, setCpfMsg] = useState<string | null>(null);
  const [cpfError, setCpfError] = useState<string | null>(null);

  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [copiedPix, setCopiedPix] = useState(false);
  const [audioMuted, setAudioMuted] = useState(false);
  const [cinemaPaused, setCinemaPaused] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
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

  const stageRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hideTimerRef = useRef<number | null>(null);

  function pingControls(forceShow = true) {
    if (forceShow) setControlsVisible(true);
    if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    hideTimerRef.current = window.setTimeout(() => {
      setControlsVisible(false);
    }, 3600);
  }

  function updateScreenSize(mode: ScreenSizeMode) {
    setScreenSizeMode(mode);
    try {
      localStorage.setItem('mengao_player_screen_size', mode);
    } catch {
      // ignore
    }
    pingControls();
  }

  function updateScreenFit(fit: ScreenFitMode) {
    setScreenFitMode(fit);
    try {
      localStorage.setItem('mengao_player_screen_fit', fit);
    } catch {
      // ignore
    }
    pingControls();
  }

  async function toggleFullscreen() {
    const target = stageRef.current;
    if (!target) return;
    if (!document.fullscreenElement) {
      await target.requestFullscreen().catch(() => undefined);
    } else {
      await document.exitFullscreen().catch(() => undefined);
    }
    pingControls();
  }

  async function verifyCpfAccess(rawCpf: string, silent = false) {
    const digits = rawCpf.replace(/\D/g, '').slice(0, 11);
    if (digits.length !== 11) {
      if (!silent) {
        setCpfError('Digite seu CPF com os 11 números (ex: 000.000.000-00).');
      }
      return;
    }
    try {
      localStorage.setItem('mengao_cinema_cpf', formatCpfInput(digits));
    } catch {
      // ignore
    }
    if (!silent) {
      setCheckingCpf(true);
      setCpfError(null);
      setCpfMsg(null);
    }
    try {
      const res = await fetch('/api/cinema/verify-cpf', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cpf: digits }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        erro?: string;
        serverNow?: string;
        cpfMasked?: string;
        authorized?: boolean;
        tickets?: CinemaTicketSummary[];
        unlockedSessions?: CinemaSessionItem[];
      };
      if (!res.ok) {
        if (!silent) setCpfError(data.erro || 'CPF inválido.');
        return;
      }
      if (data.serverNow) {
        const parsed = Date.parse(data.serverNow);
        if (Number.isFinite(parsed)) setServerClockOffsetMs(parsed - Date.now());
      }
      setVerifiedCpfMasked(data.cpfMasked || null);
      if (Array.isArray(data.tickets)) setCpfTickets(data.tickets);
      if (Array.isArray(data.unlockedSessions)) setUnlockedSessions(data.unlockedSessions);
      if (!silent) {
        const releasedCount = (data.tickets || []).filter((t) => t.status === 'liberado').length;
        const pendingCount = (data.tickets || []).filter((t) => t.status === 'pendente').length;
        if (releasedCount > 0) {
          setCpfMsg(`CPF ${data.cpfMasked} liberado! Bom filme.`);
        } else if (pendingCount > 0) {
          setCpfMsg(
            `CPF ${data.cpfMasked} aguardando confirmação do Pix pelo administrador.`
          );
        } else {
          setCpfMsg(
            `CPF ${data.cpfMasked} sem ingresso liberado ainda. Faça o Pix do filme desejado e clique em "Já fiz o Pix".`
          );
        }
      }
    } catch {
      if (!silent) setCpfError('Não foi possível verificar o CPF agora.');
    } finally {
      if (!silent) setCheckingCpf(false);
    }
  }

  async function loadSchedule() {
    try {
      const res = await fetch('/api/cinema/schedule', { cache: 'no-store' });
      if (res.ok) {
        const data = (await res.json()) as {
          serverNow?: string;
          sessions?: CinemaSessionItem[];
        };
        if (data.serverNow) {
          const parsed = Date.parse(data.serverNow);
          if (Number.isFinite(parsed)) setServerClockOffsetMs(parsed - Date.now());
        }
        if (Array.isArray(data.sessions)) {
          setSessions(data.sessions);
        }
      }
      if (isAdmin && getAdminToken) {
        const token = await getAdminToken();
        if (token) {
          const adminRes = await fetch('/api/admin/cinema', {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (adminRes.ok) {
            const adminData = (await adminRes.json()) as { sessions?: CinemaSessionItem[] };
            if (Array.isArray(adminData.sessions)) {
              setUnlockedSessions(adminData.sessions.filter((s) => s.active !== false));
            }
          }
        }
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void loadSchedule();
    const digits = cpfInput.replace(/\D/g, '');
    if (digits.length === 11) {
      void verifyCpfAccess(digits, true);
    }
    const schedPoll = window.setInterval(() => {
      void loadSchedule();
      const savedDigits = (localStorage.getItem('mengao_cinema_cpf') || '').replace(/\D/g, '');
      if (savedDigits.length === 11) {
        void verifyCpfAccess(savedDigits, true);
      }
    }, 15000);
    const tickId = window.setInterval(() => setNowTickMs(Date.now()), 1000);
    const onRefresh = () => {
      void loadSchedule();
      const savedDigits = (localStorage.getItem('mengao_cinema_cpf') || '').replace(/\D/g, '');
      if (savedDigits.length === 11) {
        void verifyCpfAccess(savedDigits, true);
      }
    };
    const onFs = () => setIsFullscreen(Boolean(document.fullscreenElement));
    window.addEventListener('mengao-catalog-refresh', onRefresh);
    document.addEventListener('fullscreenchange', onFs);
    return () => {
      window.clearInterval(schedPoll);
      window.clearInterval(tickId);
      window.removeEventListener('mengao-catalog-refresh', onRefresh);
      document.removeEventListener('fullscreenchange', onFs);
      if (hideTimerRef.current) window.clearTimeout(hideTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin]);

  async function handleRequestPixTicket(session: CinemaSessionItem) {
    const digits = cpfInput.replace(/\D/g, '').slice(0, 11);
    if (digits.length !== 11) {
      setCpfError('Digite seu CPF (11 números) acima antes de informar o pagamento.');
      return;
    }
    setRequestingPix(true);
    setCpfError(null);
    setCpfMsg(null);
    try {
      const res = await fetch('/api/cinema/request-ticket', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cpf: digits,
          sessionId: session.id,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        erro?: string;
        ticket?: CinemaTicketSummary;
      };
      if (!res.ok) {
        setCpfError(data.erro || 'Não foi possível enviar a solicitação.');
        return;
      }
      if (data.ticket?.status === 'liberado') {
        setCpfMsg(`Seu CPF já está liberado para "${session.title}"!`);
      } else {
        setCpfMsg(
          `Aviso enviado! Assim que o administrador confirmar seu Pix, "${session.title}" libera automaticamente no seu CPF até o fim do filme.`
        );
      }
      await verifyCpfAccess(digits, true);
    } catch {
      setCpfError('Falha ao registrar pedido de ingresso.');
    } finally {
      setRequestingPix(false);
    }
  }

  const synchronizedNowMs = nowTickMs + serverClockOffsetMs;

  const unlockedById = new Map<string, CinemaSessionItem>();
  for (const s of unlockedSessions) {
    if (s.videoUrl) unlockedById.set(s.id, s);
  }
  for (const s of sessions) {
    if (s.isFree && s.videoUrl && !unlockedById.has(s.id)) {
      unlockedById.set(s.id, s);
    }
  }

  const playingNowSessions = sessions.filter((s) => {
    const startMs = new Date(s.startTime).getTime();
    const endMs = startMs + s.durationMinutes * 60_000;
    return s.active && synchronizedNowMs >= startMs && synchronizedNowMs < endMs;
  });

  const unlockedPlayingNow = playingNowSessions
    .map((s) => unlockedById.get(s.id))
    .filter((s): s is CinemaSessionItem => Boolean(s && s.videoUrl));

  const currentPlaying =
    unlockedPlayingNow.find((s) => s.id === selectedSessionId) ||
    unlockedPlayingNow[0] ||
    null;

  const highlightedAnnouncement =
    sessions.find((s) => s.id === selectedSessionId) ||
    playingNowSessions[0] ||
    sessions.find((s) => new Date(s.startTime).getTime() > synchronizedNowMs) ||
    sessions[0] ||
    null;

  const activeTicketForPlaying = currentPlaying
    ? cpfTickets.find(
        (t) =>
          t.sessionId === currentPlaying.id &&
          t.status === 'liberado' &&
          new Date(t.expiresAt).getTime() > synchronizedNowMs
      )
    : undefined;

  const cinemaYoutubeId =
    currentPlaying?.videoUrl ? extractYoutubeId(currentPlaying.videoUrl) : null;
  const cinemaOffsetSeconds = currentPlaying
    ? Math.max(
        0,
        Math.floor(
          (synchronizedNowMs - new Date(currentPlaying.startTime).getTime()) / 1000
        )
      )
    : 0;

  const stageSizeClasses = isFullscreen
    ? 'h-[100dvh] w-screen rounded-none border-0'
    : screenSizeMode === 'small'
      ? 'mx-auto w-full max-w-md h-[29dvh] min-h-[195px] rounded-2xl border border-zinc-800'
      : screenSizeMode === 'medium'
        ? 'mx-auto w-full max-w-4xl h-[46dvh] min-h-[260px] sm:h-[58dvh] rounded-2xl border border-zinc-800'
        : 'w-full h-[65dvh] min-h-[340px] sm:h-[75dvh] rounded-xl border border-zinc-800/80';

  const pixWhatsappHref = highlightedAnnouncement
    ? `https://wa.me/${(settings.whatsappNumber || '').replace(/\D/g, '')}?text=${encodeURIComponent(
        `Olá! Fiz o Pix de ${highlightedAnnouncement.ticketPrice} para o Cinema "${highlightedAnnouncement.title}".\nMeu CPF para liberar até o fim do filme: ${cpfInput || '(vou informar)'}`
      )}`
    : '#';

  return (
    <div className="mx-auto max-w-7xl px-3 py-5 sm:px-6 sm:py-7 space-y-6">
      {/* Player Desbloqueado (Somente enquanto o filme não acabou e CPF/Admin estiver liberado) */}
      {currentPlaying && currentPlaying.videoUrl ? (
        <div
          ref={stageRef}
          onMouseMove={() => pingControls()}
          onClick={() => pingControls()}
          className={`relative flex items-center justify-center overflow-hidden bg-black ${stageSizeClasses}`}
        >
          {cinemaYoutubeId ? (
            <iframe
              key={`${currentPlaying.id}-${cinemaOffsetSeconds > 5 ? 'sync' : 'start'}`}
              src={`https://www.youtube.com/embed/${cinemaYoutubeId}?autoplay=1&mute=${
                audioMuted ? 1 : 0
              }&start=${cinemaOffsetSeconds}&rel=0&playsinline=1`}
              title={currentPlaying.title}
              allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
              allowFullScreen
              className={`h-full w-full border-0 ${
                screenFitMode === 'cover' ? 'scale-[1.12]' : ''
              }`}
            />
          ) : (
            <video
              ref={videoRef}
              key={currentPlaying.id}
              src={currentPlaying.videoUrl}
              autoPlay
              playsInline
              muted={audioMuted}
              onLoadedMetadata={(e) => {
                const vid = e.currentTarget;
                if (cinemaOffsetSeconds > 1 && Number.isFinite(vid.duration)) {
                  vid.currentTime = Math.min(
                    cinemaOffsetSeconds,
                    Math.max(0, vid.duration - 2)
                  );
                }
              }}
              onPlay={() => setCinemaPaused(false)}
              onPause={() => setCinemaPaused(true)}
              className={`h-full w-full ${
                screenFitMode === 'cover' ? 'object-cover' : 'object-contain'
              }`}
            />
          )}

          {/* Barra superior discreta com validade do ingresso */}
          <div
            className={`absolute inset-x-0 top-0 z-20 flex items-center justify-between gap-2 bg-gradient-to-b from-black/90 via-black/45 to-transparent px-4 py-3 text-xs transition-opacity duration-200 ${
              controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <span className="font-semibold text-white truncate">{currentPlaying.title}</span>
            <span className="font-mono text-[11px] text-emerald-300 shrink-0">
              {activeTicketForPlaying
                ? `CPF liberado até ${formatClockTime(activeTicketForPlaying.expiresAt)}`
                : isAdmin
                  ? 'Prévia Admin'
                  : 'Sessão aberta'}
            </span>
          </div>

          <div
            className={`absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-between gap-2 bg-gradient-to-t from-black/95 via-black/65 to-transparent px-4 pb-3 pt-10 transition-opacity duration-200 ${
              controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
            }`}
          >
            <div className="flex items-center gap-2 min-w-0">
              {!cinemaYoutubeId && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    const vid = videoRef.current;
                    if (!vid) return;
                    if (vid.paused) void vid.play();
                    else vid.pause();
                    pingControls();
                  }}
                  className="inline-flex h-10 min-w-[40px] items-center justify-center rounded-lg bg-white/15 px-3 text-xs font-semibold text-white hover:bg-white/25 cursor-pointer"
                >
                  {cinemaPaused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                </button>
              )}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  setAudioMuted((prev) => !prev);
                  pingControls();
                }}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg bg-white/15 px-3 text-xs font-semibold text-white hover:bg-white/25 cursor-pointer"
              >
                {audioMuted ? (
                  <VolumeX className="h-4 w-4 text-red-400" />
                ) : (
                  <Volume2 className="h-4 w-4" />
                )}
                <span className="hidden sm:inline">{audioMuted ? 'Sem som' : 'Som'}</span>
              </button>
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
                  void toggleFullscreen();
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
        </div>
      ) : (
        /* Bilheteria & Acesso Direto pelo CPF (Sem Registro) */
        <div className="grid grid-cols-1 gap-5 rounded-2xl border border-zinc-800/90 bg-gradient-to-br from-zinc-900 via-[#12070a] to-black p-5 sm:p-8 lg:grid-cols-12">
          <div className="lg:col-span-7 space-y-4">
            <div className="flex items-center gap-2 text-xs font-semibold text-red-400">
              <Clapperboard className="h-4 w-4" />
              <span>Cinema ao Vivo · Acesso Direto pelo CPF (Sem Cadastro)</span>
            </div>

            {highlightedAnnouncement ? (
              <>
                <div className="flex flex-wrap items-baseline gap-3">
                  <h1 className="font-display text-2xl sm:text-4xl font-extrabold text-white">
                    {highlightedAnnouncement.title}
                  </h1>
                  <span className="rounded-lg bg-emerald-950/80 border border-emerald-700/60 px-3 py-1 font-mono text-sm font-bold text-emerald-300">
                    Ingresso: {highlightedAnnouncement.ticketPrice || 'R$ 10,00'}
                  </span>
                </div>
                {highlightedAnnouncement.synopsis && (
                  <p className="text-sm text-zinc-300">{highlightedAnnouncement.synopsis}</p>
                )}
                <div className="flex flex-wrap items-center gap-3 text-xs text-zinc-400 tabular-nums">
                  <span>Início: {formatDateTimeShort(highlightedAnnouncement.startTime)}</span>
                  <span aria-hidden="true">·</span>
                  <span>Duração: {highlightedAnnouncement.durationMinutes} min</span>
                  <span aria-hidden="true">·</span>
                  <span>Acesso válido até o fim do filme</span>
                </div>
              </>
            ) : (
              <>
                <h1 className="font-display text-2xl sm:text-3xl font-extrabold text-white">
                  Cinema · Próximas Sessões
                </h1>
                <p className="text-sm text-zinc-400">
                  Assim que um filme for anunciado, você vê o horário e o valor do ingresso aqui
                  e libera seu acesso informando apenas o CPF após o Pix.
                </p>
              </>
            )}

            {/* Formulário de Entrada Direta por CPF */}
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void verifyCpfAccess(cpfInput, false);
              }}
              className="rounded-xl border border-zinc-800 bg-zinc-950/90 p-4 space-y-3"
            >
              <label className="block text-xs font-semibold text-zinc-200">
                Já pagou o Pix? Digite seu CPF para assistir agora (sem cadastro):
              </label>
              <div className="flex flex-col gap-2.5 sm:flex-row">
                <input
                  type="text"
                  inputMode="numeric"
                  required
                  value={cpfInput}
                  onChange={(e) => setCpfInput(formatCpfInput(e.target.value))}
                  placeholder="000.000.000-00"
                  className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3.5 py-2.5 font-mono text-sm text-white focus:border-[#C8102E] focus:outline-none"
                />
                <button
                  type="submit"
                  disabled={checkingCpf}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#C8102E] px-5 py-2.5 text-xs font-bold text-white hover:bg-red-700 disabled:opacity-50 whitespace-nowrap cursor-pointer"
                >
                  <Ticket className="h-4 w-4" />
                  {checkingCpf ? 'Verificando...' : 'Entrar com CPF'}
                </button>
              </div>
              {cpfError && <p className="text-xs text-red-400">{cpfError}</p>}
              {cpfMsg && <p className="text-xs text-emerald-300">{cpfMsg}</p>}
            </form>
          </div>

          {/* Card Pix para Compra Rápida do Ingresso */}
          <div className="lg:col-span-5 rounded-xl border border-zinc-800 bg-zinc-950/95 p-5 flex flex-col justify-between gap-4">
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-bold text-white">
                  <QrCode className="h-4 w-4 text-[#C8102E]" />
                  Pagamento via Pix ({settings.pixType})
                </span>
                {highlightedAnnouncement && (
                  <span className="font-mono text-xs font-bold text-emerald-300">
                    {highlightedAnnouncement.ticketPrice}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-3">
                {sanitizePixQrCodeUrl(settings.pixQrCodeDataUrl) && (
                  <div className="shrink-0 rounded-lg bg-white p-1.5">
                    <img
                      src={sanitizePixQrCodeUrl(settings.pixQrCodeDataUrl)}
                      alt="QR Code Pix Cinema"
                      className="h-20 w-20 object-contain"
                    />
                  </div>
                )}
                <div className="min-w-0 space-y-1">
                  <p className="text-[11px] text-zinc-400">
                    Favorecido: {settings.pixReceiverName}
                  </p>
                  <p className="font-mono text-xs font-semibold text-white break-all">
                    {settings.pixKey || 'Chave Pix disponível pelo WhatsApp'}
                  </p>
                  {settings.pixKey && (
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard?.writeText(settings.pixKey);
                        setCopiedPix(true);
                        window.setTimeout(() => setCopiedPix(false), 1800);
                      }}
                      className="inline-flex items-center gap-1 rounded-md border border-zinc-700 bg-zinc-900 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                    >
                      {copiedPix ? (
                        <Check className="h-3 w-3 text-emerald-400" />
                      ) : (
                        <Copy className="h-3 w-3" />
                      )}
                      {copiedPix ? 'Pix Copiado' : 'Copiar Chave Pix'}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {highlightedAnnouncement && !highlightedAnnouncement.isFree && (
              <div className="space-y-2 border-t border-zinc-800 pt-3">
                <button
                  type="button"
                  disabled={requestingPix}
                  onClick={() => void handleRequestPixTicket(highlightedAnnouncement)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 py-2.5 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                >
                  <CheckCircle2 className="h-4 w-4" />
                  {requestingPix
                    ? 'Enviando aviso...'
                    : `Já fiz o Pix · Avisar Admin (${highlightedAnnouncement.ticketPrice})`}
                </button>
                {settings.whatsappNumber && (
                  <a
                    href={pixWhatsappHref}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-700 bg-zinc-900 py-2 text-xs font-medium text-zinc-200 hover:bg-zinc-800"
                  >
                    <MessageCircle className="h-3.5 w-3.5 text-emerald-400" />
                    Enviar comprovante no WhatsApp
                  </a>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Programação de Filmes & Preços */}
      <section className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="font-display text-lg sm:text-xl font-bold text-white">
              Cartaz &amp; Horários do Cinema
            </h2>
            {verifiedCpfMasked && (
              <p className="text-xs text-zinc-400">
                CPF consultado: <span className="font-mono text-zinc-200">{verifiedCpfMasked}</span>
              </p>
            )}
          </div>
          <span className="text-xs text-zinc-400 tabular-nums">
            {sessions.length} {sessions.length === 1 ? 'filme anunciado' : 'filmes anunciados'}
          </span>
        </div>

        {sessions.length === 0 ? (
          <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/50 p-6 text-center text-xs text-zinc-400">
            Nenhum filme anunciado no momento.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {sessions.map((session) => {
              const startMs = new Date(session.startTime).getTime();
              const endMs = startMs + session.durationMinutes * 60_000;
              const isNow = synchronizedNowMs >= startMs && synchronizedNowMs < endMs;
              const isUpcoming = synchronizedNowMs < startMs;
              const hasUnlocked = unlockedById.has(session.id);
              const ticket = cpfTickets.find((t) => t.sessionId === session.id);

              return (
                <div
                  key={session.id}
                  className={`group overflow-hidden rounded-xl border transition-colors ${
                    currentPlaying?.id === session.id
                      ? 'border-[#C8102E] bg-zinc-900'
                      : 'border-zinc-800 bg-zinc-900/60 hover:border-zinc-700'
                  }`}
                >
                  <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-[#2b0910] via-zinc-900 to-black">
                    {session.posterUrl ? (
                      <img
                        src={session.posterUrl}
                        alt={session.title}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center">
                        <Clapperboard className="h-10 w-10 text-zinc-600" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
                    <div className="absolute top-2.5 right-2.5 rounded-md bg-black/80 border border-emerald-700/60 px-2.5 py-1 font-mono text-xs font-bold text-emerald-300">
                      {session.ticketPrice || 'R$ 10,00'}
                    </div>
                    <div className="absolute bottom-2.5 left-3 right-3 flex items-center justify-between gap-2 text-xs">
                      <span
                        className={`font-semibold ${
                          isNow
                            ? 'text-emerald-400'
                            : isUpcoming
                              ? 'text-amber-300'
                              : 'text-zinc-400'
                        }`}
                      >
                        {isNow
                          ? 'Em cartaz agora'
                          : isUpcoming
                            ? formatScheduleCountdown(session.startTime, synchronizedNowMs)
                            : 'Sessão encerrada'}
                      </span>
                      <span className="font-mono text-zinc-200 tabular-nums">
                        {formatClockTime(session.startTime)}
                      </span>
                    </div>
                  </div>

                  <div className="p-4 space-y-2.5">
                    <div>
                      <h3 className="font-display text-base font-bold text-white truncate">
                        {session.title}
                      </h3>
                      <p className="mt-0.5 text-xs text-zinc-400 tabular-nums">
                        {session.genre || 'Filme'} · {session.durationMinutes} min · Termina às{' '}
                        {formatClockTime(new Date(endMs).toISOString())}
                      </p>
                    </div>
                    {session.synopsis && (
                      <p className="line-clamp-2 text-xs text-zinc-400">{session.synopsis}</p>
                    )}

                    {isNow && hasUnlocked ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSessionId(session.id);
                          setCinemaPaused(false);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-[#C8102E] py-2 text-xs font-semibold text-white hover:bg-red-700 cursor-pointer"
                      >
                        <Play className="h-3.5 w-3.5" />
                        Assistir agora (Liberado no CPF)
                      </button>
                    ) : ticket?.status === 'liberado' && isUpcoming ? (
                      <div className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-emerald-800 bg-emerald-950/50 py-2 text-xs font-semibold text-emerald-300">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        CPF liberado! Abre às {formatClockTime(session.startTime)}
                      </div>
                    ) : isNow || isUpcoming ? (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedSessionId(session.id);
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }}
                        className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-950 py-2 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                      >
                        <Lock className="h-3.5 w-3.5 text-[#C8102E]" />
                        {ticket?.status === 'pendente'
                          ? 'Aguardando liberação do Pix'
                          : `Comprar / Entrar com CPF (${session.ticketPrice})`}
                      </button>
                    ) : (
                      <div className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg border border-zinc-800 bg-zinc-950 py-2 text-xs text-zinc-500">
                        <Clock className="h-3.5 w-3.5" />
                        Sessão encerrada
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
