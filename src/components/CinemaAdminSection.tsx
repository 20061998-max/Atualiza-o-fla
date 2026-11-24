import { useEffect, useState } from 'react';
import {
  CalendarClock,
  CheckCircle2,
  Clapperboard,
  Play,
  Plus,
  Ticket,
  Trash2,
  UserCheck,
} from 'lucide-react';

export interface CinemaSessionItem {
  id: string;
  title: string;
  videoUrl?: string;
  posterUrl?: string;
  synopsis?: string;
  genre?: string;
  ticketPrice: string;
  isFree?: boolean;
  startTime: string;
  durationMinutes: number;
  active: boolean;
  createdAt: string;
}

export interface CinemaTicketAdminItem {
  id: string;
  cpfDigits: string;
  cpfMasked: string;
  customerName?: string;
  sessionId: string;
  movieTitle: string;
  ticketPrice: string;
  status: 'pendente' | 'liberado' | 'revogado';
  createdAt: string;
  releasedAt?: string;
  expiresAt: string;
  expired?: boolean;
}

interface CinemaAdminSectionProps {
  getAdminToken: () => Promise<string | null>;
}

function toLocalInputValue(isoOrDate: string | Date): string {
  const d = typeof isoOrDate === 'string' ? new Date(isoOrDate) : isoOrDate;
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}`;
}

function formatSessionTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatClockOnly(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

export function formatCpfInput(raw: string): string {
  const d = raw.replace(/\D/g, '').slice(0, 11);
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}.${d.slice(3)}`;
  if (d.length <= 9) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6)}`;
  return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`;
}

function getSessionStatus(
  session: CinemaSessionItem,
  nowMs: number
): {
  label: string;
  tone: 'live' | 'upcoming' | 'ended' | 'hidden';
} {
  if (!session.active) return { label: 'Oculto', tone: 'hidden' };
  const startMs = new Date(session.startTime).getTime();
  const endMs = startMs + session.durationMinutes * 60_000;
  if (nowMs >= startMs && nowMs < endMs) {
    return { label: 'Em exibição agora', tone: 'live' };
  }
  if (nowMs < startMs) {
    return { label: 'Agendado', tone: 'upcoming' };
  }
  return { label: 'Encerrado', tone: 'ended' };
}

