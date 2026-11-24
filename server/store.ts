import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export type UserRole = 'user' | 'admin';
export type SubscriptionStatus = 'ativo' | 'pendente' | 'vencido' | 'bloqueado';

export interface UserProfileRecord {
  id: string;
  nome: string;
  email: string;
  role: UserRole;
  status_assinatura: SubscriptionStatus;
  plano: string;
  expira_em: string | null;
  criado_em: string;
  passwordHash?: string;
}

export interface PaymentLogRecord {
  id: string;
  user_id: string;
  gateway: 'mercadopago' | 'asaas';
  evento_id: string;
  plano: string;
  status: string;
  processado_em: string;
}

export interface PublicAppConfig {
  whatsappNumber: string;
  pixKey: string;
  pixType: string;
  pixReceiverName: string;
  pixQrCodeDataUrl: string;
  tvOnlyAntiRetransmission: boolean;
  autoPublishEnabled: boolean;
  publishedSiteUrl: string;
  publishedApkUrl: string;
  publishedWebosUrl: string;
  lastPublishedAt: string | null;
  configVersion?: number;
}

export type PaymentRequestStatus = 'pendente' | 'liberado';

export interface PaymentRequestRecord {
  id: string;
  customerName: string;
  customerWhatsapp: string;
  deviceCode: string;
  planName: string;
  planPrice: string;
  planDays: number;
  customValidity: string;
  status: PaymentRequestStatus;
  activationKey?: string;
  expira_em?: string;
  diasLiberados?: number;
  createdAt: string;
  renewedAt?: string;
}

export interface DeveloperMessageRecord {
  id: string;
  senderName: string;
  senderWhatsapp: string;
  category: string;
  message: string;
  createdAt: string;
  expiresAt: string;
}

export interface AppDeviceRecord {
  deviceCode: string;
  platform: string;
  isTv: boolean;
  licenseActive: boolean;
  planName: string;
  isStreaming: boolean;
  firstSeenAt: string;
  lastSeenAt: string;
}

export interface ServerPlanRecord {
  id: string;
  name: string;
  subtitle: string;
  priceText: string;
  days: number;
  periodLabel: string;
  features: string[];
  featured: boolean;
  active: boolean;
  sortOrder: number;
}

export interface CinemaSessionRecord {
  id: string;
  title: string;
  videoUrl: string;
  posterUrl?: string;
  synopsis?: string;
  genre?: string;
  ticketPrice: string;
  startTime: string;
  durationMinutes: number;
  active: boolean;
  createdAt: string;
}

export type CinemaTicketStatus = 'pendente' | 'liberado' | 'revogado';

export interface CinemaTicketRecord {
  id: string;
  cpfDigits: string;
  cpfMasked: string;
  customerName?: string;
  sessionId: string;
  movieTitle: string;
  ticketPrice: string;
  status: CinemaTicketStatus;
  createdAt: string;
  releasedAt?: string;
  expiresAt: string;
}

interface StoreData {
  profiles: UserProfileRecord[];
  pagamentos: PaymentLogRecord[];
  adminWhatsapp?: string;
  publicConfig?: PublicAppConfig;
  customPlans?: ServerPlanRecord[];
  devices?: AppDeviceRecord[];
  paymentRequests?: PaymentRequestRecord[];
  developerMessages?: DeveloperMessageRecord[];
  adminPasscodeHash?: string;
  configVersion?: number;
  cinemaSchedule?: CinemaSessionRecord[];
  cinemaTickets?: CinemaTicketRecord[];
}

const DATA_DIR = path.resolve(process.cwd(), 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');

function daysFromNowIso(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
}

export function sanitizePixQrCodeUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 150000) return '';
  if (/^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/i.test(trimmed)) {
    return trimmed;
  }
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

const DEFAULT_PUBLIC_CONFIG: PublicAppConfig = {
  whatsappNumber: (process.env.ADMIN_WHATSAPP || '').replace(/\D/g, ''),
  pixKey: '',
  pixType: 'Aleatória',
  pixReceiverName: 'Jogos do Mengão',
  pixQrCodeDataUrl: '',
  tvOnlyAntiRetransmission: true,
  autoPublishEnabled: true,
  publishedSiteUrl: (process.env.APP_URL || '').replace(/\/$/, ''),
  publishedApkUrl: '/api/download-apk',
  publishedWebosUrl: '/api/download-webos',
  lastPublishedAt: null,
};

const INITIAL_SUBSCRIBERS: UserProfileRecord[] = [
  {
    id: 'usr-1001',
    nome: 'Marina Albuquerque',
    email: 'marina.albuquerque@studio.com.br',
    role: 'user',
    status_assinatura: 'ativo',
    plano: '3 Meses',
    expira_em: daysFromNowIso(24),
    criado_em: daysFromNowIso(-36),
  },
  {
    id: 'usr-1002',
    nome: 'Rafael Mendonça',
    email: 'rafael.mendonca@edtech.com.br',
    role: 'user',
    status_assinatura: 'ativo',
    plano: '1 Ano',
    expira_em: daysFromNowIso(18),
    criado_em: daysFromNowIso(-12),
  },
  {
    id: 'usr-1003',
    nome: 'Camila Ferreira',
    email: 'camila.ferreira@eventos.net',
    role: 'user',
    status_assinatura: 'vencido',
    plano: '1 Mês',
    expira_em: daysFromNowIso(-4),
    criado_em: daysFromNowIso(-64),
  },
];

function ensureStore(): StoreData {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(DATA_FILE)) {
    const initial: StoreData = {
      profiles: INITIAL_SUBSCRIBERS,
      pagamentos: [],
      adminWhatsapp: (process.env.ADMIN_WHATSAPP || '').replace(/\D/g, ''),
      publicConfig: DEFAULT_PUBLIC_CONFIG,
      devices: [],
    };
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), 'utf-8');
    return initial;
  }
  try {
    const raw = fs.readFileSync(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as StoreData;
    return {
      profiles: Array.isArray(parsed.profiles) ? parsed.profiles : [],
      pagamentos: Array.isArray(parsed.pagamentos) ? parsed.pagamentos : [],
      adminWhatsapp: typeof parsed.adminWhatsapp === 'string' ? parsed.adminWhatsapp : '',
      publicConfig: parsed.publicConfig
        ? {
            whatsappNumber:
              parsed.publicConfig.whatsappNumber || parsed.adminWhatsapp || DEFAULT_PUBLIC_CONFIG.whatsappNumber,
            pixKey: parsed.publicConfig.pixKey || '',
            pixType: parsed.publicConfig.pixType || 'Aleatória',
            pixReceiverName: parsed.publicConfig.pixReceiverName || 'Jogos do Mengão',
            pixQrCodeDataUrl: sanitizePixQrCodeUrl(parsed.publicConfig.pixQrCodeDataUrl),
            tvOnlyAntiRetransmission:
              typeof parsed.publicConfig.tvOnlyAntiRetransmission === 'boolean'
                ? parsed.publicConfig.tvOnlyAntiRetransmission
                : true,
            autoPublishEnabled:
              typeof parsed.publicConfig.autoPublishEnabled === 'boolean'
                ? parsed.publicConfig.autoPublishEnabled
                : true,
            publishedSiteUrl:
              typeof parsed.publicConfig.publishedSiteUrl === 'string'
                ? parsed.publicConfig.publishedSiteUrl
                : DEFAULT_PUBLIC_CONFIG.publishedSiteUrl,
            publishedApkUrl:
              typeof parsed.publicConfig.publishedApkUrl === 'string' && parsed.publicConfig.publishedApkUrl
                ? parsed.publicConfig.publishedApkUrl
                : '/api/download-apk',
            publishedWebosUrl:
              typeof parsed.publicConfig.publishedWebosUrl === 'string' && parsed.publicConfig.publishedWebosUrl
                ? parsed.publicConfig.publishedWebosUrl
                : '/api/download-webos',
            lastPublishedAt:
              typeof parsed.publicConfig.lastPublishedAt === 'string'
                ? parsed.publicConfig.lastPublishedAt
                : null,
          }
        : {
            ...DEFAULT_PUBLIC_CONFIG,
            whatsappNumber: parsed.adminWhatsapp || DEFAULT_PUBLIC_CONFIG.whatsappNumber,
          },
      devices: Array.isArray(parsed.devices) ? parsed.devices : [],
      customPlans: Array.isArray(parsed.customPlans) ? parsed.customPlans : undefined,
      paymentRequests: Array.isArray(parsed.paymentRequests) ? parsed.paymentRequests : [],
      developerMessages: Array.isArray(parsed.developerMessages) ? parsed.developerMessages : [],
      adminPasscodeHash:
        typeof parsed.adminPasscodeHash === 'string' ? parsed.adminPasscodeHash : undefined,
      configVersion:
        typeof parsed.configVersion === 'number' && Number.isFinite(parsed.configVersion)
          ? parsed.configVersion
          : 1,
      cinemaSchedule: Array.isArray(parsed.cinemaSchedule) ? parsed.cinemaSchedule : [],
      cinemaTickets: Array.isArray(parsed.cinemaTickets) ? parsed.cinemaTickets : [],
    };
  } catch {
    return {
      profiles: INITIAL_SUBSCRIBERS,
      pagamentos: [],
      adminWhatsapp: '',
      publicConfig: DEFAULT_PUBLIC_CONFIG,
      devices: [],
      paymentRequests: [],
      developerMessages: [],
      cinemaSchedule: [],
      cinemaTickets: [],
    };
  }
}

function saveStore(data: StoreData): void {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  const tmpFile = `${DATA_FILE}.tmp`;
  fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2), 'utf-8');
  fs.renameSync(tmpFile, DATA_FILE);
}

export function getConfigVersion(): number {
  const data = ensureStore();
  return typeof data.configVersion === 'number' ? data.configVersion : 1;
}

function bumpConfigVersion(data: StoreData): number {
  const next = (typeof data.configVersion === 'number' ? data.configVersion : 1) + 1;
  data.configVersion = next;
  return next;
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [salt, keyHex] = stored.split(':');
  if (!salt || !keyHex) return false;
  const keyBuf = Buffer.from(keyHex, 'hex');
  const derived = crypto.scryptSync(password, salt, 64);
  if (keyBuf.length !== derived.length) return false;
  return crypto.timingSafeEqual(keyBuf, derived);
}