export function CinemaAdminSection({ getAdminToken }: CinemaAdminSectionProps) {
  const [sessions, setSessions] = useState<CinemaSessionItem[]>([]);
  const [tickets, setTickets] = useState<CinemaTicketAdminItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [title, setTitle] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [posterUrl, setPosterUrl] = useState('');
  const [genre, setGenre] = useState('Filme');
  const [ticketPrice, setTicketPrice] = useState('R$ 10,00');
  const [startLocal, setStartLocal] = useState(() => toLocalInputValue(new Date()));
  const [durationMinutes, setDurationMinutes] = useState(120);
  const [synopsis, setSynopsis] = useState('');
  const [active, setActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Liberação direta de CPF pelo Admin
  const [cpfInput, setCpfInput] = useState('');
  const [cpfCustomerName, setCpfCustomerName] = useState('');
  const [selectedSessionId, setSelectedSessionId] = useState('');
  const [releasingCpf, setReleasingCpf] = useState(false);
  const [cpfFeedback, setCpfFeedback] = useState<string | null>(null);
  const [cpfError, setCpfError] = useState<string | null>(null);

  async function loadCinemaAdminData() {
    const token = await getAdminToken();
    if (!token) return;
    try {
      const res = await fetch('/api/admin/cinema', {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        sessions?: CinemaSessionItem[];
        tickets?: CinemaTicketAdminItem[];
      };
      if (Array.isArray(data.sessions)) {
        setSessions(data.sessions);
        if (!selectedSessionId && data.sessions.length > 0) {
          const activeOrNext =
            data.sessions.find((s) => {
              const end = new Date(s.startTime).getTime() + s.durationMinutes * 60_000;
              return end > Date.now();
            }) || data.sessions[0];
          if (activeOrNext) setSelectedSessionId(activeOrNext.id);
        }
      }
      if (Array.isArray(data.tickets)) {
        setTickets(data.tickets);
      }
    } catch {
      // ignore
    }
  }

  useEffect(() => {
    void loadCinemaAdminData();
    const id = window.setInterval(() => {
      void loadCinemaAdminData();
    }, 15000);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function resetForm() {
    setEditingId(null);
    setTitle('');
    setVideoUrl('');
    setPosterUrl('');
    setGenre('Filme');
    setTicketPrice('R$ 10,00');
    setStartLocal(toLocalInputValue(new Date()));
    setDurationMinutes(120);
    setSynopsis('');
    setActive(true);
  }

  function startEditing(item: CinemaSessionItem) {
    setEditingId(item.id);
    setTitle(item.title);
    setVideoUrl(item.videoUrl || '');
    setPosterUrl(item.posterUrl || '');
    setGenre(item.genre || 'Filme');
    setTicketPrice(item.ticketPrice || 'R$ 10,00');
    setStartLocal(toLocalInputValue(item.startTime));
    setDurationMinutes(item.durationMinutes || 120);
    setSynopsis(item.synopsis || '');
    setActive(item.active !== false);
    setError(null);
    setFeedback(null);
  }

  async function saveSessionPayload(payload: {
    id?: string;
    title: string;
    videoUrl: string;
    posterUrl?: string;
    genre?: string;
    ticketPrice: string;
    startTime: string;
    durationMinutes: number;
    synopsis?: string;
    active: boolean;
  }) {
    const token = await getAdminToken();
    if (!token) {
      setError('Sessão administrativa expirada.');
      return false;
    }
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch('/api/admin/cinema', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        erro?: string;
        sessions?: CinemaSessionItem[];
        tickets?: CinemaTicketAdminItem[];
      };
      if (!res.ok) {
        setError(data.erro || 'Não foi possível salvar a sessão de cinema.');
        return false;
      }
      if (Array.isArray(data.sessions)) {
        setSessions(data.sessions);
        if (!selectedSessionId && data.sessions[0]) {
          setSelectedSessionId(data.sessions[0].id);
        }
      }
      if (Array.isArray(data.tickets)) {
        setTickets(data.tickets);
      }
      window.dispatchEvent(new Event('mengao-catalog-refresh'));
      return true;
    } catch {
      setError('Falha de rede ao salvar sessão de cinema.');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = new Date(startLocal);
    if (Number.isNaN(parsed.getTime())) {
      setError('Informe uma data e horário válidos.');
      return;
    }
    const ok = await saveSessionPayload({
      id: editingId || undefined,
      title,
      videoUrl,
      posterUrl,
      genre,
      ticketPrice,
      startTime: parsed.toISOString(),
      durationMinutes,
      synopsis,
      active,
    });
    if (ok) {
      setFeedback(
        editingId
          ? `Sessão "${title.trim()}" atualizada.`
          : `Filme "${title.trim()}" anunciado no Cinema.`
      );
      resetForm();
    }
  }

  async function handlePlayNowQuick(item: CinemaSessionItem) {
    const ok = await saveSessionPayload({
      id: item.id,
      title: item.title,
      videoUrl: item.videoUrl || '',
      posterUrl: item.posterUrl,
      genre: item.genre,
      ticketPrice: item.ticketPrice || 'R$ 10,00',
      startTime: new Date().toISOString(),
      durationMinutes: item.durationMinutes,
      synopsis: item.synopsis,
      active: true,
    });
    if (ok) {
      setFeedback(`"${item.title}" iniciado agora na programação do Cinema.`);
    }
  }

  async function handleDelete(id: string, itemTitle: string) {
    const token = await getAdminToken();
    if (!token) return;
    setSaving(true);
    setError(null);
    setFeedback(null);
    try {
      const res = await fetch(`/api/admin/cinema/${encodeURIComponent(id)}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = (await res.json().catch(() => ({}))) as {
        sessions?: CinemaSessionItem[];
        tickets?: CinemaTicketAdminItem[];
      };
      if (res.ok && Array.isArray(data.sessions)) {
        setSessions(data.sessions);
        if (Array.isArray(data.tickets)) setTickets(data.tickets);
        if (editingId === id) resetForm();
        window.dispatchEvent(new Event('mengao-catalog-refresh'));
        setFeedback(`Filme "${itemTitle}" removido do Cinema.`);
      }
    } finally {
      setSaving(false);
    }
  }

  async function releaseCpfTicket(
    cpfRaw: string,
    targetSessionId: string,
    customerName?: string
  ) {
    const token = await getAdminToken();
    if (!token) {
      setCpfError('Sessão administrativa expirada.');
      return;
    }
    setReleasingCpf(true);
    setCpfError(null);
    setCpfFeedback(null);
    try {
      const res = await fetch('/api/admin/cinema/tickets', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          cpf: cpfRaw,
          sessionId: targetSessionId,
          customerName,
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        erro?: string;
        ticket?: CinemaTicketAdminItem;
        tickets?: CinemaTicketAdminItem[];
      };
      if (!res.ok) {
        setCpfError(data.erro || 'Não foi possível liberar o CPF.');
        return;
      }
      if (Array.isArray(data.tickets)) {
        setTickets(data.tickets);
      }
      if (data.ticket) {
        setCpfFeedback(
          `CPF ${data.ticket.cpfMasked} liberado para "${data.ticket.movieTitle}" até ${formatClockOnly(
            data.ticket.expiresAt
          )} (fim do filme).`
        );
      }
      setCpfInput('');
      setCpfCustomerName('');
      window.dispatchEvent(new Event('mengao-catalog-refresh'));
    } catch {
      setCpfError('Erro de conexão ao liberar CPF.');
    } finally {
      setReleasingCpf(false);
    }
  }

  async function handleReleaseCpfSubmit(e: React.FormEvent) {
    e.preventDefault();
    const targetId = selectedSessionId || sessions[0]?.id || '';
    if (!targetId) {
      setCpfError('Cadastre um filme primeiro para liberar um CPF.');
      return;
    }
    await releaseCpfTicket(cpfInput, targetId, cpfCustomerName);
  }

  async function handleRevokeTicket(ticketId: string) {
    const token = await getAdminToken();
    if (!token) return;
    setCpfError(null);
    const res = await fetch(`/api/admin/cinema/tickets/${encodeURIComponent(ticketId)}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = (await res.json().catch(() => ({}))) as {
      tickets?: CinemaTicketAdminItem[];
    };
    if (res.ok && Array.isArray(data.tickets)) {
      setTickets(data.tickets);
      window.dispatchEvent(new Event('mengao-catalog-refresh'));
    }
  }

  const nowMs = Date.now();
  const pendingTickets = tickets.filter((t) => t.status === 'pendente' && !t.expired);
  const releasedTickets = tickets.filter((t) => t.status === 'liberado');

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900 p-6 space-y-6">
      <div className="flex flex-col justify-between gap-2 sm:flex-row sm:items-center">
        <div className="flex items-start gap-3">
          <Clapperboard className="h-6 w-6 shrink-0 text-[#C8102E] mt-0.5" />
          <div>
            <h2 className="font-display text-2xl font-bold text-white">
              Cinema · Filmes, Preço do Ingresso e Liberação por CPF
            </h2>
            <p className="text-xs text-zinc-400">
              Anuncie o filme, horário e valor do ingresso. Após o Pix, libere o acesso apenas
              pelo CPF do cliente (sem cadastro) com duração automática até o fim do filme.
            </p>
          </div>
        </div>
        {feedback && <span className="text-xs font-semibold text-emerald-400">{feedback}</span>}
      </div>

      {/* Formulário de Filme + Horário + Preço do Ingresso */}
      <form
        onSubmit={handleSubmit}
        className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <span className="inline-flex items-center gap-2 text-sm font-bold text-white">
            <Plus className="h-4 w-4 text-[#C8102E]" />
            {editingId ? 'Editar filme anunciado' : 'Anunciar novo filme e ingresso'}
          </span>
          <button
            type="button"
            onClick={() => setStartLocal(toLocalInputValue(new Date()))}
            className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-medium text-zinc-200 hover:bg-zinc-800 cursor-pointer"
          >
            <CalendarClock className="h-3.5 w-3.5 text-[#C8102E]" />
            Definir horário para agora
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-12">
          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-zinc-300">Título do filme</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Ex: Tropa de Elite · Sessão Especial"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white focus:border-[#C8102E] focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-zinc-300">Preço do ingresso</label>
            <input
              type="text"
              required
              value={ticketPrice}
              onChange={(e) => setTicketPrice(e.target.value)}
              placeholder="R$ 10,00"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-emerald-300 focus:border-[#C8102E] focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-zinc-300">Gênero</label>
            <input
              type="text"
              value={genre}
              onChange={(e) => setGenre(e.target.value)}
              placeholder="Ação, Drama..."
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white focus:border-[#C8102E] focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-zinc-300">Horário de início</label>
            <input
              type="datetime-local"
              required
              value={startLocal}
              onChange={(e) => setStartLocal(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-2.5 py-2 font-mono text-xs text-white focus:border-[#C8102E] focus:outline-none"
            />
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-zinc-300">Duração (min)</label>
            <input
              type="number"
              min={5}
              max={720}
              required
              value={durationMinutes}
              onChange={(e) => setDurationMinutes(Number(e.target.value))}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-white tabular-nums focus:border-[#C8102E] focus:outline-none"
            />
          </div>

          <div className="md:col-span-7">
            <label className="block text-xs font-medium text-zinc-300">
              Link do vídeo (MP4, WebM, M3U8 ou YouTube)
            </label>
            <input
              type="url"
              required
              value={videoUrl}
              onChange={(e) => setVideoUrl(e.target.value)}
              placeholder="https://.../filme.mp4 ou https://youtube.com/watch?v=..."
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-white focus:border-[#C8102E] focus:outline-none"
            />
          </div>

          <div className="md:col-span-5">
            <label className="block text-xs font-medium text-zinc-300">
              Capa / Poster URL (opcional)
            </label>
            <input
              type="url"
              value={posterUrl}
              onChange={(e) => setPosterUrl(e.target.value)}
              placeholder="https://.../capa.jpg"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-white focus:border-[#C8102E] focus:outline-none"
            />
          </div>

          <div className="md:col-span-12">
            <label className="block text-xs font-medium text-zinc-300">Sinopse (opcional)</label>
            <input
              type="text"
              value={synopsis}
              onChange={(e) => setSynopsis(e.target.value)}
              placeholder="Descrição curta exibida no anúncio para os clientes..."
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white focus:border-[#C8102E] focus:outline-none"
            />
          </div>
        </div>

        {error && (
          <p className="rounded-lg bg-red-950/70 px-3 py-2 text-xs text-red-300">{error}</p>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
          <label className="inline-flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
            <input
              type="checkbox"
              checked={active}
              onChange={(e) => setActive(e.target.checked)}
              className="h-4 w-4 accent-[#C8102E]"
            />
            Anunciar filme na aba Cinema pública e do App
          </label>

          <div className="flex items-center gap-2">
            {editingId && (
              <button
                type="button"
                onClick={resetForm}
                className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-xs font-semibold text-zinc-300 hover:bg-zinc-800 cursor-pointer"
              >
                Cancelar edição
              </button>
            )}
            <button
              type="submit"
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-lg bg-[#C8102E] px-5 py-2 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50 cursor-pointer"
            >
              <Clapperboard className="h-3.5 w-3.5" />
              {saving ? 'Salvando...' : editingId ? 'Salvar filme' : 'Anunciar no Cinema'}
            </button>
          </div>
        </div>
      </form>

      {/* Liberação Direta de Ingresso por CPF */}
      <div className="rounded-xl border border-emerald-900/50 bg-zinc-950 p-5 space-y-4">
        <div className="flex items-start gap-2.5">
          <Ticket className="h-5 w-5 shrink-0 text-emerald-400 mt-0.5" />
          <div>
            <h3 className="font-display text-lg font-bold text-white">
              Liberar Ingresso por CPF (Sem Registro · Até o Filme Acabar)
            </h3>
            <p className="text-xs text-zinc-400">
              Recebeu o Pix do cliente? Digite apenas o CPF dele e escolha o filme. O acesso expira
              automaticamente no minuto em que a sessão terminar.
            </p>
          </div>
        </div>

        <form onSubmit={handleReleaseCpfSubmit} className="grid grid-cols-1 gap-3 md:grid-cols-12 md:items-end">
          <div className="md:col-span-3">
            <label className="block text-xs font-medium text-zinc-300">CPF do cliente</label>
            <input
              type="text"
              inputMode="numeric"
              required
              value={cpfInput}
              onChange={(e) => setCpfInput(formatCpfInput(e.target.value))}
              placeholder="000.000.000-00"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="md:col-span-4">
            <label className="block text-xs font-medium text-zinc-300">Filme / Sessão</label>
            <select
              value={selectedSessionId}
              onChange={(e) => setSelectedSessionId(e.target.value)}
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            >
              {sessions.length === 0 ? (
                <option value="">Nenhum filme cadastrado</option>
              ) : (
                sessions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title} · {formatSessionTimeLabel(s.startTime)} ({s.ticketPrice})
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="block text-xs font-medium text-zinc-300">Nome (opcional)</label>
            <input
              type="text"
              value={cpfCustomerName}
              onChange={(e) => setCpfCustomerName(e.target.value)}
              placeholder="Identificação"
              className="mt-1 w-full rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-xs text-white focus:border-emerald-500 focus:outline-none"
            />
          </div>

          <div className="md:col-span-3">
            <button
              type="submit"
              disabled={releasingCpf || sessions.length === 0}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
            >
              <UserCheck className="h-4 w-4" />
              {releasingCpf ? 'Liberando...' : 'Liberar CPF Agora'}
            </button>
          </div>
        </form>

        {cpfError && (
          <p className="rounded-lg bg-red-950/70 px-3 py-2 text-xs text-red-300">{cpfError}</p>
        )}
        {cpfFeedback && (
          <p className="rounded-lg bg-emerald-950/70 px-3 py-2 text-xs text-emerald-300">
            {cpfFeedback}
          </p>
        )}

        {pendingTickets.length > 0 && (
          <div className="space-y-2 border-t border-zinc-800 pt-3">
            <p className="text-xs font-semibold text-amber-300">
              Pedidos Pix aguardando liberação ({pendingTickets.length})
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {pendingTickets.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-amber-800/60 bg-amber-950/20 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-mono font-bold text-white">
                      {t.cpfMasked} {t.customerName ? `· ${t.customerName}` : ''}
                    </p>
                    <p className="truncate text-[11px] text-zinc-400">
                      {t.movieTitle} ({t.ticketPrice})
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      type="button"
                      disabled={releasingCpf}
                      onClick={() => void releaseCpfTicket(t.cpfDigits, t.sessionId, t.customerName)}
                      className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-emerald-500 cursor-pointer"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      Liberar
                    </button>
                    <button
                      type="button"
                      onClick={() => void handleRevokeTicket(t.id)}
                      className="rounded-md border border-zinc-700 p-1.5 text-zinc-400 hover:text-red-400 cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {releasedTickets.length > 0 && (
          <div className="space-y-2 border-t border-zinc-800 pt-3">
            <p className="text-xs font-semibold text-zinc-300">
              CPFs liberados ({releasedTickets.length})
            </p>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {releasedTickets.map((t) => (
                <div
                  key={t.id}
                  className="flex items-center justify-between gap-2 rounded-lg border border-zinc-800 bg-zinc-900 px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-mono font-bold text-white">
                      {t.cpfMasked} {t.customerName ? `· ${t.customerName}` : ''}
                    </p>
                    <p className="truncate text-[11px] text-zinc-400">
                      {t.movieTitle} ·{' '}
                      <span className={t.expired ? 'text-zinc-500' : 'text-emerald-400'}>
                        {t.expired
                          ? 'Expirado (filme acabou)'
                          : `Ativo até ${formatClockOnly(t.expiresAt)}`}
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void handleRevokeTicket(t.id)}
                    className="rounded-md border border-red-900/60 bg-red-950/40 p-1.5 text-red-400 hover:bg-red-950 cursor-pointer"
                    aria-label="Revogar acesso CPF"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Lista de Filmes Anunciados */}
      {sessions.length === 0 ? (
        <p className="rounded-xl border border-zinc-800 bg-zinc-950 px-4 py-6 text-center text-xs text-zinc-400">
          Nenhum filme anunciado ainda. Adicione acima para abrir a bilheteria do Cinema.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {sessions.map((item) => {
            const status = getSessionStatus(item, nowMs);
            return (
              <div
                key={item.id}
                className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 flex flex-col justify-between gap-3"
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 tabular-nums">
                    <span
                      className={
                        status.tone === 'live'
                          ? 'font-semibold text-emerald-400'
                          : status.tone === 'upcoming'
                            ? 'font-semibold text-amber-300'
                            : 'text-zinc-500'
                      }
                    >
                      {status.label}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono font-semibold text-emerald-300">
                      {item.ticketPrice || 'R$ 10,00'}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span>{formatSessionTimeLabel(item.startTime)}</span>
                    <span aria-hidden="true">·</span>
                    <span>{item.durationMinutes} min</span>
                  </div>
                  <h3 className="font-display text-lg font-bold text-white">{item.title}</h3>
                  {item.synopsis && <p className="text-xs text-zinc-400">{item.synopsis}</p>}
                  {item.videoUrl && (
                    <p className="truncate font-mono text-[11px] text-zinc-500">{item.videoUrl}</p>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 border-t border-zinc-800 pt-3">
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handlePlayNowQuick(item)}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-[#C8102E] px-3 py-1.5 text-xs font-semibold text-white hover:bg-red-700 cursor-pointer"
                  >
                    <Play className="h-3 w-3" />
                    Passar agora
                  </button>
                  <button
                    type="button"
                    onClick={() => setSelectedSessionId(item.id)}
                    className="rounded-lg border border-emerald-800/70 bg-emerald-950/40 px-3 py-1.5 text-xs font-semibold text-emerald-300 hover:bg-emerald-950 cursor-pointer"
                  >
                    Selecionar p/ CPF
                  </button>
                  <button
                    type="button"
                    onClick={() => startEditing(item)}
                    className="rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:bg-zinc-800 cursor-pointer"
                  >
                    Editar
                  </button>
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() => void handleDelete(item.id, item.title)}
                    className="ml-auto rounded-lg border border-red-900/60 bg-red-950/40 p-1.5 text-red-400 hover:bg-red-950 cursor-pointer"
                    aria-label={`Excluir ${item.title}`}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