export function sanitizeProfile(profile: UserProfileRecord) {
  const effectiveStatus =
    profile.status_assinatura === 'ativo' &&
    profile.expira_em &&
    new Date(profile.expira_em).getTime() <= Date.now()
      ? 'vencido'
      : profile.status_assinatura;

  const diasRestantes = profile.expira_em
    ? Math.max(
        0,
        Math.ceil((new Date(profile.expira_em).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
      )
    : 0;

  return {
    id: profile.id,
    nome: profile.nome,
    email: profile.email,
    role: profile.role,
    status_assinatura: effectiveStatus,
    plano: profile.plano,
    expira_em: profile.expira_em,
    dias_restantes: effectiveStatus === 'ativo' ? diasRestantes : 0,
    criado_em: profile.criado_em,
  };
}

function syncExpiredProfiles(data: StoreData): StoreData {
  let changed = false;
  const now = Date.now();
  data.profiles = data.profiles.map((p) => {
    if (p.status_assinatura === 'ativo' && p.expira_em && new Date(p.expira_em).getTime() <= now) {
      changed = true;
      return { ...p, status_assinatura: 'vencido' };
    }
    return p;
  });
  if (changed) saveStore(data);
  return data;
}

export function listProfiles(searchQuery = ''): ReturnType<typeof sanitizeProfile>[] {
  const data = syncExpiredProfiles(ensureStore());
  const q = searchQuery.trim().toLowerCase();
  const list = q
    ? data.profiles.filter(
        (p) => p.nome.toLowerCase().includes(q) || p.email.toLowerCase().includes(q)
      )
    : data.profiles;
  return list.map(sanitizeProfile);
}

export function findProfileByEmail(email: string): UserProfileRecord | undefined {
  const data = syncExpiredProfiles(ensureStore());
  return data.profiles.find((p) => p.email.toLowerCase() === email.trim().toLowerCase());
}

export function findProfileById(id: string): UserProfileRecord | undefined {
  const data = syncExpiredProfiles(ensureStore());
  return data.profiles.find((p) => p.id === id);
}

export function hasClaimedAdmin(): boolean {
  const data = ensureStore();
  return data.profiles.some((p) => p.role === 'admin' && Boolean(p.passwordHash));
}

export function hasClaimedAdminPasscode(): boolean {
  const data = ensureStore();
  return Boolean(data.adminPasscodeHash);
}

export function claimAdminPasscode(password: string): void {
  const data = ensureStore();
  if (data.adminPasscodeHash) {
    throw new Error('Senha de administrador já foi configurada anteriormente.');
  }
  data.adminPasscodeHash = hashPassword(password);
  saveStore(data);
}

export function verifyClaimedAdminPasscode(password: string): boolean {
  const data = ensureStore();
  if (!data.adminPasscodeHash) return false;
  return verifyPassword(password, data.adminPasscodeHash);
}

export function createUserProfile(input: {
  nome: string;
  email: string;
  password: string;
  role?: UserRole;
  plano?: string;
}): UserProfileRecord {
  const data = ensureStore();
  const normalizedEmail = input.email.trim().toLowerCase();
  if (data.profiles.some((p) => p.email.toLowerCase() === normalizedEmail)) {
    throw new Error('Já existe uma conta cadastrada com este e-mail.');
  }
  const created: UserProfileRecord = {
    id: `usr-${crypto.randomUUID().slice(0, 8)}`,
    nome: input.nome.trim(),
    email: normalizedEmail,
    role: input.role ?? 'user',
    status_assinatura: input.role === 'admin' ? 'ativo' : 'pendente',
    plano: input.plano ?? '1 Mês',
    expira_em: input.role === 'admin' ? daysFromNowIso(365) : null,
    criado_em: new Date().toISOString(),
    passwordHash: hashPassword(input.password),
  };
  data.profiles.unshift(created);
  saveStore(data);
  return created;
}

export function updateProfileById(
  id: string,
  updater: (current: UserProfileRecord) => UserProfileRecord
): UserProfileRecord | null {
  const data = ensureStore();
  const idx = data.profiles.findIndex((p) => p.id === id);
  if (idx === -1) return null;
  data.profiles[idx] = updater(data.profiles[idx]);
  saveStore(data);
  return data.profiles[idx];
}

export function activateSubscriptionDays(
  userId: string,
  days: number,
  plano?: string
): UserProfileRecord | null {
  return updateProfileById(userId, (current) => {
    const now = Date.now();
    const currentExp = current.expira_em ? new Date(current.expira_em).getTime() : 0;
    const baseMs = currentExp > now ? currentExp : now;
    const nextExp = new Date(baseMs + days * 24 * 60 * 60 * 1000).toISOString();
    return {
      ...current,
      status_assinatura: 'ativo',
      plano: plano ?? current.plano,
      expira_em: nextExp,
    };
  });
}

export function recordPaymentLog(entry: Omit<PaymentLogRecord, 'id' | 'processado_em'>): boolean {
  const data = ensureStore();
  if (data.pagamentos.some((p) => p.evento_id === entry.evento_id)) {
    return false;
  }
  data.pagamentos.unshift({
    id: `pay-${crypto.randomUUID().slice(0, 8)}`,
    ...entry,
    processado_em: new Date().toISOString(),
  });
  saveStore(data);
  return true;
}

export function listRecentPayments(): PaymentLogRecord[] {
  const data = ensureStore();
  return data.pagamentos.slice(0, 20);
}

export function getAdminWhatsapp(): string {
  const envNum = (process.env.ADMIN_WHATSAPP || '').replace(/\D/g, '');
  const data = ensureStore();
  const saved = (data.publicConfig?.whatsappNumber || data.adminWhatsapp || '').replace(/\D/g, '');
  return saved || envNum;
}

export function setAdminWhatsapp(rawPhone: string): string {
  const digits = rawPhone.replace(/\D/g, '').slice(0, 16);
  const data = ensureStore();
  data.adminWhatsapp = digits;
  data.publicConfig = {
    ...(data.publicConfig || DEFAULT_PUBLIC_CONFIG),
    whatsappNumber: digits,
  };
  bumpConfigVersion(data);
  saveStore(data);
  return digits;
}

export function getPublicAppConfig(): PublicAppConfig {
  const data = ensureStore();
  const cfg = data.publicConfig || DEFAULT_PUBLIC_CONFIG;
  return {
    ...DEFAULT_PUBLIC_CONFIG,
    ...cfg,
    pixQrCodeDataUrl: sanitizePixQrCodeUrl(cfg.pixQrCodeDataUrl),
    whatsappNumber: getAdminWhatsapp(),
    configVersion: typeof data.configVersion === 'number' ? data.configVersion : 1,
  };
}

export function updatePublicAppConfig(patch: Partial<PublicAppConfig>): PublicAppConfig {
  const data = ensureStore();
  const current = data.publicConfig || DEFAULT_PUBLIC_CONFIG;
  const nextWhatsapp =
    typeof patch.whatsappNumber === 'string'
      ? patch.whatsappNumber.replace(/\D/g, '').slice(0, 16)
      : current.whatsappNumber;

  const updated: PublicAppConfig = {
    whatsappNumber: nextWhatsapp,
    pixKey: typeof patch.pixKey === 'string' ? patch.pixKey.trim().slice(0, 140) : current.pixKey,
    pixType: typeof patch.pixType === 'string' ? patch.pixType.trim().slice(0, 20) : current.pixType,
    pixReceiverName:
      typeof patch.pixReceiverName === 'string'
        ? patch.pixReceiverName.trim().slice(0, 80)
        : current.pixReceiverName,
    pixQrCodeDataUrl:
      typeof patch.pixQrCodeDataUrl === 'string'
        ? sanitizePixQrCodeUrl(patch.pixQrCodeDataUrl)
        : current.pixQrCodeDataUrl,
    tvOnlyAntiRetransmission:
      typeof patch.tvOnlyAntiRetransmission === 'boolean'
        ? patch.tvOnlyAntiRetransmission
        : current.tvOnlyAntiRetransmission,
    autoPublishEnabled:
      typeof patch.autoPublishEnabled === 'boolean'
        ? patch.autoPublishEnabled
        : current.autoPublishEnabled,
    publishedSiteUrl:
      typeof patch.publishedSiteUrl === 'string'
        ? patch.publishedSiteUrl.trim().replace(/\/$/, '').slice(0, 240)
        : current.publishedSiteUrl,
    publishedApkUrl:
      typeof patch.publishedApkUrl === 'string'
        ? patch.publishedApkUrl.trim().slice(0, 240) || '/api/download-apk'
        : current.publishedApkUrl,
    publishedWebosUrl:
      typeof patch.publishedWebosUrl === 'string'
        ? patch.publishedWebosUrl.trim().slice(0, 240) || '/api/download-webos'
        : current.publishedWebosUrl,
    lastPublishedAt:
      typeof patch.lastPublishedAt === 'string' ? patch.lastPublishedAt : current.lastPublishedAt,
  };
  data.adminWhatsapp = nextWhatsapp;
  data.publicConfig = updated;
  const nextVersion = bumpConfigVersion(data);
  saveStore(data);
  return { ...updated, configVersion: nextVersion };
}

export function autoPublishDistribution(originUrl: string): PublicAppConfig {
  const cleanOrigin = originUrl.trim().replace(/\/$/, '');
  const apkUrl = cleanOrigin ? `${cleanOrigin}/api/download-apk` : '/api/download-apk';
  const webosUrl = cleanOrigin ? `${cleanOrigin}/api/download-webos` : '/api/download-webos';
  return updatePublicAppConfig({
    autoPublishEnabled: true,
    publishedSiteUrl: cleanOrigin,
    publishedApkUrl: apkUrl,
    publishedWebosUrl: webosUrl,
    lastPublishedAt: new Date().toISOString(),
  });
}

export function upsertDeviceHeartbeat(input: {
  deviceCode: string;
  platform: string;
  isTv: boolean;
  licenseActive: boolean;
  planName: string | null;
  isStreaming: boolean;
}): AppDeviceRecord {
  const code = input.deviceCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  if (!/^TC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    throw new Error('Código de aparelho inválido.');
  }

  const nowIso = new Date().toISOString();
  const data = ensureStore();
  const devices = data.devices || [];
  const idx = devices.findIndex((d) => d.deviceCode === code);

  const record: AppDeviceRecord = {
    deviceCode: code,
    platform: (input.platform || 'pwa').trim().slice(0, 24),
    isTv: Boolean(input.isTv),
    licenseActive: Boolean(input.licenseActive),
    planName: (input.planName || 'Aguardando').trim().slice(0, 60),
    isStreaming: Boolean(input.isStreaming),
    firstSeenAt: idx >= 0 ? devices[idx].firstSeenAt : nowIso,
    lastSeenAt: nowIso,
  };

  if (idx >= 0) {
    devices[idx] = record;
  } else {
    devices.unshift(record);
  }

  data.devices = devices.slice(0, 500);
  saveStore(data);
  return record;
}

export function getDeviceStats() {
  const data = ensureStore();
  const devices = [...(data.devices || [])].sort(
    (a, b) => new Date(b.lastSeenAt).getTime() - new Date(a.lastSeenAt).getTime()
  );
  const now = Date.now();
  const onlineThresholdMs = 3 * 60 * 1000;
  const onlineAgora = devices.filter(
    (d) => now - new Date(d.lastSeenAt).getTime() <= onlineThresholdMs
  ).length;
  const totalInstalados = devices.length;
  const ativosComLicenca = devices.filter((d) => d.licenseActive).length;
  const tvsConectadas = devices.filter((d) => d.isTv).length;
  const transmitindoAgora = devices.filter(
    (d) => d.isStreaming && now - new Date(d.lastSeenAt).getTime() <= onlineThresholdMs
  ).length;

  return {
    onlineAgora,
    totalInstalados,
    ativosComLicenca,
    tvsConectadas,
    transmitindoAgora,
    dispositivos: devices,
  };
}

// ==========================================
// Pré-Cadastro & Solicitações de Pagamento Pix -> "Renovar agora"
// ==========================================

export function createPaymentRequest(input: {
  customerName: string;
  customerWhatsapp: string;
  deviceCode: string;
  planName: string;
  planPrice: string;
  planDays: number;
  customValidity?: string;
}): PaymentRequestRecord {
  const customerName = input.customerName.trim().slice(0, 80);
  const customerWhatsapp = input.customerWhatsapp.replace(/\D/g, '').slice(0, 16);
  const deviceCode = input.deviceCode.trim().toUpperCase().replace(/[^A-Z0-9-]/g, '');
  const planName = input.planName.trim().slice(0, 60) || '1 Mês';
  const planPrice = input.planPrice.trim().slice(0, 40) || 'Sob consulta';
  const planDays = Math.max(0, Math.min(3650, Math.floor(Number(input.planDays) || 0)));
  const customValidity = (input.customValidity || '').trim().slice(0, 120);

  if (customerName.length < 2) {
    throw new Error('Informe seu nome completo no pré-cadastro.');
  }
  if (customerWhatsapp.length < 10) {
    throw new Error('Informe um número de WhatsApp válido com DDD.');
  }
  if (!/^TC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(deviceCode)) {
    throw new Error('Código do aparelho inválido.');
  }

  const data = ensureStore();
  const requests = data.paymentRequests || [];

  const record: PaymentRequestRecord = {
    id: `req-${crypto.randomUUID().slice(0, 10)}`,
    customerName,
    customerWhatsapp,
    deviceCode,
    planName,
    planPrice,
    planDays,
    customValidity,
    status: 'pendente',
    createdAt: new Date().toISOString(),
  };

  requests.unshift(record);
  data.paymentRequests = requests.slice(0, 500);
  saveStore(data);
  return record;
}

export function listPaymentRequests(): PaymentRequestRecord[] {
  const data = ensureStore();
  const list = [...(data.paymentRequests || [])];
  list.sort((a, b) => {
    if (a.status !== b.status) return a.status === 'pendente' ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
  return list;
}

export function findPaymentRequestById(id: string): PaymentRequestRecord | undefined {
  const data = ensureStore();
  return (data.paymentRequests || []).find((r) => r.id === id);
}

export function markPaymentRequestRenewed(
  id: string,
  payload: {
    activationKey: string;
    expira_em: string;
    dias: number;
    plano: string;
  }
): PaymentRequestRecord | null {
  const data = ensureStore();
  const requests = data.paymentRequests || [];
  const idx = requests.findIndex((r) => r.id === id);
  if (idx === -1) return null;

  requests[idx] = {
    ...requests[idx],
    status: 'liberado',
    activationKey: payload.activationKey,
    expira_em: payload.expira_em,
    diasLiberados: payload.dias,
    planName: payload.plano,
    renewedAt: new Date().toISOString(),
  };
  data.paymentRequests = requests;
  saveStore(data);
  return requests[idx];
}

export function deletePaymentRequestById(id: string): boolean {
  const data = ensureStore();
  const before = data.paymentRequests?.length || 0;
  data.paymentRequests = (data.paymentRequests || []).filter((r) => r.id !== id);
  if (data.paymentRequests.length !== before) {
    saveStore(data);
    return true;
  }
  return false;
}

// ==========================================
// Mensagens para o Desenvolvedor (Retenção automática de 5 dias + exclusão manual)
// ==========================================

const DEV_MESSAGE_RETENTION_MS = 5 * 24 * 60 * 60 * 1000;
const ALLOWED_DEV_MSG_CATEGORIES = new Set([
  'Suporte',
  'Pagamento',
  'Dúvida',
  'Sugestão',
  'Outro',
]);

export function purgeExpiredDeveloperMessages(existingData?: StoreData): number {
  const data = existingData || ensureStore();
  const list = data.developerMessages || [];
  const now = Date.now();
  const kept = list.filter((m) => {
    const expiresMs = m.expiresAt
      ? new Date(m.expiresAt).getTime()
      : new Date(m.createdAt).getTime() + DEV_MESSAGE_RETENTION_MS;
    return Number.isFinite(expiresMs) && expiresMs > now;
  });
  const removedCount = list.length - kept.length;
  if (removedCount > 0) {
    data.developerMessages = kept;
    saveStore(data);
  }
  return removedCount;
}

export function createDeveloperMessage(input: {
  senderName: string;
  senderWhatsapp?: string;
  category?: string;
  message: string;
}): DeveloperMessageRecord {
  const senderName = input.senderName.trim().slice(0, 80);
  const senderWhatsapp = (input.senderWhatsapp || '').replace(/\D/g, '').slice(0, 16);
  const rawCat = (input.category || 'Suporte').trim();
  const category = ALLOWED_DEV_MSG_CATEGORIES.has(rawCat) ? rawCat : 'Suporte';
  const message = input.message.trim().slice(0, 1000);

  if (senderName.length < 2) {
    throw new Error('Informe seu nome antes de enviar a mensagem.');
  }
  if (message.length < 5) {
    throw new Error('Escreva uma mensagem com pelo menos 5 caracteres.');
  }

  const data = ensureStore();
  purgeExpiredDeveloperMessages(data);

  const nowMs = Date.now();
  const record: DeveloperMessageRecord = {
    id: `msg-${crypto.randomUUID().slice(0, 10)}`,
    senderName,
    senderWhatsapp,
    category,
    message,
    createdAt: new Date(nowMs).toISOString(),
    expiresAt: new Date(nowMs + DEV_MESSAGE_RETENTION_MS).toISOString(),
  };

  data.developerMessages = [record, ...(data.developerMessages || [])].slice(0, 300);
  saveStore(data);
  return record;
}

export function listDeveloperMessages(): DeveloperMessageRecord[] {
  const data = ensureStore();
  purgeExpiredDeveloperMessages(data);
  return [...(data.developerMessages || [])].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function deleteDeveloperMessageById(id: string): boolean {
  const data = ensureStore();
  purgeExpiredDeveloperMessages(data);
  const before = data.developerMessages?.length || 0;
  data.developerMessages = (data.developerMessages || []).filter((m) => m.id !== id);
  if (data.developerMessages.length !== before) {
    saveStore(data);
    return true;
  }
  return false;
}

export function clearAllDeveloperMessages(): number {
  const data = ensureStore();
  const count = data.developerMessages?.length || 0;
  if (count > 0) {
    data.developerMessages = [];
    saveStore(data);
  }
  return count;
}

export function getCustomPlans(): ServerPlanRecord[] | undefined {
  const data = ensureStore();
  return Array.isArray(data.customPlans) && data.customPlans.length > 0
    ? [...data.customPlans].sort((a, b) => a.sortOrder - b.sortOrder)
    : undefined;
}

export function upsertCustomPlan(
  input: ServerPlanRecord,
  seedDefaults?: ServerPlanRecord[]
): ServerPlanRecord[] {
  const data = ensureStore();
  const baseList =
    Array.isArray(data.customPlans) && data.customPlans.length > 0
      ? [...data.customPlans]
      : Array.isArray(seedDefaults)
        ? [...seedDefaults]
        : [];
  const safeId =
    input.id
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 64) || `plan-${Date.now()}`;
  const cleanPlan: ServerPlanRecord = {
    id: safeId,
    name: String(input.name || 'Plano').trim().slice(0, 60),
    subtitle: String(input.subtitle || '').trim().slice(0, 140),
    priceText: String(input.priceText || 'Sob consulta').trim().slice(0, 40),
    days: Math.max(0, Math.min(3650, Math.floor(Number(input.days) || 0))),
    periodLabel: String(input.periodLabel || '· Pix ou WhatsApp').trim().slice(0, 40),
    features: Array.isArray(input.features)
      ? input.features.map((f) => String(f).trim().slice(0, 160)).filter(Boolean).slice(0, 8)
      : [],
    featured: Boolean(input.featured),
    active: input.active !== false,
    sortOrder: Math.max(0, Math.min(999, Math.floor(Number(input.sortOrder) || 99))),
  };
  const idx = baseList.findIndex((p) => p.id === safeId);
  if (idx >= 0) {
    baseList[idx] = cleanPlan;
  } else {
    baseList.push(cleanPlan);
  }
  baseList.sort((a, b) => a.sortOrder - b.sortOrder);
  data.customPlans = baseList;
  bumpConfigVersion(data);
  saveStore(data);
  return baseList;
}

export function deleteCustomPlan(
  planId: string,
  seedDefaults?: ServerPlanRecord[]
): ServerPlanRecord[] {
  const data = ensureStore();
  const safeId = planId.replace(/[^a-zA-Z0-9_-]/g, '');
  const baseList =
    Array.isArray(data.customPlans) && data.customPlans.length > 0
      ? [...data.customPlans]
      : Array.isArray(seedDefaults)
        ? [...seedDefaults]
        : [];
  data.customPlans = baseList.filter((p) => p.id !== safeId);
  bumpConfigVersion(data);
  saveStore(data);
  return data.customPlans;
}

function sanitizeMediaUrl(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > 1000) return '';
  if (trimmed.startsWith('/')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' ? parsed.toString() : '';
  } catch {
    return '';
  }
}

export function isFreeCinemaPrice(price?: string): boolean {
  const clean = String(price || '').trim().toLowerCase();
  return clean === 'gratuito' || clean === 'grátis' || clean === 'gratis' || clean === 'r$ 0,00' || clean === '0';
}

export function listCinemaSessions(onlyActive = false): CinemaSessionRecord[] {
  const data = ensureStore();
  const list = Array.isArray(data.cinemaSchedule) ? [...data.cinemaSchedule] : [];
  const normalized = list.map((s) => ({
    ...s,
    ticketPrice: String(s.ticketPrice || '').trim() || 'R$ 10,00',
  }));
  const filtered = onlyActive ? normalized.filter((s) => s.active !== false) : normalized;
  return filtered.sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );
}

export function listCinemaSessionsPublic(onlyActive = true) {
  return listCinemaSessions(onlyActive).map((s) => ({
    id: s.id,
    title: s.title,
    posterUrl: s.posterUrl,
    synopsis: s.synopsis,
    genre: s.genre,
    ticketPrice: s.ticketPrice,
    isFree: isFreeCinemaPrice(s.ticketPrice),
    startTime: s.startTime,
    durationMinutes: s.durationMinutes,
    active: s.active,
    createdAt: s.createdAt,
    ...(isFreeCinemaPrice(s.ticketPrice) ? { videoUrl: s.videoUrl } : {}),
  }));
}

export function getCinemaSessionById(sessionId: string): CinemaSessionRecord | undefined {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, '');
  return listCinemaSessions(false).find((s) => s.id === safeId);
}

export function upsertCinemaSession(input: {
  id?: string;
  title: string;
  videoUrl: string;
  posterUrl?: string;
  synopsis?: string;
  genre?: string;
  ticketPrice?: string;
  startTime: string;
  durationMinutes?: number;
  active?: boolean;
}): CinemaSessionRecord[] {
  const cleanTitle = String(input.title || '').trim().slice(0, 120);
  const cleanVideoUrl = sanitizeMediaUrl(input.videoUrl);
  const parsedStart = new Date(input.startTime);

  if (cleanTitle.length < 2) {
    throw new Error('Informe o título do filme.');
  }
  if (!cleanVideoUrl) {
    throw new Error('Informe uma URL de vídeo válida (https://... ou http://...).');
  }
  if (Number.isNaN(parsedStart.getTime())) {
    throw new Error('Informe uma data e horário válidos para a sessão.');
  }

  const data = ensureStore();
  const list = Array.isArray(data.cinemaSchedule) ? [...data.cinemaSchedule] : [];
  const safeId =
    (input.id || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]/g, '-')
      .replace(/-+/g, '-')
      .slice(0, 64) || `cine-${crypto.randomUUID().slice(0, 8)}`;

  const existing = list.find((s) => s.id === safeId);
  const durationMinutes = Math.max(
    5,
    Math.min(720, Math.floor(Number(input.durationMinutes) || 120))
  );
  const cleanPrice =
    String(input.ticketPrice ?? existing?.ticketPrice ?? 'R$ 10,00')
      .trim()
      .slice(0, 40) || 'R$ 10,00';

  const record: CinemaSessionRecord = {
    id: safeId,
    title: cleanTitle,
    videoUrl: cleanVideoUrl,
    posterUrl: sanitizeMediaUrl(input.posterUrl),
    synopsis: String(input.synopsis || '').trim().slice(0, 400),
    genre: String(input.genre || 'Filme').trim().slice(0, 40) || 'Filme',
    ticketPrice: cleanPrice,
    startTime: parsedStart.toISOString(),
    durationMinutes,
    active: input.active !== false,
    createdAt: existing?.createdAt || new Date().toISOString(),
  };

  const idx = list.findIndex((s) => s.id === safeId);
  if (idx >= 0) {
    list[idx] = record;
  } else {
    list.push(record);
  }
  list.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  data.cinemaSchedule = list.slice(0, 100);

  // Atualiza validade (até o filme acabar) de ingressos já emitidos para esta sessão
  const sessionEndIso = new Date(
    parsedStart.getTime() + durationMinutes * 60_000
  ).toISOString();
  if (Array.isArray(data.cinemaTickets)) {
    data.cinemaTickets = data.cinemaTickets.map((t) =>
      t.sessionId === safeId
        ? {
            ...t,
            movieTitle: record.title,
            ticketPrice: record.ticketPrice,
            expiresAt: sessionEndIso,
          }
        : t
    );
  }

  bumpConfigVersion(data);
  saveStore(data);
  return listCinemaSessions(false);
}

export function deleteCinemaSession(id: string): CinemaSessionRecord[] {
  const data = ensureStore();
  const safeId = id.replace(/[^a-zA-Z0-9_-]/g, '');
  data.cinemaSchedule = (data.cinemaSchedule || []).filter((s) => s.id !== safeId);
  data.cinemaTickets = (data.cinemaTickets || []).filter((t) => t.sessionId !== safeId);
  bumpConfigVersion(data);
  saveStore(data);
  return listCinemaSessions(false);
}

export function normalizeCpfDigits(raw: unknown): string {
  return String(raw || '').replace(/\D/g, '').slice(0, 11);
}

export function maskCpfDigits(digits: string): string {
  if (digits.length !== 11) return '***.***.***-**';
  return `***.${digits.slice(3, 6)}.${digits.slice(6, 9)}-**`;
}

function computeSessionEndIso(session: CinemaSessionRecord): string {
  const startMs = new Date(session.startTime).getTime();
  return new Date(startMs + session.durationMinutes * 60_000).toISOString();
}

export function requestCinemaCpfTicket(input: {
  cpf: string;
  sessionId: string;
  customerName?: string;
}): CinemaTicketRecord {
  const cpfDigits = normalizeCpfDigits(input.cpf);
  if (cpfDigits.length !== 11) {
    throw new Error('Informe um CPF válido com 11 números.');
  }
  const session = getCinemaSessionById(input.sessionId);
  if (!session || session.active === false) {
    throw new Error('Filme ou sessão de cinema não encontrada.');
  }
  const expiresAt = computeSessionEndIso(session);
  if (new Date(expiresAt).getTime() <= Date.now()) {
    throw new Error('Esta sessão de cinema já terminou.');
  }

  const data = ensureStore();
  const tickets = Array.isArray(data.cinemaTickets) ? [...data.cinemaTickets] : [];
  const existing = tickets.find(
    (t) =>
      t.cpfDigits === cpfDigits &&
      t.sessionId === session.id &&
      t.status !== 'revogado'
  );
  if (existing) {
    if (input.customerName?.trim()) {
      existing.customerName = input.customerName.trim().slice(0, 80);
      saveStore(data);
    }
    return existing;
  }

  const record: CinemaTicketRecord = {
    id: `tkt-${crypto.randomUUID().slice(0, 8)}`,
    cpfDigits,
    cpfMasked: maskCpfDigits(cpfDigits),
    customerName: String(input.customerName || '').trim().slice(0, 80) || undefined,
    sessionId: session.id,
    movieTitle: session.title,
    ticketPrice: session.ticketPrice,
    status: 'pendente',
    createdAt: new Date().toISOString(),
    expiresAt,
  };
  tickets.unshift(record);
  data.cinemaTickets = tickets.slice(0, 500);
  saveStore(data);
  return record;
}

export function releaseCinemaCpfTicket(input: {
  cpf: string;
  sessionId: string;
  customerName?: string;
}): CinemaTicketRecord {
  const cpfDigits = normalizeCpfDigits(input.cpf);
  if (cpfDigits.length !== 11) {
    throw new Error('Informe um CPF válido com 11 números.');
  }
  const session = getCinemaSessionById(input.sessionId);
  if (!session) {
    throw new Error('Selecione um filme agendado para liberar o ingresso.');
  }
  const expiresAt = computeSessionEndIso(session);
  if (new Date(expiresAt).getTime() <= Date.now()) {
    throw new Error('Este filme já encerrou. Ajuste o horário ou clique em Passar agora.');
  }

  const data = ensureStore();
  const tickets = Array.isArray(data.cinemaTickets) ? [...data.cinemaTickets] : [];
  const existingIdx = tickets.findIndex(
    (t) => t.cpfDigits === cpfDigits && t.sessionId === session.id
  );
  const nowIso = new Date().toISOString();
  const record: CinemaTicketRecord = {
    id: existingIdx >= 0 ? tickets[existingIdx].id : `tkt-${crypto.randomUUID().slice(0, 8)}`,
    cpfDigits,
    cpfMasked: maskCpfDigits(cpfDigits),
    customerName:
      String(input.customerName || '').trim().slice(0, 80) ||
      (existingIdx >= 0 ? tickets[existingIdx].customerName : undefined),
    sessionId: session.id,
    movieTitle: session.title,
    ticketPrice: session.ticketPrice,
    status: 'liberado',
    createdAt: existingIdx >= 0 ? tickets[existingIdx].createdAt : nowIso,
    releasedAt: nowIso,
    expiresAt,
  };

  if (existingIdx >= 0) {
    tickets[existingIdx] = record;
  } else {
    tickets.unshift(record);
  }
  data.cinemaTickets = tickets.slice(0, 500);
  bumpConfigVersion(data);
  saveStore(data);
  return record;
}

export function revokeCinemaCpfTicket(ticketId: string): boolean {
  const data = ensureStore();
  const safeId = ticketId.replace(/[^a-zA-Z0-9_-]/g, '');
  const before = Array.isArray(data.cinemaTickets) ? data.cinemaTickets.length : 0;
  data.cinemaTickets = (data.cinemaTickets || []).filter((t) => t.id !== safeId);
  if (data.cinemaTickets.length === before) return false;
  bumpConfigVersion(data);
  saveStore(data);
  return true;
}

export function listCinemaTicketsAdmin(): Array<CinemaTicketRecord & { expired: boolean }> {
  const data = ensureStore();
  const now = Date.now();
  const tickets = Array.isArray(data.cinemaTickets) ? [...data.cinemaTickets] : [];
  const cleaned = tickets.filter((t) => now - new Date(t.expiresAt).getTime() < 24 * 60 * 60 * 1000);
  if (cleaned.length !== tickets.length) {
    data.cinemaTickets = cleaned;
    saveStore(data);
  }
  return cleaned
    .map((t) => ({
      ...t,
      expired: new Date(t.expiresAt).getTime() <= now,
    }))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

export function verifyCinemaAccessByCpf(rawCpf: string, requestedSessionId?: string): {
  cpfDigits: string;
  cpfMasked: string;
  authorized: boolean;
  tickets: Array<{
    id: string;
    sessionId: string;
    movieTitle: string;
    ticketPrice: string;
    status: CinemaTicketStatus;
    expiresAt: string;
  }>;
  unlockedSessions: CinemaSessionRecord[];
} {
  const cpfDigits = normalizeCpfDigits(rawCpf);
  if (cpfDigits.length !== 11) {
    throw new Error('Informe um CPF válido com 11 números.');
  }
  const now = Date.now();
  const sessions = listCinemaSessions(true);
  const data = ensureStore();
  const allTickets = Array.isArray(data.cinemaTickets) ? data.cinemaTickets : [];

  const matchingTickets = allTickets.filter(
    (t) =>
      t.cpfDigits === cpfDigits &&
      (!requestedSessionId || t.sessionId === requestedSessionId) &&
      new Date(t.expiresAt).getTime() > now
  );

  const activeReleasedIds = new Set(
    matchingTickets.filter((t) => t.status === 'liberado').map((t) => t.sessionId)
  );

  const unlockedSessions = sessions.filter((s) => {
    const endMs = new Date(computeSessionEndIso(s)).getTime();
    if (endMs <= now) return false;
    return activeReleasedIds.has(s.id) || isFreeCinemaPrice(s.ticketPrice);
  });

  return {
    cpfDigits,
    cpfMasked: maskCpfDigits(cpfDigits),
    authorized: unlockedSessions.some((s) => activeReleasedIds.has(s.id)) || activeReleasedIds.size > 0,
    tickets: matchingTickets.map((t) => ({
      id: t.id,
      sessionId: t.sessionId,
      movieTitle: t.movieTitle,
      ticketPrice: t.ticketPrice,
      status: t.status,
      expiresAt: t.expiresAt,
    })),
    unlockedSessions,
  };
}
