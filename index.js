import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  Colors,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  PermissionFlagsBits,
  REST,
  Routes,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import express from 'express';
import crypto from 'crypto';
import fs from 'fs';
import { createServer } from 'http';
import path from 'path';
import { Server as SocketIOServer } from 'socket.io';

const { DISCORD_TOKEN, DISCORD_APP_ID, GUILD_ID } = process.env;
const DISCORD_CLIENT_SECRET = String(process.env.DISCORD_CLIENT_SECRET || '').trim();
if (!DISCORD_TOKEN || !DISCORD_APP_ID || !GUILD_ID) {
  throw new Error('Brak env DISCORD_TOKEN / DISCORD_APP_ID / GUILD_ID');
}

const CONFIG_OWNER_IDS = ['1034884709479612436', '1378291577973379117'];
const MANDATE_PAYMENT_USER_ID = '1034884709479612436';
const EARNINGS_ROLE_ID = '1495385016656593007';
const PANEL_PORT = Number(process.env.PORT || 3000);
const PANEL_ADMIN_KEY = (process.env.PANEL_ADMIN_KEY || '').trim();
const PANEL_BASE_URL = String(process.env.PANEL_BASE_URL || `http://localhost:${PANEL_PORT}`).replace(/\/$/, '');
const DISCORD_OAUTH_REDIRECT_URI = `${PANEL_BASE_URL}/api/panel/discord/callback`;
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.cwd();
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const CONFIG_BACKUP_PATH = path.join(DATA_DIR, 'config.backup.json');
const CONFIG_TEMP_PATH = path.join(DATA_DIR, 'config.json.tmp');
const PANEL_DIR = path.join(process.cwd(), 'panel');
const PANEL_PERMISSION_KEYS = [
  'viewKartoteka',
  'editKartoteka',
  'viewMandaty',
  'editMandaty',
  'deleteMandaty',
  'viewAreszty',
  'editAreszty',
  'deleteAreszty',
  'viewZarobek'
];

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers]
});

let panelIo = null;
let panelServer = null;
let panelVersion = Date.now();
const panelSessions = new Map();
const discordOAuthStates = new Map();

if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let guildConfig = {};

function readConfigFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function loadConfig() {
  try {
    guildConfig = readConfigFile(CONFIG_PATH) ?? readConfigFile(CONFIG_BACKUP_PATH) ?? {};
  } catch {
    try {
      guildConfig = readConfigFile(CONFIG_BACKUP_PATH) ?? {};
    } catch {
      guildConfig = {};
    }
  }
}

function saveConfig() {
  const payload = JSON.stringify(guildConfig, null, 2);
  fs.writeFileSync(CONFIG_TEMP_PATH, payload, 'utf8');
  fs.renameSync(CONFIG_TEMP_PATH, CONFIG_PATH);
  fs.writeFileSync(CONFIG_BACKUP_PATH, payload, 'utf8');
  panelVersion = Date.now();
  broadcastDashboardUpdate('config-saved');
}

function ensureGuild(guildId) {
  const cfg = guildConfig[guildId] || {};
  cfg.mandateCommandChannelId = cfg.mandateCommandChannelId ?? null;
  cfg.mandateInfoChannelId = cfg.mandateInfoChannelId ?? null;
  cfg.mandateRoleIds = Array.isArray(cfg.mandateRoleIds) ? cfg.mandateRoleIds : [];
  cfg.mandateUserIds = Array.isArray(cfg.mandateUserIds) ? cfg.mandateUserIds : [];
  cfg.mandates = Array.isArray(cfg.mandates) ? cfg.mandates : [];
  cfg.arrestCommandChannelId = cfg.arrestCommandChannelId ?? null;
  cfg.arrestInfoChannelId = cfg.arrestInfoChannelId ?? null;
  cfg.arrestRoleIds = Array.isArray(cfg.arrestRoleIds) ? cfg.arrestRoleIds : [];
  cfg.arrestUserIds = Array.isArray(cfg.arrestUserIds) ? cfg.arrestUserIds : [];
  cfg.arrests = Array.isArray(cfg.arrests) ? cfg.arrests : [];
  cfg.robloxNickChannelId = cfg.robloxNickChannelId ?? null;
  cfg.robloxNickVerifiedRoleId = cfg.robloxNickVerifiedRoleId ?? null;
  cfg.kartotekaChannelId = cfg.kartotekaChannelId ?? null;
  cfg.kartotekaPanelMessageId = cfg.kartotekaPanelMessageId ?? null;
  cfg.kartotekaRoleIds = Array.isArray(cfg.kartotekaRoleIds) ? cfg.kartotekaRoleIds : [];
  cfg.kartotekaUserIds = Array.isArray(cfg.kartotekaUserIds) ? cfg.kartotekaUserIds : [];
  cfg.kartoteki = Array.isArray(cfg.kartoteki) ? cfg.kartoteki : [];
  guildConfig[guildId] = cfg;
  return cfg;
}

loadConfig();

function isConfigOwner(userId) {
  return CONFIG_OWNER_IDS.includes(userId);
}

function ensurePanelAuthStore() {
  const store = guildConfig.__panelAuth || {};
  store.users = Array.isArray(store.users) ? store.users : [];
  store.activityLogs = Array.isArray(store.activityLogs) ? store.activityLogs : [];
  guildConfig.__panelAuth = store;
  return store;
}

function getDefaultPanelPermissions() {
  return {
    viewKartoteka: false,
    editKartoteka: false,
    viewMandaty: false,
    editMandaty: false,
    deleteMandaty: false,
    viewAreszty: false,
    editAreszty: false,
    deleteAreszty: false,
    viewZarobek: false
  };
}

function normalizePanelPermissions(input = {}) {
  const defaults = getDefaultPanelPermissions();
  for (const key of PANEL_PERMISSION_KEYS) {
    defaults[key] = Boolean(input[key]);
  }
  return defaults;
}

function serializePanelUser(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName ?? user.username,
    accountType: user.accountType ?? 'uzytkownik',
    discordUserId: user.discordUserId ?? null,
    createdAt: user.createdAt,
    permissions: normalizePanelPermissions(user.permissions),
    canEditPermissions: (user.accountType ?? 'uzytkownik') === 'policjant'
  };
}

function getPoliceDefaultPermissions() {
  return {
    viewKartoteka: true,
    editKartoteka: true,
    viewMandaty: true,
    editMandaty: true,
    deleteMandaty: false,
    viewAreszty: true,
    editAreszty: true,
    deleteAreszty: false,
    viewZarobek: true
  };
}

function getRestrictedUserPermissions() {
  return {
    viewKartoteka: false,
    editKartoteka: false,
    viewMandaty: true,
    editMandaty: false,
    deleteMandaty: false,
    viewAreszty: true,
    editAreszty: false,
    deleteAreszty: false,
    viewZarobek: false
  };
}

function ensureUniquePanelUsername(baseUsername, currentUserId = '') {
  const normalizedBase = normalizePanelUsername(baseUsername) || `discord-${currentUserId}`;
  const store = ensurePanelAuthStore();
  let candidate = normalizedBase;
  let suffix = 1;

  while (store.users.some(user => user.id !== currentUserId && user.username === candidate)) {
    suffix += 1;
    candidate = `${normalizedBase}-${suffix}`;
  }

  return candidate;
}

function buildDiscordPanelDisplayName(member) {
  return member.displayName ?? member.user.globalName ?? member.user.username;
}

function upsertDiscordPanelUser(member) {
  const store = ensurePanelAuthStore();
  const displayName = buildDiscordPanelDisplayName(member);
  const isPolice = member.roles?.cache?.has(EARNINGS_ROLE_ID) ?? false;
  const accountType = isPolice ? 'policjant' : 'uzytkownik';
  const stableId = `DSP-${member.id}`;
  let account = store.users.find(user => user.discordUserId === member.id || user.id === stableId);

  if (!account) {
    account = {
      id: stableId,
      discordUserId: member.id,
      username: ensureUniquePanelUsername(displayName, stableId),
      displayName,
      accountType,
      permissions: isPolice ? getPoliceDefaultPermissions() : getRestrictedUserPermissions(),
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    store.users.unshift(account);
    return account;
  }

  account.discordUserId = member.id;
  account.displayName = displayName;
  account.accountType = accountType;
  account.username = ensureUniquePanelUsername(displayName, account.id);
  account.updatedAt = Date.now();

  if (accountType === 'policjant') {
    account.permissions = normalizePanelPermissions(
      Object.keys(account.permissions || {}).length ? account.permissions : getPoliceDefaultPermissions()
    );
  } else {
    account.permissions = getRestrictedUserPermissions();
  }

  return account;
}

function createPanelActor(session) {
  if (session?.role === 'owner') {
    return {
      role: 'owner',
      username: 'wlasciciel',
      label: 'Wlasciciel'
    };
  }

  const username = session?.username || 'nieznany';
  return {
    role: 'user',
    username,
    label: session?.displayName || username
  };
}

function addPanelActivityLog(session, action, details, extra = {}) {
  const store = ensurePanelAuthStore();
  const actor = createPanelActor(session);
  store.activityLogs.unshift({
    id: `LOG-${crypto.randomBytes(4).toString('hex').toUpperCase()}`,
    actorRole: actor.role,
    actorUsername: actor.username,
    actorLabel: actor.label,
    action,
    details,
    createdAt: Date.now(),
    ...extra
  });
  if (store.activityLogs.length > 500) {
    store.activityLogs.length = 500;
  }
}

function serializeActivityLog(entry) {
  return {
    id: entry.id,
    actorRole: entry.actorRole,
    actorUsername: entry.actorUsername,
    actorLabel: entry.actorLabel,
    action: entry.action,
    details: entry.details,
    createdAt: entry.createdAt,
    createdAtLabel: formatDateTime(entry.createdAt)
  };
}

function normalizePanelUsername(value) {
  return String(value || '').trim().toLowerCase();
}

function hashPanelPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const normalizedPassword = String(password || '');
  const hash = crypto.scryptSync(normalizedPassword, salt, 64).toString('hex');
  return { salt, hash };
}

function verifyPanelPassword(password, expectedHash, salt) {
  const candidate = crypto.scryptSync(String(password || ''), salt, 64);
  const expected = Buffer.from(expectedHash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

function generatePanelSession(role, username = '', userId = '', extra = {}) {
  const token = crypto.randomBytes(24).toString('hex');
  panelSessions.set(token, {
    role,
    username,
    userId,
    createdAt: Date.now(),
    ...extra
  });
  return token;
}

function invalidateUserSessions(username = '', userId = '') {
  const normalized = normalizePanelUsername(username);

  for (const [token, session] of panelSessions.entries()) {
    if (
      session.role === 'user' &&
      ((userId && session.userId === userId) || (normalized && normalizePanelUsername(session.username) === normalized))
    ) {
      panelSessions.delete(token);
    }
  }

  if (panelIo) {
    for (const socket of panelIo.sockets.sockets.values()) {
      const session = socket.data?.panelSession;
      if (
        session?.role === 'user' &&
        ((userId && session.userId === userId) || (normalized && normalizePanelUsername(session.username) === normalized))
      ) {
        socket.emit('panel:force-logout');
        socket.disconnect(true);
      }
    }
  }
}

function extractPanelToken(req) {
  const bearer = req.headers.authorization?.replace(/^Bearer\s+/i, '').trim();
  const headerToken = typeof req.headers['x-panel-key'] === 'string' ? req.headers['x-panel-key'].trim() : '';
  return bearer || headerToken || '';
}

function getPanelSessionFromToken(token) {
  if (!token) return null;
  return panelSessions.get(token) ?? null;
}

function requirePanelAuth(req, res, next) {
  const session = getPanelSessionFromToken(extractPanelToken(req));
  if (session) {
    req.panelSession = session;
    if (session.role === 'user') {
      const store = ensurePanelAuthStore();
      const account = store.users.find(user => user.id === session.userId || user.username === normalizePanelUsername(session.username));
      if (!account) {
        panelSessions.delete(extractPanelToken(req));
        res.status(401).json({ error: 'Sesja wygasla.' });
        return;
      }
      req.panelUser = account;
      req.panelSession.displayName = account.displayName ?? account.username;
      req.panelSession.accountType = account.accountType ?? 'uzytkownik';
      req.panelSession.discordUserId = account.discordUserId ?? null;
      req.panelPermissions = account.accountType === 'policjant'
        ? normalizePanelPermissions(account.permissions)
        : getRestrictedUserPermissions();
    } else {
      req.panelPermissions = null;
    }
    next();
    return;
  }

  res.status(401).json({ error: 'Brak dostepu do panelu.' });
}

function requirePanelOwner(req, res, next) {
  if (req.panelSession?.role === 'owner') {
    next();
    return;
  }

  res.status(403).json({ error: 'Ta sekcja jest tylko dla wlasciciela.' });
}

function requirePanelOfficer(req, res, next) {
  if (req.panelSession?.role === 'owner') {
    next();
    return;
  }

  if (req.panelUser?.accountType === 'policjant') {
    next();
    return;
  }

  res.status(403).json({ error: 'Ta sekcja jest tylko dla policjantow.' });
}

function requirePanelPermission(permissionKey) {
  return (req, res, next) => {
    if (req.panelSession?.role === 'owner') {
      next();
      return;
    }

    if (req.panelPermissions?.[permissionKey]) {
      next();
      return;
    }

    res.status(403).json({ error: 'Brak wymaganej permisji.' });
  };
}

function broadcastDashboardUpdate(reason = 'manual', guildId = null) {
  if (!panelIo) return;
  const payload = {
    reason,
    guildId,
    version: panelVersion,
    updatedAt: new Date(panelVersion).toISOString()
  };

  if (guildId) {
    panelIo.to(`guild:${guildId}`).emit('dashboard:update', payload);
    return;
  }

  panelIo.emit('dashboard:update', payload);
}

function isSupportedTextChannel(channel) {
  return !!channel && typeof channel.isTextBased === 'function' && channel.isTextBased();
}

function isValidRobloxNick(input) {
  const raw = (input || '').trim();
  return /^[A-Za-z0-9_]{3,20}$/.test(raw);
}

function formatPermissionList(roleIds = [], userIds = []) {
  const roles = roleIds.length ? roleIds.map(id => `<@&${id}>`).join(', ') : 'brak';
  const users = userIds.length ? userIds.map(id => `<@${id}>`).join(', ') : 'brak';
  return `Role: ${roles}\nUzytkownicy: ${users}`;
}

function updatePermissionEntries(ids, entityId, action) {
  if (!Array.isArray(ids) || !entityId) return;
  if (action === 'dodaj') {
    if (!ids.includes(entityId)) ids.push(entityId);
    return;
  }
  if (action === 'usun') {
    const next = ids.filter(id => id !== entityId);
    ids.length = 0;
    ids.push(...next);
  }
}

function hasMandatePermission(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (cfg.mandateUserIds.includes(member.id)) return true;
  return member.roles?.cache?.some(role => cfg.mandateRoleIds.includes(role.id)) ?? false;
}

function hasArrestPermission(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (cfg.arrestUserIds.includes(member.id)) return true;
  return member.roles?.cache?.some(role => cfg.arrestRoleIds.includes(role.id)) ?? false;
}

function hasKartotekaPermission(member, cfg) {
  if (!member) return false;
  if (member.permissions?.has(PermissionFlagsBits.Administrator)) return true;
  if (cfg.kartotekaUserIds.includes(member.id)) return true;
  return member.roles?.cache?.some(role => cfg.kartotekaRoleIds.includes(role.id)) ?? false;
}

function generateMandateId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let output = 'MANDAT-';
  for (let i = 0; i < 6; i++) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

function generateArrestId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let output = 'ARREST-';
  for (let i = 0; i < 6; i++) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

function generateKartotekaEntryId() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let output = 'WPIS-';
  for (let i = 0; i < 6; i++) {
    output += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return output;
}

function sanitizeChannelName(input) {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50) || 'mandat';
}

function getMandateStatusLabel(status) {
  if (status === 'odrzucony-oczekuje-platnosci') return 'Odrzucony, ale nadal mozna zaplacic';
  if (status === 'oczekiwanie-na-zaplate') return 'Oczekiwanie na zaplate';
  if (status === 'zaplacony') return 'Mandat oplacony';
  if (status === 'zamkniety') return 'Zamkniety';
  return 'Oczekuje na decyzje';
}

function getArrestTypeLabel(type) {
  return type === 'wiezienie' ? 'Pojscie do wiezienia' : 'Areszt';
}

function getMandateComponents(
  mandateId,
  { payDisabled = false, rejectDisabled = false, paidDisabled = true, closeDisabled = false } = {}
) {
  const decisionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mandat_zaplac:${mandateId}`)
      .setLabel('ZAPLAC')
      .setStyle(ButtonStyle.Success)
      .setDisabled(payDisabled),
    new ButtonBuilder()
      .setCustomId(`mandat_odrzuc:${mandateId}`)
      .setLabel('ODRZUC')
      .setStyle(ButtonStyle.Danger)
      .setDisabled(rejectDisabled)
  );

  const paidRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mandat_oplacono:${mandateId}`)
      .setLabel('OPLACONO')
      .setStyle(ButtonStyle.Primary)
      .setDisabled(paidDisabled)
  );

  const closeRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`mandat_zamknij:${mandateId}`)
      .setLabel('ZAMKNIJ SPRAWE')
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(closeDisabled)
  );

  return [decisionRow, paidRow, closeRow];
}

function getMandateComponentState(status) {
  if (status === 'zamkniety') {
    return {
      payDisabled: true,
      rejectDisabled: true,
      paidDisabled: true,
      closeDisabled: true
    };
  }

  if (status === 'zaplacony') {
    return {
      payDisabled: true,
      rejectDisabled: true,
      paidDisabled: true,
      closeDisabled: false
    };
  }

  if (status === 'oczekiwanie-na-zaplate') {
    return {
      payDisabled: true,
      rejectDisabled: true,
      paidDisabled: false,
      closeDisabled: false
    };
  }

  if (status === 'odrzucony-oczekuje-platnosci') {
    return {
      payDisabled: false,
      rejectDisabled: true,
      paidDisabled: true,
      closeDisabled: false
    };
  }

  return {
    payDisabled: false,
    rejectDisabled: false,
    paidDisabled: true,
    closeDisabled: false
  };
}

function getMandateStatusColor(status) {
  if (status === 'zamkniety') return Colors.DarkGrey;
  if (status === 'zaplacony') return Colors.Green;
  if (status === 'oczekiwanie-na-zaplate') return Colors.Green;
  if (status === 'odrzucony-oczekuje-platnosci') return Colors.Red;
  return Colors.Orange;
}

function getMandateInstructionContent(status, actorId = '') {
  if (status === 'zamkniety') {
    return actorId
      ? `Sprawa zostala zamknieta przez <@${actorId}>. Kanal zostanie usuniety za chwile.`
      : 'Sprawa zostala zamknieta. Kanal zostanie usuniety za chwile.';
  }

  if (status === 'zaplacony') {
    return 'Mandat oplacony.';
  }

  if (status === 'oczekiwanie-na-zaplate') {
    return `Wejdz na serwer Fordon RP i przelej kase w ekonomii do <@${MANDATE_PAYMENT_USER_ID}>. Po przelewie osoba, ktora wystawila mandat, potwierdzi oplacenie.`;
  }

  if (status === 'odrzucony-oczekuje-platnosci') {
    return 'Mandat zostal odrzucony. Jesli zmienisz zdanie, nadal mozesz kliknac ZAPLAC i wtedy bot wysle instrukcje platnosci.';
  }

  return [
    'Otrzymales mandat.',
    'Mozesz zaakceptowac mandat i zaplacic go na serwerze albo go odrzucic.',
    'Po kliknieciu ZAPLAC bot napisze, co masz zrobic dalej.'
  ].join('\n');
}

function buildMandateCasePayload(mandate, contentOverride = null) {
  const embed = buildMandateEmbed({
    ...mandate,
    statusLabel: getMandateStatusLabel(mandate.status)
  }).setColor(getMandateStatusColor(mandate.status));

  return {
    content: contentOverride ?? getMandateInstructionContent(mandate.status),
    embeds: [embed],
    components: getMandateComponents(mandate.id, getMandateComponentState(mandate.status))
  };
}

function getKartotekaPanelComponents() {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId('kartoteka_otworz_panel')
        .setLabel('OTWORZ KARTOTEKE')
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function getKartotekaViewComponents(userId) {
  return [
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`kartoteka_edytuj:${userId}`)
        .setLabel('EDYTUJ OPIS')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`kartoteka_odswiez:${userId}`)
        .setLabel('ODSWIEZ')
        .setStyle(ButtonStyle.Primary)
    )
  ];
}

function normalizeEditableMandateStatus(input, fallbackStatus = 'oczekuje') {
  const value = (input || '').trim().toLowerCase();
  if (!value) return fallbackStatus;
  if (['zaplacony', 'oplacony', 'mandat oplacony', 'paid'].includes(value)) return 'zaplacony';
  if (['oczekuje', 'otwarty', 'nowy'].includes(value)) return 'oczekuje';
  if (['oczekiwanie', 'oczekiwanie-na-zaplate', 'oczekiwanie na zaplate', 'do-zaplaty', 'do zaplaty'].includes(value)) {
    return 'oczekiwanie-na-zaplate';
  }
  if (['odrzucony', 'odrzuc', 'odrzucony, ale nadal mozna zaplacic'].includes(value)) return 'odrzucony-oczekuje-platnosci';
  if (['zamkniety', 'zamknij'].includes(value)) return 'zamkniety';
  return fallbackStatus;
}

function buildMandateEmbed(mandate) {
  const fields = [
    { name: 'ID mandatu', value: mandate.id, inline: true },
    { name: 'Kto wystawil', value: `<@${mandate.issuerId}>`, inline: true },
    { name: 'Komu wystawiono', value: `<@${mandate.targetId}>`, inline: true },
    { name: 'Kwota', value: `${mandate.amount} PLN`, inline: true }
  ];

  if (typeof mandate.penaltyPoints === 'number') {
    fields.push({ name: 'Punkty karne', value: String(mandate.penaltyPoints), inline: true });
  }

  fields.push(
    { name: 'Powod', value: mandate.reason, inline: false },
    { name: 'Status', value: mandate.statusLabel, inline: true }
  );

  if (mandate.description?.trim()) {
    fields.push({ name: 'Opis', value: mandate.description.trim().slice(0, 1024), inline: false });
  }

  return new EmbedBuilder()
    .setColor(Colors.Orange)
    .setTitle('Mandat')
    .addFields(fields)
    .setTimestamp(new Date(mandate.createdAt));
}

async function findMandateCaseMessage(guild, mandate) {
  const channel = await guild.channels.fetch(mandate.channelId).catch(() => null);
  if (!isSupportedTextChannel(channel) || !channel.messages) {
    return { channel: null, message: null };
  }

  if (mandate.messageId) {
    const storedMessage = await channel.messages.fetch(mandate.messageId).catch(() => null);
    if (storedMessage) {
      return { channel, message: storedMessage };
    }
  }

  const recentMessages = await channel.messages.fetch({ limit: 20 }).catch(() => null);
  const message = recentMessages?.find(entry => {
    if (entry.author?.id !== client.user?.id) return false;
    return entry.embeds.some(embed =>
      embed.fields?.some(field => field.name === 'ID mandatu' && field.value === mandate.id)
    );
  }) ?? null;

  if (message) {
    mandate.messageId = message.id;
  }

  return { channel, message };
}

async function syncMandateCaseMessage(guild, cfg, mandate, contentOverride = null) {
  const { message } = await findMandateCaseMessage(guild, mandate);
  if (!message) return;

  await message.edit(buildMandateCasePayload(mandate, contentOverride)).catch(() => {});
}

function assertMandateActionAllowed(mandate, action, actorId) {
  if (!mandate) {
    const error = new Error('Nie znaleziono tego mandatu.');
    error.statusCode = 404;
    throw error;
  }

  if (action === 'zamknij') {
    if (actorId !== mandate.issuerId) {
      const error = new Error('Tylko osoba, ktora wystawila mandat, moze zamknac sprawe.');
      error.statusCode = 403;
      throw error;
    }
    if (mandate.status === 'zamkniety') {
      const error = new Error('Ta sprawa jest juz zamknieta.');
      error.statusCode = 400;
      throw error;
    }
    return;
  }

  if (action === 'oplacono') {
    if (actorId !== mandate.issuerId) {
      const error = new Error('Tylko osoba, ktora wystawila mandat, moze potwierdzic oplacenie.');
      error.statusCode = 403;
      throw error;
    }
    if (mandate.status === 'zaplacony') {
      const error = new Error('Ten mandat jest juz oznaczony jako oplacony.');
      error.statusCode = 400;
      throw error;
    }
    if (mandate.status !== 'oczekiwanie-na-zaplate') {
      const error = new Error('Najpierw osoba z mandatem musi kliknac ZAPLAC.');
      error.statusCode = 400;
      throw error;
    }
    return;
  }

  if (actorId !== mandate.targetId) {
    const error = new Error('Tylko osoba, ktora dostala mandat, moze uzyc tego przycisku.');
    error.statusCode = 403;
    throw error;
  }
  if (mandate.status === 'zaplacony') {
    const error = new Error('Ten mandat jest juz oznaczony jako oplacony.');
    error.statusCode = 400;
    throw error;
  }
  if (mandate.status === 'zamkniety') {
    const error = new Error('Ta sprawa jest juz zamknieta.');
    error.statusCode = 400;
    throw error;
  }
  if (mandate.status === 'oczekiwanie-na-zaplate') {
    const error = new Error('Ten mandat oczekuje juz na potwierdzenie platnosci przez osobe, ktora go wystawila.');
    error.statusCode = 400;
    throw error;
  }
  if (action === 'odrzuc' && (mandate.status === 'odrzucony-oczekuje-platnosci' || mandate.status === 'odrzucony')) {
    const error = new Error('Ten mandat jest juz odrzucony. Nadal mozesz kliknac ZAPLAC, jesli zmienisz zdanie.');
    error.statusCode = 400;
    throw error;
  }
}

function applyMandateAction(cfg, mandate, action, actorId) {
  assertMandateActionAllowed(mandate, action, actorId);

  if (action === 'zamknij') {
    mandate.status = 'zamkniety';
    syncMandateToKartoteka(cfg, mandate, {
      id: mandate.targetId,
      username: mandate.targetUsername ?? 'Nieznany',
      displayName: mandate.targetDisplayName ?? mandate.targetUsername ?? 'Nieznany'
    });
    return {
      content: getMandateInstructionContent(mandate.status, actorId),
      closeChannelAfterMs: 5000
    };
  }

  if (action === 'oplacono') {
    mandate.status = 'zaplacony';
    syncMandateToKartoteka(cfg, mandate, {
      id: mandate.targetId,
      username: mandate.targetUsername ?? 'Nieznany',
      displayName: mandate.targetDisplayName ?? mandate.targetUsername ?? 'Nieznany'
    });
    return {
      content: getMandateInstructionContent(mandate.status)
    };
  }

  if (action === 'odrzuc') {
    mandate.status = 'odrzucony-oczekuje-platnosci';
    syncMandateToKartoteka(cfg, mandate, {
      id: mandate.targetId,
      username: mandate.targetUsername ?? 'Nieznany',
      displayName: mandate.targetDisplayName ?? mandate.targetUsername ?? 'Nieznany'
    });
    return {
      content: getMandateInstructionContent(mandate.status)
    };
  }

  mandate.status = 'oczekiwanie-na-zaplate';
  syncMandateToKartoteka(cfg, mandate, {
    id: mandate.targetId,
    username: mandate.targetUsername ?? 'Nieznany',
    displayName: mandate.targetDisplayName ?? mandate.targetUsername ?? 'Nieznany'
  });
  return {
    content: getMandateInstructionContent(mandate.status)
  };
}

async function scheduleMandateChannelDeletion(guild, mandate, reason) {
  setTimeout(async () => {
    try {
      const channel = await guild.channels.fetch(mandate.channelId).catch(() => null);
      if (channel && typeof channel.delete === 'function') {
        await channel.delete(reason);
      }
    } catch (deleteError) {
      console.error('Nie udalo sie usunac kanalu sprawy:', deleteError);
    }
  }, 5000);
}

function buildArrestEmbed(arrest) {
  const fields = [
    { name: 'ID aresztu', value: arrest.id, inline: true },
    { name: 'Kto aresztuje', value: `<@${arrest.issuerId}>`, inline: true },
    { name: 'Kogo aresztowano', value: `<@${arrest.targetId}>`, inline: true },
    { name: 'Typ', value: getArrestTypeLabel(arrest.kind), inline: true },
    { name: 'Powod', value: arrest.reason, inline: false }
  ];

  if (arrest.kind === 'wiezienie') {
    fields.push({ name: 'Czas', value: arrest.duration || 'Nie podano', inline: true });
  }

  return new EmbedBuilder()
    .setColor(Colors.DarkRed)
    .setTitle('Areszt / Wiezienie')
    .addFields(fields)
    .setTimestamp(new Date(arrest.createdAt));
}

async function createMandateCase({ guild, cfg, issuerMember, targetMember, amount, penaltyPoints = null, reason, description = '' }) {
  const issuer = issuerMember.user;
  const target = targetMember.user;
  const mandateId = generateMandateId();
  const everyoneRole = guild.roles.everyone;
  const channelName = sanitizeChannelName(`mandat-${target.username}-${mandateId.toLowerCase()}`);
  const permissionOverwrites = [
    { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: target.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    { id: issuer.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
    {
      id: guild.members.me.id,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels]
    }
  ];

  for (const roleId of cfg.mandateRoleIds) {
    permissionOverwrites.push({
      id: roleId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    });
  }

  for (const userId of cfg.mandateUserIds) {
    permissionOverwrites.push({
      id: userId,
      allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
    });
  }

  const privateChannel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    permissionOverwrites
  });

  const mandateRecord = {
    id: mandateId,
    issuerId: issuer.id,
    issuerDisplayName: issuerMember.displayName ?? issuer.globalName ?? issuer.username,
    issuerUsername: issuer.username,
    targetId: target.id,
    targetDisplayName: targetMember.displayName ?? target.globalName ?? target.username,
    targetUsername: target.username,
    amount,
    penaltyPoints: penaltyPoints ?? null,
    reason,
    description: description || '',
    channelId: privateChannel.id,
    messageId: null,
    createdAt: Date.now(),
    status: 'oczekuje'
  };

  cfg.mandates.unshift(mandateRecord);
  cfg.mandates = cfg.mandates.slice(0, 200);
  syncMandateToKartoteka(cfg, mandateRecord, {
    id: target.id,
    username: target.username,
    displayName: targetMember.displayName ?? target.globalName ?? target.username
  });
  saveConfig();

  const mandateEmbed = buildMandateEmbed({ ...mandateRecord, statusLabel: 'Oczekuje na decyzje' });
  const caseMessage = await privateChannel.send({
    content: [
      `<@${target.id}> otrzymal mandat od <@${issuer.id}>.`,
      'Mozesz zaakceptowac mandat i zaplacic go na serwerze albo go odrzucic.',
      'Po kliknieciu ZAPLAC bot napisze, co masz zrobic dalej.'
    ].join('\n'),
    embeds: [mandateEmbed],
    components: getMandateComponents(mandateId)
  });
  mandateRecord.messageId = caseMessage.id;
  saveConfig();

  const infoChannel = await guild.channels.fetch(cfg.mandateInfoChannelId).catch(() => null);
  if (isSupportedTextChannel(infoChannel) && typeof infoChannel.send === 'function') {
    await infoChannel.send({
      embeds: [buildMandateEmbed({ ...mandateRecord, statusLabel: 'Wystawiony' }).setColor(Colors.Blue)]
    }).catch(() => {});
  }

  return { mandateRecord, privateChannel };
}

async function createArrestCase({ guild, cfg, issuerMember, targetMember, reason, kind, duration = '' }) {
  const issuer = issuerMember.user;
  const target = targetMember.user;
  const arrestId = generateArrestId();
  const arrestRecord = {
    id: arrestId,
    issuerId: issuer.id,
    issuerDisplayName: issuerMember.displayName ?? issuer.globalName ?? issuer.username,
    issuerUsername: issuer.username,
    targetId: target.id,
    targetDisplayName: targetMember.displayName ?? target.globalName ?? target.username,
    targetUsername: target.username,
    reason,
    description: '',
    kind,
    duration: kind === 'wiezienie' ? duration : null,
    createdAt: Date.now()
  };

  cfg.arrests.unshift(arrestRecord);
  cfg.arrests = cfg.arrests.slice(0, 200);
  syncArrestToKartoteka(cfg, arrestRecord, {
    id: target.id,
    username: target.username,
    displayName: targetMember.displayName ?? target.globalName ?? target.username
  });
  saveConfig();

  const infoChannel = await guild.channels.fetch(cfg.arrestInfoChannelId).catch(() => null);
  if (isSupportedTextChannel(infoChannel) && typeof infoChannel.send === 'function') {
    await infoChannel.send({
      embeds: [buildArrestEmbed(arrestRecord)]
    }).catch(() => {});
  }

  return { arrestRecord };
}

function getOrCreateKartoteka(cfg, userData) {
  let kartoteka = cfg.kartoteki.find(entry => entry.userId === userData.id);
  if (!kartoteka) {
    kartoteka = {
      userId: userData.id,
      username: userData.username ?? 'Nieznany',
      displayName: userData.displayName ?? userData.globalName ?? userData.username ?? 'Nieznany',
      createdAt: Date.now(),
      note: '',
      entries: []
    };
    cfg.kartoteki.unshift(kartoteka);
  }

  kartoteka.username = userData.username ?? kartoteka.username;
  kartoteka.displayName = userData.displayName ?? userData.globalName ?? userData.username ?? kartoteka.displayName;
  kartoteka.entries = Array.isArray(kartoteka.entries) ? kartoteka.entries : [];
  return kartoteka;
}

function syncMandateToKartoteka(cfg, mandate, userData) {
  const kartoteka = getOrCreateKartoteka(cfg, userData);
  let entry = kartoteka.entries.find(item => item.type === 'mandat' && item.mandateId === mandate.id);

  if (!entry) {
    entry = {
      id: generateKartotekaEntryId(),
      type: 'mandat',
      mandateId: mandate.id,
      createdAt: mandate.createdAt,
      updatedAt: Date.now()
    };
    kartoteka.entries.unshift(entry);
  }

  entry.issuerId = mandate.issuerId;
  entry.amount = mandate.amount;
  entry.penaltyPoints = typeof mandate.penaltyPoints === 'number' ? mandate.penaltyPoints : null;
  entry.reason = mandate.reason;
  entry.description = mandate.description ?? '';
  entry.status = mandate.status;
  entry.updatedAt = Date.now();
  return kartoteka;
}

function syncArrestToKartoteka(cfg, arrest, userData) {
  const kartoteka = getOrCreateKartoteka(cfg, userData);
  let entry = kartoteka.entries.find(item => item.type === 'arrest' && item.arrestId === arrest.id);

  if (!entry) {
    entry = {
      id: generateKartotekaEntryId(),
      type: 'arrest',
      arrestId: arrest.id,
      createdAt: arrest.createdAt,
      updatedAt: Date.now()
    };
    kartoteka.entries.unshift(entry);
  }

  entry.issuerId = arrest.issuerId;
  entry.reason = arrest.reason;
  entry.kind = arrest.kind;
  entry.duration = arrest.duration ?? null;
  entry.updatedAt = Date.now();
  return kartoteka;
}

function formatDateTime(timestamp) {
  return new Intl.DateTimeFormat('pl-PL', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

function buildKartotekaEmbed(kartoteka) {
  const mandateEntries = kartoteka.entries.filter(entry => entry.type === 'mandat');
  const arrestEntries = kartoteka.entries.filter(entry => entry.type === 'arrest');
  const paidCount = mandateEntries.filter(entry => entry.status === 'zaplacony').length;
  const totalPenaltyPoints = mandateEntries.reduce(
    (sum, entry) => sum + (typeof entry.penaltyPoints === 'number' ? entry.penaltyPoints : 0),
    0
  );

  const fields = [
    { name: 'Osoba', value: `<@${kartoteka.userId}>`, inline: true },
    { name: 'Nick Discord', value: kartoteka.displayName || kartoteka.username, inline: true },
    { name: 'Zalozono', value: formatDateTime(kartoteka.createdAt), inline: true },
    { name: 'Liczba mandatow', value: String(mandateEntries.length), inline: true },
    { name: 'Mandaty oplacone', value: String(paidCount), inline: true },
    { name: 'Suma punktow karnych', value: String(totalPenaltyPoints), inline: true },
    { name: 'Liczba aresztow', value: String(arrestEntries.length), inline: true }
  ];

  fields.push({
    name: 'Opis kartoteki',
    value: kartoteka.note?.trim() ? kartoteka.note.trim() : 'Brak dodatkowego opisu.',
    inline: false
  });

  const latestEntries = mandateEntries.slice(0, 8);
  const historyValue = latestEntries.length
    ? latestEntries.map(entry => {
      const pointsText = typeof entry.penaltyPoints === 'number' ? ` | ${entry.penaltyPoints} pkt` : '';
      return [
        `**${entry.mandateId}** | ${getMandateStatusLabel(entry.status)} | ${entry.amount} PLN${pointsText}`,
        `Powod: ${entry.reason}`,
        entry.description?.trim() ? `Opis: ${entry.description.trim()}` : null,
        `Wystawil: <@${entry.issuerId}> | ${formatDateTime(entry.createdAt)}`
      ].filter(Boolean).join('\n');
    }).join('\n\n')
    : 'Brak wpisow mandatowych.';

  fields.push({
    name: latestEntries.length < mandateEntries.length
      ? `Historia mandatow (ostatnie ${latestEntries.length} z ${mandateEntries.length})`
      : 'Historia mandatow',
    value: historyValue.slice(0, 1024),
    inline: false
  });

  const latestArrests = arrestEntries.slice(0, 8);
  const arrestHistoryValue = latestArrests.length
    ? latestArrests.map(entry => {
      const durationText = entry.kind === 'wiezienie' ? ` | ${entry.duration || 'bez czasu'}` : '';
      return [
        `**${entry.arrestId}** | ${getArrestTypeLabel(entry.kind)}${durationText}`,
        `Powod: ${entry.reason}`,
        `Wystawil: <@${entry.issuerId}> | ${formatDateTime(entry.createdAt)}`
      ].join('\n');
    }).join('\n\n')
    : 'Brak wpisow aresztowych.';

  fields.push({
    name: latestArrests.length < arrestEntries.length
      ? `Historia aresztow (ostatnie ${latestArrests.length} z ${arrestEntries.length})`
      : 'Historia aresztow',
    value: arrestHistoryValue.slice(0, 1024),
    inline: false
  });

  return new EmbedBuilder()
    .setColor(Colors.Blurple)
    .setTitle('Kartoteka policyjna')
    .setDescription(`Pelna kartoteka dla <@${kartoteka.userId}>.`)
    .addFields(fields)
    .setFooter({ text: `ID Discord: ${kartoteka.userId}` })
    .setTimestamp(new Date());
}

function buildKartotekaPanelEmbed() {
  return new EmbedBuilder()
    .setColor(Colors.DarkBlue)
    .setTitle('Panel kartoteki')
    .setDescription([
      'Kliknij przycisk ponizej, aby otworzyc kartoteke gracza.',
      'Po kliknieciu wpiszesz nick Discord i bot pokaze zapisana historie mandatow.',
      'Mozesz tez edytowac opis kartoteki w osobnym okienku.'
    ].join('\n'))
    .setFooter({ text: 'Fordon RP x Komisariat Policji' });
}

function serializeMandate(mandate) {
  return {
    id: mandate.id,
    issuerId: mandate.issuerId,
    issuerLabel: mandate.issuerDisplayName ?? mandate.issuerUsername ?? mandate.issuerId,
    targetId: mandate.targetId,
    targetLabel: mandate.targetDisplayName ?? mandate.targetUsername ?? mandate.targetId,
    amount: mandate.amount,
    penaltyPoints: typeof mandate.penaltyPoints === 'number' ? mandate.penaltyPoints : null,
    reason: mandate.reason,
    description: mandate.description ?? '',
    status: mandate.status,
    statusLabel: getMandateStatusLabel(mandate.status),
    createdAt: mandate.createdAt,
    createdAtLabel: formatDateTime(mandate.createdAt)
  };
}

function serializeArrest(arrest) {
  return {
    id: arrest.id,
    issuerId: arrest.issuerId,
    issuerLabel: arrest.issuerDisplayName ?? arrest.issuerUsername ?? arrest.issuerId,
    targetId: arrest.targetId,
    targetLabel: arrest.targetDisplayName ?? arrest.targetUsername ?? arrest.targetId,
    reason: arrest.reason,
    kind: arrest.kind,
    kindLabel: getArrestTypeLabel(arrest.kind),
    duration: arrest.duration ?? null,
    createdAt: arrest.createdAt,
    createdAtLabel: formatDateTime(arrest.createdAt)
  };
}

function serializeKartoteka(kartoteka) {
  const entries = Array.isArray(kartoteka.entries) ? kartoteka.entries : [];
  const mandateEntries = entries.filter(entry => entry.type === 'mandat');
  const arrestEntries = entries.filter(entry => entry.type === 'arrest');

  return {
    userId: kartoteka.userId,
    username: kartoteka.username,
    displayName: kartoteka.displayName,
    note: kartoteka.note ?? '',
    createdAt: kartoteka.createdAt,
    createdAtLabel: formatDateTime(kartoteka.createdAt),
    stats: {
      mandateCount: mandateEntries.length,
      paidMandateCount: mandateEntries.filter(entry => entry.status === 'zaplacony').length,
      penaltyPointsTotal: mandateEntries.reduce((sum, entry) => sum + (typeof entry.penaltyPoints === 'number' ? entry.penaltyPoints : 0), 0),
      arrestCount: arrestEntries.length
    },
    entries: entries.map(entry => ({
      ...entry,
      description: entry.description ?? '',
      kindLabel: entry.type === 'arrest' ? getArrestTypeLabel(entry.kind) : null,
      statusLabel: entry.type === 'mandat' ? getMandateStatusLabel(entry.status) : null,
      createdAtLabel: entry.createdAt ? formatDateTime(entry.createdAt) : null,
      updatedAtLabel: entry.updatedAt ? formatDateTime(entry.updatedAt) : null
    }))
  };
}

function serializeDashboardState(guildId, panelSession = null, panelPermissions = null) {
  const cfg = ensureGuild(guildId);
  const mandates = [...cfg.mandates].sort((a, b) => b.createdAt - a.createdAt);
  const arrests = [...cfg.arrests].sort((a, b) => b.createdAt - a.createdAt);
  const kartoteki = [...cfg.kartoteki].sort((a, b) => {
    const aUpdated = Math.max(a.createdAt || 0, ...(a.entries || []).map(entry => entry.updatedAt || entry.createdAt || 0));
    const bUpdated = Math.max(b.createdAt || 0, ...(b.entries || []).map(entry => entry.updatedAt || entry.createdAt || 0));
    return bUpdated - aUpdated;
  });

  const canSeeEverything = !panelSession || panelSession.role === 'owner';
  const isRestrictedUser = panelSession?.role === 'user' && panelSession.accountType === 'uzytkownik' && panelSession.discordUserId;
  const canSeeMandates = canSeeEverything || panelPermissions?.viewMandaty || panelPermissions?.editMandaty || panelPermissions?.deleteMandaty;
  const canSeeArrests = canSeeEverything || panelPermissions?.viewAreszty || panelPermissions?.editAreszty || panelPermissions?.deleteAreszty;
  const canSeeKartoteki = canSeeEverything || panelPermissions?.viewKartoteka || panelPermissions?.editKartoteka;
  const mandateBase = isRestrictedUser ? mandates.filter(mandate => mandate.targetId === panelSession.discordUserId) : mandates;
  const visibleMandates = canSeeMandates ? mandateBase : [];
  const arrestBase = isRestrictedUser ? arrests.filter(arrest => arrest.targetId === panelSession.discordUserId) : arrests;
  const visibleArrests = canSeeArrests ? arrestBase : [];
  const visibleKartoteki = isRestrictedUser ? [] : (canSeeKartoteki ? kartoteki : []);

  return {
    guildId,
    version: panelVersion,
    updatedAt: new Date(panelVersion).toISOString(),
    authRequired: Boolean(PANEL_ADMIN_KEY),
    stats: {
      mandateCount: visibleMandates.length,
      paidMandateCount: visibleMandates.filter(mandate => mandate.status === 'zaplacony').length,
      pendingMandateCount: visibleMandates.filter(mandate => mandate.status !== 'zaplacony' && mandate.status !== 'zamkniety').length,
      mandateRevenue: visibleMandates
        .filter(mandate => mandate.status === 'zaplacony')
        .reduce((sum, mandate) => sum + (Number(mandate.amount) || 0), 0),
      arrestCount: visibleArrests.length,
      kartotekaCount: visibleKartoteki.length
    },
    mandates: visibleMandates.map(serializeMandate),
    arrests: visibleArrests.map(serializeArrest),
    kartoteki: visibleKartoteki.map(serializeKartoteka)
  };
}

function isSamePolishDate(timestamp, dateString) {
  if (!dateString) return true;
  const [year, month, day] = String(dateString).split('-').map(Number);
  if (!year || !month || !day) return false;
  const date = new Date(timestamp);
  return date.getFullYear() === year && date.getMonth() + 1 === month && date.getDate() === day;
}

function computeEarningsStats(cfg, userId, dateString = '') {
  const mandateMatches = cfg.mandates.filter(mandate => mandate.issuerId === userId && isSamePolishDate(mandate.createdAt, dateString));
  const arrestMatches = cfg.arrests.filter(arrest => arrest.issuerId === userId && isSamePolishDate(arrest.createdAt, dateString));

  return {
    mandateCount: mandateMatches.length,
    paidMandateCount: mandateMatches.filter(mandate => mandate.status === 'zaplacony').length,
    pendingMandateCount: mandateMatches.filter(mandate => mandate.status !== 'zaplacony' && mandate.status !== 'zamkniety').length,
    mandateRevenue: mandateMatches
      .filter(mandate => mandate.status === 'zaplacony')
      .reduce((sum, mandate) => sum + (Number(mandate.amount) || 0), 0),
    arrestCount: arrestMatches.length
  };
}

async function fetchGuildMemberForPanel(discordUserId) {
  const guild = client.guilds.cache.get(GUILD_ID) ?? await client.guilds.fetch(GUILD_ID).catch(() => null);
  if (!guild) return null;
  return guild.members.fetch(discordUserId).catch(() => null);
}

function getDiscordAuthUrl() {
  const state = crypto.randomBytes(16).toString('hex');
  discordOAuthStates.set(state, Date.now());

  for (const [key, timestamp] of discordOAuthStates.entries()) {
    if (Date.now() - timestamp > 10 * 60 * 1000) {
      discordOAuthStates.delete(key);
    }
  }

  const params = new URLSearchParams({
    client_id: DISCORD_APP_ID,
    response_type: 'code',
    redirect_uri: DISCORD_OAUTH_REDIRECT_URI,
    scope: 'identify',
    state,
    prompt: 'none'
  });

  return `https://discord.com/oauth2/authorize?${params.toString()}`;
}

async function getEarningsCandidates(guildId) {
  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return [];

  try {
    await guild.members.fetch();
  } catch {}

  const role = guild.roles.cache.get(EARNINGS_ROLE_ID) ?? await guild.roles.fetch(EARNINGS_ROLE_ID).catch(() => null);
  const directMembers = role
    ? [...role.members.values()].map(member => ({
        id: member.id,
        label: member.displayName ?? member.user.globalName ?? member.user.username
      }))
    : guild.members.cache
        .filter(member => member.roles?.cache?.has(EARNINGS_ROLE_ID))
        .map(member => ({
          id: member.id,
          label: member.displayName ?? member.user.globalName ?? member.user.username
        }));

  if (directMembers.length > 0) {
    return directMembers.sort((a, b) => a.label.localeCompare(b.label, 'pl'));
  }

  const cfg = ensureGuild(guildId);
  const fallbackIds = new Set([
    ...cfg.mandates.map(item => item.issuerId),
    ...cfg.arrests.map(item => item.issuerId)
  ]);

  const fallbacks = [...fallbackIds].map(id => {
    const mandate = cfg.mandates.find(item => item.issuerId === id);
    const arrest = cfg.arrests.find(item => item.issuerId === id);
    return {
      id,
      label: mandate?.issuerDisplayName ?? arrest?.issuerDisplayName ?? mandate?.issuerUsername ?? arrest?.issuerUsername ?? id
    };
  });

  return fallbacks.sort((a, b) => a.label.localeCompare(b.label, 'pl'));
}

async function getPunishmentCandidates(guildId) {
  const guild = client.guilds.cache.get(guildId) ?? await client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return [];

  try {
    await guild.members.fetch();
  } catch {}

  return guild.members.cache
    .filter(member => !member.user.bot)
    .map(member => ({
      id: member.id,
      label: member.displayName ?? member.user.globalName ?? member.user.username
    }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pl'))
    .slice(0, 1000);
}

function startPanelServer() {
  const app = express();
  panelServer = createServer(app);
  panelIo = new SocketIOServer(panelServer, {
    cors: {
      origin: true,
      credentials: true
    }
  });

  panelIo.use((socket, next) => {
    const authToken = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token.trim() : '';
    const session = getPanelSessionFromToken(authToken);
    if (session) {
      socket.data.panelSession = session;
      next();
      return;
    }
    next(new Error('Brak dostepu do panelu.'));
  });

  panelIo.on('connection', socket => {
    socket.on('dashboard:watch', guildId => {
      if (typeof guildId === 'string' && guildId.trim()) {
        socket.join(`guild:${guildId.trim()}`);
      }
    });
  });

  app.use(express.json({ limit: '1mb' }));

  app.get('/api/panel/meta', (req, res) => {
    res.json({
      guildId: GUILD_ID,
      authRequired: true,
      version: panelVersion,
      discordLoginEnabled: Boolean(DISCORD_CLIENT_SECRET)
    });
  });

  app.get('/api/panel/discord/start', (req, res) => {
    if (!DISCORD_CLIENT_SECRET) {
      res.status(500).send('Brak DISCORD_CLIENT_SECRET w .env.');
      return;
    }

    res.redirect(getDiscordAuthUrl());
  });

  app.get('/api/panel/discord/callback', async (req, res) => {
    if (!DISCORD_CLIENT_SECRET) {
      res.status(500).send('Brak DISCORD_CLIENT_SECRET w .env.');
      return;
    }

    const code = String(req.query.code || '').trim();
    const state = String(req.query.state || '').trim();
    const storedState = discordOAuthStates.get(state);
    discordOAuthStates.delete(state);

    if (!code || !state || !storedState) {
      res.status(400).send('Niepoprawne logowanie przez Discord.');
      return;
    }

    try {
      const tokenResponse = await fetch('https://discord.com/api/oauth2/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: DISCORD_APP_ID,
          client_secret: DISCORD_CLIENT_SECRET,
          grant_type: 'authorization_code',
          code,
          redirect_uri: DISCORD_OAUTH_REDIRECT_URI
        })
      });

      const tokenData = await tokenResponse.json();
      if (!tokenResponse.ok || !tokenData.access_token) {
        res.status(401).send('Nie udalo sie zalogowac przez Discord.');
        return;
      }

      const userResponse = await fetch('https://discord.com/api/users/@me', {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const discordUser = await userResponse.json();
      if (!userResponse.ok || !discordUser.id) {
        res.status(401).send('Nie udalo sie pobrac danych uzytkownika Discord.');
        return;
      }

      const member = await fetchGuildMemberForPanel(discordUser.id);
      if (!member) {
        res.status(403).send('Musisz byc na serwerze Discord, aby wejsc do panelu.');
        return;
      }

      const account = upsertDiscordPanelUser(member);
      const token = generatePanelSession('user', account.username, account.id, {
        displayName: account.displayName,
        accountType: account.accountType,
        discordUserId: account.discordUserId
      });

      addPanelActivityLog(
        { role: 'user', username: account.username, displayName: account.displayName },
        'Logowanie',
        `${account.displayName} zalogowal sie do panelu przez Discord.`
      );
      saveConfig();

      const permissions = account.accountType === 'policjant'
        ? normalizePanelPermissions(account.permissions)
        : getRestrictedUserPermissions();

      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.end(`<!doctype html>
<html lang="pl">
  <body style="background:#08101d;color:#eff4ff;font-family:sans-serif;display:grid;place-items:center;min-height:100vh;">
    <script>
      localStorage.setItem('panelSessionToken', ${JSON.stringify(token)});
      localStorage.setItem('panelSessionRole', 'user');
      localStorage.setItem('panelSessionUsername', ${JSON.stringify(account.username)});
      localStorage.setItem('panelSessionDisplayName', ${JSON.stringify(account.displayName)});
      localStorage.setItem('panelSessionAccountType', ${JSON.stringify(account.accountType)});
      localStorage.setItem('panelSessionDiscordUserId', ${JSON.stringify(account.discordUserId)});
      localStorage.setItem('panelSessionPermissions', ${JSON.stringify(JSON.stringify(permissions))});
      window.location.replace('/');
    </script>
    Trwa logowanie...
  </body>
</html>`);
    } catch {
      res.status(500).send('Wystapil blad podczas logowania przez Discord.');
    }
  });

  app.post('/api/panel/login', (req, res) => {
    const mode = String(req.body.mode || '').trim().toLowerCase();

    if (mode === 'owner') {
      const adminKey = String(req.body.adminKey || '').trim();
      if (!PANEL_ADMIN_KEY || adminKey !== PANEL_ADMIN_KEY) {
        res.status(401).json({ error: 'Niepoprawny admin key.' });
        return;
      }

      const token = generatePanelSession('owner', 'Wlasciciel');
      addPanelActivityLog({ role: 'owner', username: 'Wlasciciel' }, 'Logowanie', 'Wlasciciel zalogowal sie do panelu.');
      saveConfig();
      res.json({
        ok: true,
        token,
        role: 'owner',
        username: 'Wlasciciel',
        permissions: null
      });
      return;
    }

    res.status(400).json({ error: 'Niepoprawny tryb logowania.' });
  });

  app.use('/api', requirePanelAuth);

  app.get('/api/panel/session', (req, res) => {
    res.json({
      role: req.panelSession.role,
      username: req.panelSession.username || '',
      displayName: req.panelSession.displayName || req.panelUser?.displayName || req.panelSession.username || '',
      accountType: req.panelSession.accountType || req.panelUser?.accountType || null,
      discordUserId: req.panelSession.discordUserId || req.panelUser?.discordUserId || null,
      permissions: req.panelPermissions ? normalizePanelPermissions(req.panelPermissions) : null
    });
  });

  app.post('/api/panel/logout', (req, res) => {
    const token = extractPanelToken(req);
    if (token) panelSessions.delete(token);
    addPanelActivityLog(req.panelSession, 'Wylogowanie', `${createPanelActor(req.panelSession).label} wylogowal sie z panelu.`);
    saveConfig();
    res.json({ ok: true });
  });

  app.get('/api/panel/users', requirePanelOwner, (req, res) => {
    const store = ensurePanelAuthStore();
    res.json({
      users: store.users.map(serializePanelUser)
    });
  });

  app.get('/api/panel/activity-logs', requirePanelOwner, (req, res) => {
    const store = ensurePanelAuthStore();
    const actor = String(req.query.actor || 'all').trim().toLowerCase();
    const logs = store.activityLogs
      .filter(entry => actor === 'all' || String(entry.actorUsername || '').trim().toLowerCase() === actor)
      .sort((a, b) => b.createdAt - a.createdAt)
      .map(serializeActivityLog);

    res.json({
      logs,
      users: [
        { value: 'all', label: 'Wszyscy' },
        { value: 'Wlasciciel'.toLowerCase(), label: 'Wlasciciel' },
        ...store.users.map(user => ({ value: user.username, label: user.displayName ?? user.username }))
      ]
    });
  });

  app.post('/api/panel/users', requirePanelOwner, (req, res) => {
    res.status(400).json({ error: 'Konta uzytkownikow tworza sie teraz automatycznie po logowaniu przez Discord.' });
  });

  app.patch('/api/panel/users/:userId/permissions', requirePanelOwner, (req, res) => {
    const store = ensurePanelAuthStore();
    const account = store.users.find(user => user.id === req.params.userId);
    if (!account) {
      res.status(404).json({ error: 'Nie znaleziono takiego uzytkownika.' });
      return;
    }
    if ((account.accountType ?? 'uzytkownik') !== 'policjant') {
      res.status(400).json({ error: 'Permisje mozna edytowac tylko dla policjantow.' });
      return;
    }

    account.permissions = normalizePanelPermissions(req.body.permissions || {});
    account.updatedAt = Date.now();
    invalidateUserSessions(account.username, account.id);
    addPanelActivityLog(req.panelSession, 'Zmiana permisji', `Zmieniono permisje konta ${account.username}.`, {
      targetUsername: account.username
    });
    saveConfig();

    res.json({
      ok: true,
      users: store.users.map(serializePanelUser)
    });
  });

  app.patch('/api/panel/users/:userId/password', requirePanelOwner, (req, res) => {
    res.status(400).json({ error: 'Hasla sa wylaczone. Uzytkownicy loguja sie teraz tylko przez Discord.' });
  });

  app.delete('/api/panel/users/:userId', requirePanelOwner, (req, res) => {
    const store = ensurePanelAuthStore();
    const account = store.users.find(user => user.id === req.params.userId);
    const before = store.users.length;
    store.users = store.users.filter(user => user.id !== req.params.userId);
    guildConfig.__panelAuth = store;

    if (store.users.length === before) {
      res.status(404).json({ error: 'Nie znaleziono takiego uzytkownika.' });
      return;
    }

    if (account) invalidateUserSessions(account.username, account.id);
    if (account) {
      addPanelActivityLog(req.panelSession, 'Usuniecie konta', `Usunieto konto panelu ${account.username}.`, {
        targetUsername: account.username
      });
    }
    saveConfig();
    res.json({
      ok: true,
      users: store.users.map(serializePanelUser)
    });
  });

  app.get('/api/dashboard/:guildId', (req, res) => {
    res.json(serializeDashboardState(req.params.guildId, req.panelSession, req.panelPermissions));
  });

  app.get('/api/dashboard/:guildId/earnings/candidates', requirePanelPermission('viewZarobek'), async (req, res) => {
    const candidates = await getEarningsCandidates(req.params.guildId);
    res.json({ candidates, roleId: EARNINGS_ROLE_ID });
  });

  app.get('/api/dashboard/:guildId/earnings/summary', requirePanelPermission('viewZarobek'), (req, res) => {
    const cfg = ensureGuild(req.params.guildId);
    const userId = String(req.query.userId || '').trim();
    const scope = String(req.query.scope || 'all').trim().toLowerCase();
    const date = String(req.query.date || '').trim();

    if (!userId) {
      res.status(400).json({ error: 'Musisz wybrac osobe.' });
      return;
    }
    if (scope === 'date' && !date) {
      res.status(400).json({ error: 'Dla statystyk z danego dnia podaj date.' });
      return;
    }

    const stats = computeEarningsStats(cfg, userId, scope === 'date' ? date : '');
    res.json({
      userId,
      scope,
      date: scope === 'date' ? date : '',
      stats
    });
  });

  app.get('/api/dashboard/:guildId/punishment-candidates', requirePanelOfficer, async (req, res) => {
    const candidates = await getPunishmentCandidates(req.params.guildId);
    res.json({ candidates });
  });

  app.post('/api/dashboard/:guildId/punishments', requirePanelOfficer, async (req, res) => {
    const cfg = ensureGuild(req.params.guildId);
    const guild = client.guilds.cache.get(req.params.guildId) ?? await client.guilds.fetch(req.params.guildId).catch(() => null);

    if (!guild) {
      res.status(404).json({ error: 'Nie znaleziono serwera.' });
      return;
    }

    const issuerId = req.panelSession?.role === 'owner'
      ? String(req.body.issuerId || '').trim()
      : String(req.panelSession?.discordUserId || '').trim();
    const targetId = String(req.body.targetId || '').trim();
    const type = String(req.body.type || '').trim().toLowerCase();
    const reason = String(req.body.reason || '').trim();
    const description = String(req.body.description || '').trim();
    const amountRaw = req.body.amount;
    const penaltyPointsRaw = req.body.penaltyPoints;
    const duration = String(req.body.duration || '').trim();

    if (!issuerId || !targetId) {
      res.status(400).json({ error: 'Musisz wybrac osobe nadajaca kare i osobe karana.' });
      return;
    }
    if (issuerId === targetId) {
      res.status(400).json({ error: 'Nie mozesz nadac kary samemu sobie.' });
      return;
    }
    if (!reason) {
      res.status(400).json({ error: 'Musisz podac powod kary.' });
      return;
    }

    const issuerMember = await guild.members.fetch(issuerId).catch(() => null);
    const targetMember = await guild.members.fetch(targetId).catch(() => null);
    if (!issuerMember || !targetMember) {
      res.status(404).json({ error: 'Nie znaleziono jednego z uzytkownikow na serwerze.' });
      return;
    }

    if (type === 'mandat') {
      if (!cfg.mandateInfoChannelId) {
        res.status(400).json({ error: 'Najpierw ustaw kanaly mandatow.' });
        return;
      }

      const amount = Number(amountRaw);
      let penaltyPoints = null;
      if (penaltyPointsRaw !== null && penaltyPointsRaw !== undefined && String(penaltyPointsRaw).trim() !== '') {
        penaltyPoints = Number(penaltyPointsRaw);
      }

      if (!Number.isInteger(amount) || amount <= 0) {
        res.status(400).json({ error: 'Kwota mandatu musi byc liczba calkowita wieksza od 0.' });
        return;
      }
      if (penaltyPoints !== null && (!Number.isInteger(penaltyPoints) || penaltyPoints < 0)) {
        res.status(400).json({ error: 'Punkty karne musza byc liczba calkowita wieksza lub rowna 0.' });
        return;
      }

      const { mandateRecord, privateChannel } = await createMandateCase({
        guild,
        cfg,
        issuerMember,
        targetMember,
        amount,
        penaltyPoints,
        reason,
        description
      });

      addPanelActivityLog(req.panelSession, 'Nadanie kary', `Nadano mandat ${mandateRecord.id} dla ${mandateRecord.targetDisplayName}.`, {
        guildId: req.params.guildId,
        mandateId: mandateRecord.id
      });
      saveConfig();

      res.json({
        ok: true,
        type: 'mandat',
        id: mandateRecord.id,
        privateChannelId: privateChannel.id
      });
      return;
    }

    if (!cfg.arrestInfoChannelId) {
      res.status(400).json({ error: 'Najpierw ustaw kanaly aresztow.' });
      return;
    }

    const normalizedType = type === 'wiezienie' ? 'wiezienie' : 'areszt';
    if (normalizedType === 'wiezienie' && !duration) {
      res.status(400).json({ error: 'Dla wiezienia podaj czas.' });
      return;
    }

    const { arrestRecord } = await createArrestCase({
      guild,
      cfg,
      issuerMember,
      targetMember,
      reason,
      kind: normalizedType,
      duration
    });

    addPanelActivityLog(req.panelSession, 'Nadanie kary', `Nadano ${normalizedType === 'wiezienie' ? 'wiezienie' : 'areszt'} ${arrestRecord.id} dla ${arrestRecord.targetDisplayName}.`, {
      guildId: req.params.guildId,
      arrestId: arrestRecord.id
    });
    saveConfig();

    res.json({
      ok: true,
      type: normalizedType,
      id: arrestRecord.id
    });
  });

  app.post('/api/dashboard/:guildId/mandates/:mandateId/action', async (req, res) => {
    const cfg = ensureGuild(req.params.guildId);
    const mandate = cfg.mandates.find(item => item.id === req.params.mandateId);
    const action = String(req.body.action || '').trim().toLowerCase();
    const actorId = String(req.panelSession?.discordUserId || '').trim();
    const guild = client.guilds.cache.get(req.params.guildId) ?? await client.guilds.fetch(req.params.guildId).catch(() => null);

    if (!['zaplac', 'odrzuc', 'oplacono', 'zamknij'].includes(action)) {
      res.status(400).json({ error: 'Niepoprawna akcja mandatu.' });
      return;
    }
    if (!mandate) {
      res.status(404).json({ error: 'Nie znaleziono tego mandatu.' });
      return;
    }
    if (!actorId) {
      res.status(403).json({ error: 'Ta akcja wymaga logowania kontem Discord.' });
      return;
    }

    try {
      const result = applyMandateAction(cfg, mandate, action, actorId);
      addPanelActivityLog(
        req.panelSession,
        `Akcja mandatu: ${action}`,
        `${createPanelActor(req.panelSession).label} wykonal akcje ${action} dla mandatu ${mandate.id}.`,
        { guildId: req.params.guildId, mandateId: mandate.id }
      );
      saveConfig();

      if (guild) {
        await syncMandateCaseMessage(guild, cfg, mandate, result.content);
        if (result.closeChannelAfterMs) {
          await scheduleMandateChannelDeletion(guild, mandate, 'Zamknieta sprawa mandatu');
        }
      }

      res.json({
        ok: true,
        action,
        message: result.content,
        mandate: serializeMandate(mandate)
      });
    } catch (error) {
      res.status(error.statusCode || 400).json({ error: error.message || 'Nie udalo sie wykonac akcji.' });
    }
  });

  app.patch('/api/dashboard/:guildId/mandates/:mandateId', requirePanelPermission('editMandaty'), (req, res) => {
    const cfg = ensureGuild(req.params.guildId);
    const mandate = cfg.mandates.find(item => item.id === req.params.mandateId);
    if (!mandate) {
      res.status(404).json({ error: 'Nie znaleziono mandatu.' });
      return;
    }

    const reason = String(req.body.reason ?? '').trim();
    const description = String(req.body.description ?? '').trim();
    const rawStatus = String(req.body.status ?? mandate.status).trim().toLowerCase();
    const penaltyPointsRaw = req.body.penaltyPoints;

    if (!reason) {
      res.status(400).json({ error: 'Powod mandatu nie moze byc pusty.' });
      return;
    }

    let penaltyPoints = null;
    if (penaltyPointsRaw !== null && penaltyPointsRaw !== undefined && String(penaltyPointsRaw).trim() !== '') {
      penaltyPoints = Number(penaltyPointsRaw);
      if (!Number.isInteger(penaltyPoints) || penaltyPoints < 0) {
        res.status(400).json({ error: 'Punkty karne musza byc liczba calkowita wieksza lub rowna 0.' });
        return;
      }
    }

    mandate.reason = reason;
    mandate.description = description;
    mandate.penaltyPoints = penaltyPoints;
    mandate.status = normalizeEditableMandateStatus(rawStatus, mandate.status);
    addPanelActivityLog(req.panelSession, 'Edycja mandatu', `Edytowano mandat ${mandate.id} wystawiony dla ${mandate.targetDisplayName ?? mandate.targetUsername ?? mandate.targetId}.`, {
      guildId: req.params.guildId,
      mandateId: mandate.id
    });

    syncMandateToKartoteka(cfg, mandate, {
      id: mandate.targetId,
      username: mandate.targetUsername ?? 'Nieznany',
      displayName: mandate.targetDisplayName ?? mandate.targetUsername ?? 'Nieznany'
    });
    saveConfig();

    res.json({ ok: true, mandate: serializeMandate(mandate) });
  });

  app.delete('/api/dashboard/:guildId/mandates/:mandateId', requirePanelPermission('deleteMandaty'), async (req, res) => {
    const cfg = ensureGuild(req.params.guildId);
    const mandateIndex = cfg.mandates.findIndex(item => item.id === req.params.mandateId);
    if (mandateIndex === -1) {
      res.status(404).json({ error: 'Nie znaleziono mandatu.' });
      return;
    }

    const [removedMandate] = cfg.mandates.splice(mandateIndex, 1);
    addPanelActivityLog(req.panelSession, 'Usuniecie mandatu', `Usunieto mandat ${removedMandate.id} wystawiony dla ${removedMandate.targetDisplayName ?? removedMandate.targetUsername ?? removedMandate.targetId}.`, {
      guildId: req.params.guildId,
      mandateId: removedMandate.id
    });
    for (const kartoteka of cfg.kartoteki) {
      kartoteka.entries = (kartoteka.entries || []).filter(entry => !(entry.type === 'mandat' && entry.mandateId === removedMandate.id));
    }
    saveConfig();

    const guild = client.guilds.cache.get(req.params.guildId);
    const channel = guild ? await guild.channels.fetch(removedMandate.channelId).catch(() => null) : null;
    if (channel && typeof channel.delete === 'function') {
      await channel.delete('Usunieto mandat z aplikacji').catch(() => {});
    }

    res.json({ ok: true });
  });

  app.patch('/api/dashboard/:guildId/arrests/:arrestId', requirePanelPermission('editAreszty'), (req, res) => {
    const cfg = ensureGuild(req.params.guildId);
    const arrest = cfg.arrests.find(item => item.id === req.params.arrestId);
    if (!arrest) {
      res.status(404).json({ error: 'Nie znaleziono aresztu.' });
      return;
    }

    const reason = String(req.body.reason ?? '').trim();
    const kindInput = String(req.body.kind ?? arrest.kind).trim().toLowerCase();
    const duration = String(req.body.duration ?? '').trim();
    const normalizedKind = ['wiezienie', 'pojscie-do-wiezienia', 'pojscie do wiezienia'].includes(kindInput) ? 'wiezienie' : 'areszt';

    if (!reason) {
      res.status(400).json({ error: 'Powod aresztu nie moze byc pusty.' });
      return;
    }
    if (normalizedKind === 'wiezienie' && !duration) {
      res.status(400).json({ error: 'Dla pojscia do wiezienia podaj czas.' });
      return;
    }

    arrest.reason = reason;
    arrest.kind = normalizedKind;
    arrest.duration = normalizedKind === 'wiezienie' ? duration : null;
    addPanelActivityLog(req.panelSession, 'Edycja aresztu', `Edytowano areszt ${arrest.id} dla ${arrest.targetDisplayName ?? arrest.targetUsername ?? arrest.targetId}.`, {
      guildId: req.params.guildId,
      arrestId: arrest.id
    });

    syncArrestToKartoteka(cfg, arrest, {
      id: arrest.targetId,
      username: arrest.targetUsername ?? 'Nieznany',
      displayName: arrest.targetDisplayName ?? arrest.targetUsername ?? 'Nieznany'
    });
    saveConfig();

    res.json({ ok: true, arrest: serializeArrest(arrest) });
  });

  app.delete('/api/dashboard/:guildId/arrests/:arrestId', requirePanelPermission('deleteAreszty'), (req, res) => {
    const cfg = ensureGuild(req.params.guildId);
    const arrestIndex = cfg.arrests.findIndex(item => item.id === req.params.arrestId);
    if (arrestIndex === -1) {
      res.status(404).json({ error: 'Nie znaleziono aresztu.' });
      return;
    }

    const [removedArrest] = cfg.arrests.splice(arrestIndex, 1);
    addPanelActivityLog(req.panelSession, 'Usuniecie aresztu', `Usunieto areszt ${removedArrest.id} dla ${removedArrest.targetDisplayName ?? removedArrest.targetUsername ?? removedArrest.targetId}.`, {
      guildId: req.params.guildId,
      arrestId: removedArrest.id
    });
    for (const kartoteka of cfg.kartoteki) {
      kartoteka.entries = (kartoteka.entries || []).filter(entry => !(entry.type === 'arrest' && entry.arrestId === removedArrest.id));
    }
    saveConfig();

    res.json({ ok: true });
  });

  app.patch('/api/dashboard/:guildId/kartoteki/:userId', requirePanelPermission('editKartoteka'), (req, res) => {
    const cfg = ensureGuild(req.params.guildId);
    const kartoteka = cfg.kartoteki.find(item => item.userId === req.params.userId);
    if (!kartoteka) {
      res.status(404).json({ error: 'Nie znaleziono kartoteki.' });
      return;
    }

    kartoteka.note = String(req.body.note ?? '').trim();
    addPanelActivityLog(req.panelSession, 'Edycja kartoteki', `Zmieniono opis kartoteki ${kartoteka.displayName || kartoteka.username}.`, {
      guildId: req.params.guildId,
      targetUsername: kartoteka.username
    });
    saveConfig();

    res.json({ ok: true, kartoteka: serializeKartoteka(kartoteka) });
  });

  app.use('/', express.static(PANEL_DIR));

  panelServer.listen(PANEL_PORT, () => {
    console.log(`Panel aplikacji dziala na porcie ${PANEL_PORT}`);
  });
}

async function findMemberByDiscordNick(guild, query) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return null;

  const exactCacheMatch = guild.members.cache.find(member => {
    const candidates = [
      member.user.username,
      member.displayName,
      member.user.globalName
    ].filter(Boolean).map(value => value.toLowerCase());
    return candidates.includes(normalized);
  });
  if (exactCacheMatch) return exactCacheMatch;

  const searchSources = [];
  if (typeof guild.members.search === 'function') {
    searchSources.push(() => guild.members.search({ query, limit: 10 }));
  }
  searchSources.push(() => guild.members.fetch({ query, limit: 10 }));

  for (const loadMembers of searchSources) {
    try {
      const result = await loadMembers();
      const collection = typeof result?.values === 'function' ? [...result.values()] : [];
      const exactMatch = collection.find(member => {
        const candidates = [
          member.user.username,
          member.displayName,
          member.user.globalName
        ].filter(Boolean).map(value => value.toLowerCase());
        return candidates.includes(normalized);
      });
      if (exactMatch) return exactMatch;
      if (collection.length > 0) return collection[0];
    } catch {}
  }

  return null;
}

async function sendKartotekaPanel(channel, cfg) {
  if (!isSupportedTextChannel(channel) || typeof channel.send !== 'function') return null;
  const message = await channel.send({
    embeds: [buildKartotekaPanelEmbed()],
    components: getKartotekaPanelComponents()
  });
  cfg.kartotekaPanelMessageId = message.id;
  return message;
}

function matchesIssuerNick(mandate, nick) {
  const normalizedNick = (nick || '').trim().toLowerCase();
  if (!normalizedNick) return false;
  const possibleNames = [
    mandate.issuerDisplayName,
    mandate.issuerUsername
  ]
    .filter(Boolean)
    .map(value => value.trim().toLowerCase());
  return possibleNames.includes(normalizedNick);
}

function isSameDate(timestamp, day, month, year) {
  const date = new Date(timestamp);
  return date.getDate() === day && date.getMonth() + 1 === month && date.getFullYear() === year;
}

async function registerCommands() {
  const commands = [
    {
      name: 'ustawkanaldomandatow',
      description: 'Ustaw kanal komend mandatow i kanal informacji o mandatach',
      options: [
        { name: 'komendy', description: 'Kanal gdzie daje sie mandaty', type: 7, required: true },
        { name: 'informacje', description: 'Kanal gdzie przychodza informacje o mandatach', type: 7, required: true }
      ]
    },
    {
      name: 'mandatyperrmison',
      description: 'Lista lub nadanie permisji do mandatow',
      options: [
        {
          name: 'akcja',
          description: 'list/dodaj/usun',
          type: 3,
          required: true,
          choices: [
            { name: 'list', value: 'list' },
            { name: 'dodaj', value: 'dodaj' },
            { name: 'usun', value: 'usun' }
          ]
        },
        { name: 'rola', description: 'Rola z permisja do mandatow', type: 8, required: false },
        { name: 'uzytkownik', description: 'Uzytkownik z permisja do mandatow', type: 6, required: false }
      ]
    },
    {
      name: 'mandat',
      description: 'Wystaw mandat',
      options: [
        { name: 'kto', description: 'Kto daje mandat', type: 6, required: true },
        { name: 'komu', description: 'Komu dajesz mandat', type: 6, required: true },
        { name: 'kwota', description: 'Kwota mandatu', type: 4, required: true },
        { name: 'powod', description: 'Powod mandatu', type: 3, required: true },
        { name: 'punktykarne', description: 'Punkty karne', type: 4, required: false }
      ]
    },
    {
      name: 'arrestkanal',
      description: 'Ustaw kanal komend aresztow i kanal informacji o aresztach',
      options: [
        { name: 'komendy', description: 'Kanal gdzie nadaje sie areszty', type: 7, required: true },
        { name: 'informacje', description: 'Kanal gdzie przychodza informacje o aresztach', type: 7, required: true }
      ]
    },
    {
      name: 'arrestperrmison',
      description: 'Lista lub nadanie permisji do aresztow',
      options: [
        {
          name: 'akcja',
          description: 'list/dodaj/usun',
          type: 3,
          required: true,
          choices: [
            { name: 'list', value: 'list' },
            { name: 'dodaj', value: 'dodaj' },
            { name: 'usun', value: 'usun' }
          ]
        },
        { name: 'rola', description: 'Rola z permisja do aresztow', type: 8, required: false },
        { name: 'uzytkownik', description: 'Uzytkownik z permisja do aresztow', type: 6, required: false }
      ]
    },
    {
      name: 'arrest',
      description: 'Nadaj areszt lub pojscie do wiezienia',
      options: [
        { name: 'kto', description: 'Kto aresztuje', type: 6, required: true },
        { name: 'komu', description: 'Kogo aresztujesz', type: 6, required: true },
        { name: 'powod', description: 'Za co aresztujesz', type: 3, required: true },
        {
          name: 'rodzaj',
          description: 'Areszt czy pojscie do wiezienia',
          type: 3,
          required: true,
          choices: [
            { name: 'areszt', value: 'areszt' },
            { name: 'pojscie do wiezienia', value: 'wiezienie' }
          ]
        },
        { name: 'czas', description: 'Na ile czasu, jesli to wiezienie', type: 3, required: false }
      ]
    },
    {
      name: 'sprawdziloscmandatow',
      description: 'Sprawdz ilosc mandatow i zarobek z mandatow dla osoby z Discorda i daty',
      options: [
        { name: 'osoba', description: 'Osoba z Discorda', type: 6, required: true },
        { name: 'dzien', description: 'Dzien', type: 4, required: true },
        { name: 'miesiac', description: 'Miesiac', type: 4, required: true },
        { name: 'rok', description: 'Rok', type: 4, required: true }
      ]
    },
    {
      name: 'sprawdzmandat',
      description: 'Sprawdz szczegoly mandatu po jego ID',
      options: [
        { name: 'idmandatu', description: 'ID mandatu', type: 3, required: true }
      ]
    },
    {
      name: 'ustawkanaldonickow',
      description: 'Ustaw kanal i role odblokowujaca po wpisaniu nicku Roblox',
      options: [
        { name: 'kanal', description: 'Kanal, na ktorym gracze wpisuja nick Roblox', type: 7, required: true },
        { name: 'rola', description: 'Rola, ktora odblokuje serwer po wpisaniu nicku', type: 8, required: true }
      ]
    },
    {
      name: 'nickroblox',
      description: 'Ustaw swoj nick Roblox i odblokuj serwer',
      options: [
        { name: 'nick', description: 'Twoj nick z Roblox', type: 3, required: true }
      ]
    },
    {
      name: 'kartotekakanal',
      description: 'Ustaw kanal panelu kartoteki',
      options: [
        { name: 'kanal', description: 'Kanal, gdzie ma byc panel kartoteki', type: 7, required: true }
      ]
    },
    {
      name: 'kartotekaperrmison',
      description: 'Lista lub nadanie permisji do kartoteki',
      options: [
        {
          name: 'akcja',
          description: 'list/dodaj/usun',
          type: 3,
          required: true,
          choices: [
            { name: 'list', value: 'list' },
            { name: 'dodaj', value: 'dodaj' },
            { name: 'usun', value: 'usun' }
          ]
        },
        { name: 'rola', description: 'Rola z permisja do kartoteki', type: 8, required: false },
        { name: 'uzytkownik', description: 'Uzytkownik z permisja do kartoteki', type: 6, required: false }
      ]
    },
    {
      name: 'edytujkarotekemandat',
      description: 'Edytuj wpis mandatowy w kartotece po ID mandatu',
      options: [
        { name: 'idmandatu', description: 'ID mandatu do edycji', type: 3, required: true }
      ]
    },
    {
      name: 'usunmandatzkartoteki',
      description: 'Usun mandat po ID z kartoteki i z listy mandatow',
      options: [
        { name: 'idmandatu', description: 'ID mandatu do usuniecia', type: 3, required: true }
      ]
    },
    {
      name: 'edytojkartotekaarreszt',
      description: 'Edytuj wpis aresztu w kartotece po ID aresztu',
      options: [
        { name: 'idaresztu', description: 'ID aresztu do edycji', type: 3, required: true }
      ]
    },
    {
      name: 'usunkartotekaarreszt',
      description: 'Usun areszt po ID z kartoteki i z listy aresztow',
      options: [
        { name: 'idaresztu', description: 'ID aresztu do usuniecia', type: 3, required: true }
      ]
    }
  ];

  const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(DISCORD_APP_ID, GUILD_ID), { body: commands });
  console.log('Zarejestrowano komendy');
}

client.on('clientReady', () => {
  console.log(`Zalogowano jako ${client.user.tag}`);
});

client.on('interactionCreate', async interaction => {
  try {
    if (interaction.isChatInputCommand()) {
      const cfg = ensureGuild(interaction.guildId);

      if (interaction.commandName === 'ustawkanaldomandatow') {
        if (!isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Tej komendy moga uzywac tylko wybrane osoby.', flags: 64 });
          return;
        }
        const commandChannel = interaction.options.getChannel('komendy', true);
        const infoChannel = interaction.options.getChannel('informacje', true);
        if (!isSupportedTextChannel(commandChannel) || !isSupportedTextChannel(infoChannel)) {
          await interaction.reply({ content: 'Wybierz kanaly tekstowe.', flags: 64 });
          return;
        }
        cfg.mandateCommandChannelId = commandChannel.id;
        cfg.mandateInfoChannelId = infoChannel.id;
        saveConfig();
        await interaction.reply({
          content: `Mandaty: <#${cfg.mandateCommandChannelId}> -> <#${cfg.mandateInfoChannelId}>`,
          flags: 64
        });
        return;
      }

      if (interaction.commandName === 'mandatyperrmison') {
        if (!isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Tej komendy moga uzywac tylko wybrane osoby.', flags: 64 });
          return;
        }
        const action = interaction.options.getString('akcja', true);
        const role = interaction.options.getRole('rola');
        const user = interaction.options.getUser('uzytkownik');
        if (action === 'list') {
          await interaction.reply({ content: formatPermissionList(cfg.mandateRoleIds, cfg.mandateUserIds), flags: 64 });
          return;
        }
        if (!role && !user) {
          await interaction.reply({ content: 'Podaj role albo uzytkownika.', flags: 64 });
          return;
        }
        if (role) updatePermissionEntries(cfg.mandateRoleIds, role.id, action);
        if (user) updatePermissionEntries(cfg.mandateUserIds, user.id, action);
        saveConfig();
        const changed = [role ? `<@&${role.id}>` : null, user ? `<@${user.id}>` : null].filter(Boolean).join(', ');
        await interaction.reply({ content: `Zaktualizowano permisje mandatow dla: ${changed}`, flags: 64 });
        return;
      }

      if (interaction.commandName === 'arrestkanal') {
        if (!isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Tej komendy moga uzywac tylko wybrane osoby.', flags: 64 });
          return;
        }
        const commandChannel = interaction.options.getChannel('komendy', true);
        const infoChannel = interaction.options.getChannel('informacje', true);
        if (!isSupportedTextChannel(commandChannel) || !isSupportedTextChannel(infoChannel)) {
          await interaction.reply({ content: 'Wybierz kanaly tekstowe.', flags: 64 });
          return;
        }
        cfg.arrestCommandChannelId = commandChannel.id;
        cfg.arrestInfoChannelId = infoChannel.id;
        saveConfig();
        await interaction.reply({
          content: `Areszty: <#${cfg.arrestCommandChannelId}> -> <#${cfg.arrestInfoChannelId}>`,
          flags: 64
        });
        return;
      }

      if (interaction.commandName === 'arrestperrmison') {
        if (!isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Tej komendy moga uzywac tylko wybrane osoby.', flags: 64 });
          return;
        }
        const action = interaction.options.getString('akcja', true);
        const role = interaction.options.getRole('rola');
        const user = interaction.options.getUser('uzytkownik');
        if (action === 'list') {
          await interaction.reply({ content: formatPermissionList(cfg.arrestRoleIds, cfg.arrestUserIds), flags: 64 });
          return;
        }
        if (!role && !user) {
          await interaction.reply({ content: 'Podaj role albo uzytkownika.', flags: 64 });
          return;
        }
        if (role) updatePermissionEntries(cfg.arrestRoleIds, role.id, action);
        if (user) updatePermissionEntries(cfg.arrestUserIds, user.id, action);
        saveConfig();
        const changed = [role ? `<@&${role.id}>` : null, user ? `<@${user.id}>` : null].filter(Boolean).join(', ');
        await interaction.reply({ content: `Zaktualizowano permisje aresztow dla: ${changed}`, flags: 64 });
        return;
      }

      if (interaction.commandName === 'ustawkanaldonickow') {
        if (!isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Tej komendy moga uzywac tylko wybrane osoby.', flags: 64 });
          return;
        }

        const nickChannel = interaction.options.getChannel('kanal', true);
        const verifiedRole = interaction.options.getRole('rola', true);
        if (!isSupportedTextChannel(nickChannel)) {
          await interaction.reply({ content: 'Wybierz kanal tekstowy.', flags: 64 });
          return;
        }

        cfg.robloxNickChannelId = nickChannel.id;
        cfg.robloxNickVerifiedRoleId = verifiedRole.id;
        saveConfig();

        const instruction = [
          'Witaj na serwerze Komisariat Policji x Fordon RP.',
          'Aby odblokowac reszte kanalow, wpisz tutaj komende:',
          '`/nickroblox nick:TwojNickRoblox`',
          'Po poprawnym wpisaniu nicku bot zmieni Twoj wyswietlany nick i nada role odblokowujaca serwer.'
        ].join('\n');

        await nickChannel.send({ content: instruction }).catch(() => {});
        await interaction.reply({
          content: `Kanal do nickow Roblox: <#${cfg.robloxNickChannelId}>. Rola po wpisaniu nicku: <@&${cfg.robloxNickVerifiedRoleId}>.`,
          flags: 64
        });
        return;
      }

      if (interaction.commandName === 'nickroblox') {
        if (!cfg.robloxNickChannelId || !cfg.robloxNickVerifiedRoleId) {
          await interaction.reply({ content: 'Administracja nie ustawila jeszcze kanalu i roli do nickow Roblox.', flags: 64 });
          return;
        }
        if (interaction.channelId !== cfg.robloxNickChannelId) {
          await interaction.reply({ content: `Nick Roblox ustawisz tylko w <#${cfg.robloxNickChannelId}>.`, flags: 64 });
          return;
        }

        const member = interaction.member;
        if (member?.roles?.cache?.has(cfg.robloxNickVerifiedRoleId)) {
          await interaction.reply({ content: 'Masz juz ustawiony nick Roblox i odblokowany serwer.', flags: 64 });
          return;
        }

        const robloxNick = interaction.options.getString('nick', true).trim();
        if (!isValidRobloxNick(robloxNick)) {
          await interaction.reply({ content: 'Nick Roblox moze miec tylko litery, cyfry i `_`, od 3 do 20 znakow.', flags: 64 });
          return;
        }

        const verifiedRole =
          interaction.guild.roles.cache.get(cfg.robloxNickVerifiedRoleId)
          ?? await interaction.guild.roles.fetch(cfg.robloxNickVerifiedRoleId).catch(() => null);

        if (!verifiedRole) {
          await interaction.reply({ content: 'Nie znalazlem ustawionej roli po wpisaniu nicku. Popros administracje o ponowne ustawienie `/ustawkanaldonickow`.', flags: 64 });
          return;
        }

        try {
          await member.setNickname(robloxNick, 'Ustawienie nicku Roblox');
        } catch {
          await interaction.reply({ content: 'Nie moglem zmienic Twojego nicku. Bot musi miec `Manage Nicknames` i najwyzsza role nad Twoja.', flags: 64 });
          return;
        }

        try {
          await member.roles.add(verifiedRole, 'Gracz ustawil nick Roblox');
        } catch {
          await interaction.reply({ content: 'Nick ustawilem, ale nie moglem nadac roli odblokowujacej. Bot musi miec `Manage Roles` i role wyzej od tej roli.', flags: 64 });
          return;
        }

        await interaction.reply({
          content: `Ustawiono Twoj nick na **${robloxNick}** i odblokowano dostep do serwera.`,
          flags: 64
        });
        return;
      }

      if (interaction.commandName === 'kartotekakanal') {
        if (!isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Tej komendy moga uzywac tylko wybrane osoby.', flags: 64 });
          return;
        }

        const kartotekaChannel = interaction.options.getChannel('kanal', true);
        if (!isSupportedTextChannel(kartotekaChannel)) {
          await interaction.reply({ content: 'Wybierz kanal tekstowy.', flags: 64 });
          return;
        }

        if (cfg.kartotekaChannelId && cfg.kartotekaPanelMessageId) {
          try {
            const previousChannel = await interaction.guild.channels.fetch(cfg.kartotekaChannelId).catch(() => null);
            if (isSupportedTextChannel(previousChannel) && typeof previousChannel.messages?.fetch === 'function') {
              const previousMessage = await previousChannel.messages.fetch(cfg.kartotekaPanelMessageId).catch(() => null);
              if (previousMessage) await previousMessage.delete().catch(() => {});
            }
          } catch {}
        }

        cfg.kartotekaChannelId = kartotekaChannel.id;
        const panelMessage = await sendKartotekaPanel(kartotekaChannel, cfg);
        saveConfig();

        await interaction.reply({
          content: panelMessage
            ? `Panel kartoteki ustawiony w <#${kartotekaChannel.id}>.`
            : 'Nie udalo sie wyslac panelu kartoteki na ten kanal.',
          flags: 64
        });
        return;
      }

      if (interaction.commandName === 'kartotekaperrmison') {
        if (!isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Tej komendy moga uzywac tylko wybrane osoby.', flags: 64 });
          return;
        }

        const action = interaction.options.getString('akcja', true);
        const role = interaction.options.getRole('rola');
        const user = interaction.options.getUser('uzytkownik');

        if (action === 'list') {
          await interaction.reply({ content: formatPermissionList(cfg.kartotekaRoleIds, cfg.kartotekaUserIds), flags: 64 });
          return;
        }

        if (!role && !user) {
          await interaction.reply({ content: 'Podaj role albo uzytkownika.', flags: 64 });
          return;
        }

        if (role) updatePermissionEntries(cfg.kartotekaRoleIds, role.id, action);
        if (user) updatePermissionEntries(cfg.kartotekaUserIds, user.id, action);
        saveConfig();

        const changed = [role ? `<@&${role.id}>` : null, user ? `<@${user.id}>` : null].filter(Boolean).join(', ');
        await interaction.reply({ content: `Zaktualizowano permisje kartoteki dla: ${changed}`, flags: 64 });
        return;
      }

      if (interaction.commandName === 'edytujkarotekemandat') {
        if (!hasKartotekaPermission(interaction.member, cfg) && !isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Brak uprawnien do edycji wpisow kartoteki.', flags: 64 });
          return;
        }

        const mandateId = interaction.options.getString('idmandatu', true).trim().toUpperCase();
        const mandate = cfg.mandates.find(item => item.id === mandateId);
        if (!mandate) {
          await interaction.reply({ content: 'Nie znalazlem mandatu o tym ID.', flags: 64 });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId(`kartoteka_edytuj_mandat_modal:${mandateId}`)
          .setTitle('Edytuj mandat w kartotece');

        const reasonInput = new TextInputBuilder()
          .setCustomId('mandat_reason')
          .setLabel('Powod mandatu')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setValue((mandate.reason || '').slice(0, 4000));

        const pointsInput = new TextInputBuilder()
          .setCustomId('mandat_points')
          .setLabel('Punkty karne')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('Np. 10 albo zostaw puste')
          .setValue(typeof mandate.penaltyPoints === 'number' ? String(mandate.penaltyPoints) : '');

        const statusInput = new TextInputBuilder()
          .setCustomId('mandat_status')
          .setLabel('Status mandatu')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('oczekuje / oczekiwanie / zaplacony / odrzucony / zamkniety')
          .setValue(getMandateStatusLabel(mandate.status));

        modal.addComponents(
          new ActionRowBuilder().addComponents(reasonInput),
          new ActionRowBuilder().addComponents(pointsInput),
          new ActionRowBuilder().addComponents(statusInput)
        );

        await interaction.showModal(modal);
        return;
      }

      if (interaction.commandName === 'usunmandatzkartoteki') {
        if (!hasKartotekaPermission(interaction.member, cfg) && !isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Brak uprawnien do usuwania wpisow kartoteki.', flags: 64 });
          return;
        }

        const mandateId = interaction.options.getString('idmandatu', true).trim().toUpperCase();
        const mandateIndex = cfg.mandates.findIndex(item => item.id === mandateId);
        if (mandateIndex === -1) {
          await interaction.reply({ content: 'Nie znalazlem mandatu o tym ID.', flags: 64 });
          return;
        }

        const [removedMandate] = cfg.mandates.splice(mandateIndex, 1);
        for (const kartoteka of cfg.kartoteki) {
          kartoteka.entries = (kartoteka.entries || []).filter(entry => !(entry.type === 'mandat' && entry.mandateId === mandateId));
        }
        saveConfig();

        const channel = await interaction.guild.channels.fetch(removedMandate.channelId).catch(() => null);
        if (channel && typeof channel.delete === 'function') {
          await channel.delete('Usunieto mandat z kartoteki').catch(() => {});
        }

        await interaction.reply({
          content: `Usunieto mandat ${mandateId} z kartoteki i z listy mandatow.`,
          flags: 64
        });
        return;
      }

      if (interaction.commandName === 'edytojkartotekaarreszt') {
        if (!hasKartotekaPermission(interaction.member, cfg) && !hasArrestPermission(interaction.member, cfg) && !isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Brak uprawnien do edycji aresztow w kartotece.', flags: 64 });
          return;
        }

        const arrestId = interaction.options.getString('idaresztu', true).trim().toUpperCase();
        const arrest = cfg.arrests.find(item => item.id === arrestId);
        if (!arrest) {
          await interaction.reply({ content: 'Nie znalazlem aresztu o tym ID.', flags: 64 });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId(`kartoteka_edytuj_arrest_modal:${arrestId}`)
          .setTitle('Edytuj areszt w kartotece');

        const reasonInput = new TextInputBuilder()
          .setCustomId('arrest_reason')
          .setLabel('Powod aresztu')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(true)
          .setValue((arrest.reason || '').slice(0, 4000));

        const typeInput = new TextInputBuilder()
          .setCustomId('arrest_kind')
          .setLabel('Rodzaj')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('areszt albo wiezienie')
          .setValue(arrest.kind === 'wiezienie' ? 'wiezienie' : 'areszt');

        const durationInput = new TextInputBuilder()
          .setCustomId('arrest_duration')
          .setLabel('Czas')
          .setStyle(TextInputStyle.Short)
          .setRequired(false)
          .setPlaceholder('Np. 30 minut, 2 godziny, 3 dni')
          .setValue((arrest.duration || '').slice(0, 100));

        modal.addComponents(
          new ActionRowBuilder().addComponents(reasonInput),
          new ActionRowBuilder().addComponents(typeInput),
          new ActionRowBuilder().addComponents(durationInput)
        );

        await interaction.showModal(modal);
        return;
      }

      if (interaction.commandName === 'usunkartotekaarreszt') {
        if (!hasKartotekaPermission(interaction.member, cfg) && !hasArrestPermission(interaction.member, cfg) && !isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Brak uprawnien do usuwania aresztow z kartoteki.', flags: 64 });
          return;
        }

        const arrestId = interaction.options.getString('idaresztu', true).trim().toUpperCase();
        const arrestIndex = cfg.arrests.findIndex(item => item.id === arrestId);
        if (arrestIndex === -1) {
          await interaction.reply({ content: 'Nie znalazlem aresztu o tym ID.', flags: 64 });
          return;
        }

        cfg.arrests.splice(arrestIndex, 1);
        for (const kartoteka of cfg.kartoteki) {
          kartoteka.entries = (kartoteka.entries || []).filter(entry => !(entry.type === 'arrest' && entry.arrestId === arrestId));
        }
        saveConfig();

        await interaction.reply({
          content: `Usunieto areszt ${arrestId} z kartoteki i z listy aresztow.`,
          flags: 64
        });
        return;
      }

      if (interaction.commandName === 'arrest') {
        if (!cfg.arrestCommandChannelId || !cfg.arrestInfoChannelId) {
          await interaction.reply({ content: 'Najpierw ustaw kanaly komenda /arrestkanal.', flags: 64 });
          return;
        }
        if (interaction.channelId !== cfg.arrestCommandChannelId) {
          await interaction.reply({ content: `Areszty nadajesz tylko w <#${cfg.arrestCommandChannelId}>.`, flags: 64 });
          return;
        }
        if (!hasArrestPermission(interaction.member, cfg)) {
          await interaction.reply({ content: 'Brak uprawnien do wystawiania aresztow.', flags: 64 });
          return;
        }

        const issuer = interaction.options.getUser('kto', true);
        const target = interaction.options.getUser('komu', true);
        const reason = interaction.options.getString('powod', true).trim();
        const kind = interaction.options.getString('rodzaj', true);
        const duration = (interaction.options.getString('czas') || '').trim();

        if (issuer.id !== interaction.user.id) {
          await interaction.reply({ content: 'W polu kto mozesz wskazac tylko siebie.', flags: 64 });
          return;
        }
        if (issuer.id === target.id) {
          await interaction.reply({ content: 'Nie mozesz nadac aresztu samemu sobie.', flags: 64 });
          return;
        }
        if (!reason) {
          await interaction.reply({ content: 'Musisz podac powod aresztu.', flags: 64 });
          return;
        }
        if (kind === 'wiezienie' && !duration) {
          await interaction.reply({ content: 'Jesli to pojscie do wiezienia, podaj czas.', flags: 64 });
          return;
        }

        const arrestId = generateArrestId();
        const arrestRecord = {
          id: arrestId,
          issuerId: issuer.id,
          issuerDisplayName: interaction.guild.members.cache.get(issuer.id)?.displayName ?? issuer.globalName ?? issuer.username,
          issuerUsername: issuer.username,
          targetId: target.id,
          targetDisplayName: interaction.guild.members.cache.get(target.id)?.displayName ?? target.globalName ?? target.username,
          targetUsername: target.username,
          reason,
          description: '',
          kind,
          duration: kind === 'wiezienie' ? duration : null,
          createdAt: Date.now()
        };

        cfg.arrests.unshift(arrestRecord);
        cfg.arrests = cfg.arrests.slice(0, 200);
        syncArrestToKartoteka(cfg, arrestRecord, {
          id: target.id,
          username: target.username,
          displayName: interaction.guild.members.cache.get(target.id)?.displayName ?? target.globalName ?? target.username
        });
        saveConfig();

        const infoChannel = await interaction.client.channels.fetch(cfg.arrestInfoChannelId).catch(() => null);
        if (isSupportedTextChannel(infoChannel) && typeof infoChannel.send === 'function') {
          await infoChannel.send({
            embeds: [buildArrestEmbed(arrestRecord)]
          }).catch(() => {});
        }

        await interaction.reply({
          content: `Wystawiono ${kind === 'wiezienie' ? 'pojscie do wiezienia' : 'areszt'} ${arrestId} dla <@${target.id}>.`,
          flags: 64
        });
        return;
      }

      if (interaction.commandName === 'mandat') {
        if (!cfg.mandateCommandChannelId || !cfg.mandateInfoChannelId) {
          await interaction.reply({ content: 'Najpierw ustaw kanaly komenda /ustawkanaldomandatow.', flags: 64 });
          return;
        }
        if (interaction.channelId !== cfg.mandateCommandChannelId) {
          await interaction.reply({ content: `Mandaty wystawisz tylko w <#${cfg.mandateCommandChannelId}>.`, flags: 64 });
          return;
        }
        if (!hasMandatePermission(interaction.member, cfg)) {
          await interaction.reply({ content: 'Brak uprawnien do wystawiania mandatow.', flags: 64 });
          return;
        }

        const issuer = interaction.options.getUser('kto', true);
        const target = interaction.options.getUser('komu', true);
        const amount = interaction.options.getInteger('kwota', true);
        const penaltyPoints = interaction.options.getInteger('punktykarne');
        const reason = interaction.options.getString('powod', true).trim();

        if (amount <= 0) {
          await interaction.reply({ content: 'Kwota mandatu musi byc wieksza od 0.', flags: 64 });
          return;
        }
        if (penaltyPoints !== null && penaltyPoints < 0) {
          await interaction.reply({ content: 'Punkty karne nie moga byc mniejsze od 0.', flags: 64 });
          return;
        }
        if (issuer.id !== interaction.user.id) {
          await interaction.reply({ content: 'W polu kto mozesz wskazac tylko siebie.', flags: 64 });
          return;
        }
        if (issuer.id === target.id) {
          await interaction.reply({ content: 'Nie mozesz wystawic mandatu tej samej osobie.', flags: 64 });
          return;
        }

        const mandateId = generateMandateId();
        const guild = interaction.guild;
        const everyoneRole = guild.roles.everyone;
        const channelName = sanitizeChannelName(`mandat-${target.username}-${mandateId.toLowerCase()}`);
        const permissionOverwrites = [
          { id: everyoneRole.id, deny: [PermissionFlagsBits.ViewChannel] },
          { id: target.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          { id: issuer.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] },
          {
            id: guild.members.me.id,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels]
          }
        ];

        for (const roleId of cfg.mandateRoleIds) {
          permissionOverwrites.push({
            id: roleId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
          });
        }
        for (const userId of cfg.mandateUserIds) {
          permissionOverwrites.push({
            id: userId,
            allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory]
          });
        }

        const privateChannel = await guild.channels.create({
          name: channelName,
          type: ChannelType.GuildText,
          permissionOverwrites
        });

        const mandateRecord = {
          id: mandateId,
          issuerId: issuer.id,
          issuerDisplayName: interaction.guild.members.cache.get(issuer.id)?.displayName ?? issuer.globalName ?? issuer.username,
          issuerUsername: issuer.username,
          targetId: target.id,
          targetDisplayName: interaction.guild.members.cache.get(target.id)?.displayName ?? target.globalName ?? target.username,
          targetUsername: target.username,
          amount,
          penaltyPoints: penaltyPoints ?? null,
          reason,
          description: '',
          channelId: privateChannel.id,
          createdAt: Date.now(),
          status: 'oczekuje'
        };
        cfg.mandates.unshift(mandateRecord);
        cfg.mandates = cfg.mandates.slice(0, 200);
        syncMandateToKartoteka(cfg, mandateRecord, {
          id: target.id,
          username: target.username,
          displayName: interaction.guild.members.cache.get(target.id)?.displayName ?? target.globalName ?? target.username
        });
        saveConfig();

        const mandateEmbed = buildMandateEmbed({ ...mandateRecord, statusLabel: 'Oczekuje na decyzje' });
        await privateChannel.send({
          content: [
            `${target} otrzymal mandat od ${issuer}.`,
            'Mozesz zaakceptowac mandat i zaplacic go na serwerze albo go odrzucic.',
            'Po kliknieciu ZAPLAC bot napisze, co masz zrobic dalej.'
          ].join('\n'),
          embeds: [mandateEmbed],
          components: getMandateComponents(mandateId)
        });

        const infoChannel = await interaction.client.channels.fetch(cfg.mandateInfoChannelId).catch(() => null);
        if (isSupportedTextChannel(infoChannel) && typeof infoChannel.send === 'function') {
          await infoChannel.send({
            embeds: [buildMandateEmbed({ ...mandateRecord, statusLabel: 'Wystawiony' }).setColor(Colors.Blue)]
          }).catch(() => {});
        }

        await interaction.reply({
          content: `Wystawiono mandat ${mandateId}. Prywatny kanal: <#${privateChannel.id}>`,
          flags: 64
        });
        return;
      }

      if (interaction.commandName === 'sprawdziloscmandatow') {
        if (!isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Tej komendy moga uzywac tylko wybrane osoby.', flags: 64 });
          return;
        }
        const person = interaction.options.getUser('osoba', true);
        const day = interaction.options.getInteger('dzien', true);
        const month = interaction.options.getInteger('miesiac', true);
        const year = interaction.options.getInteger('rok', true);

        if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000 || year > 3000) {
          await interaction.reply({ content: 'Podaj poprawna date.', flags: 64 });
          return;
        }

        const mandatesForDay = cfg.mandates.filter(mandate =>
          mandate.issuerId === person.id && isSameDate(mandate.createdAt, day, month, year)
        );

        const paidMandates = mandatesForDay.filter(mandate => mandate.status === 'zaplacony');
        const paidCount = paidMandates.length;
        const earnedAmount = paidMandates.reduce((sum, mandate) => sum + Number(mandate.amount || 0), 0);

        await interaction.reply({
          content: [
            `Osoba: ${person}`,
            `Data: **${day}.${month}.${year}**`,
            `Ilosc oplaconych mandatow: **${paidCount}**`,
            `Zarobek z oplaconych mandatow: **${earnedAmount} PLN**`
          ].join('\n'),
          flags: 64
        });
        return;
      }

      if (interaction.commandName === 'sprawdzmandat') {
        if (!hasMandatePermission(interaction.member, cfg) && !isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Brak uprawnien do sprawdzania mandatow.', flags: 64 });
          return;
        }

        const mandateId = interaction.options.getString('idmandatu', true).trim().toUpperCase();
        const mandate = cfg.mandates.find(item => item.id === mandateId);

        if (!mandate) {
          await interaction.reply({ content: 'Nie znalazlem mandatu o tym ID.', flags: 64 });
          return;
        }

        await interaction.reply({
          embeds: [
            buildMandateEmbed({
              ...mandate,
              statusLabel: getMandateStatusLabel(mandate.status)
            }).setColor(Colors.Blurple)
          ],
          flags: 64
        });
        return;
      }
    }

    if (interaction.isModalSubmit()) {
      const cfg = ensureGuild(interaction.guildId);

      if (interaction.customId === 'kartoteka_otworz_modal') {
        if (!hasKartotekaPermission(interaction.member, cfg) && !isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Brak uprawnien do otwierania kartotek.', flags: 64 });
          return;
        }

        const searchValue = interaction.fields.getTextInputValue('kartoteka_nick').trim();
        const member = await findMemberByDiscordNick(interaction.guild, searchValue);
        if (!member) {
          await interaction.reply({ content: 'Nie znalazlem gracza o takim nicku Discord.', flags: 64 });
          return;
        }

        const kartoteka = getOrCreateKartoteka(cfg, {
          id: member.id,
          username: member.user.username,
          displayName: member.displayName
        });
        saveConfig();

        await interaction.reply({
          embeds: [buildKartotekaEmbed(kartoteka)],
          components: getKartotekaViewComponents(member.id),
          flags: 64
        });
        return;
      }

      if (interaction.customId.startsWith('kartoteka_edytuj_modal:')) {
        if (!hasKartotekaPermission(interaction.member, cfg) && !isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Brak uprawnien do edycji kartotek.', flags: 64 });
          return;
        }

        const userId = interaction.customId.split(':')[1];
        const kartoteka = cfg.kartoteki.find(entry => entry.userId === userId);
        if (!kartoteka) {
          await interaction.reply({ content: 'Nie znalazlem kartoteki tej osoby.', flags: 64 });
          return;
        }

        kartoteka.note = interaction.fields.getTextInputValue('kartoteka_opis').trim();
        saveConfig();

        await interaction.reply({
          content: 'Opis kartoteki zostal zapisany.',
          embeds: [buildKartotekaEmbed(kartoteka)],
          components: getKartotekaViewComponents(userId),
          flags: 64
        });
        return;
      }

      if (interaction.customId.startsWith('kartoteka_edytuj_mandat_modal:')) {
        if (!hasKartotekaPermission(interaction.member, cfg) && !isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Brak uprawnien do edycji wpisow kartoteki.', flags: 64 });
          return;
        }

        const mandateId = interaction.customId.split(':')[1];
        const mandate = cfg.mandates.find(item => item.id === mandateId);
        if (!mandate) {
          await interaction.reply({ content: 'Nie znalazlem mandatu o tym ID.', flags: 64 });
          return;
        }

        const newReason = interaction.fields.getTextInputValue('mandat_reason').trim();
        const rawPoints = interaction.fields.getTextInputValue('mandat_points').trim();
        const rawStatus = interaction.fields.getTextInputValue('mandat_status').trim();

        if (!newReason) {
          await interaction.reply({ content: 'Powod mandatu nie moze byc pusty.', flags: 64 });
          return;
        }

        let newPenaltyPoints = null;
        if (rawPoints) {
          if (!/^\d+$/.test(rawPoints)) {
            await interaction.reply({ content: 'Punkty karne musza byc liczba 0 lub wieksza.', flags: 64 });
            return;
          }
          newPenaltyPoints = Number(rawPoints);
        }

        mandate.reason = newReason;
        mandate.penaltyPoints = newPenaltyPoints;
        mandate.status = normalizeEditableMandateStatus(rawStatus, mandate.status);

        syncMandateToKartoteka(cfg, mandate, {
          id: mandate.targetId,
          username: mandate.targetUsername ?? 'Nieznany',
          displayName: mandate.targetDisplayName ?? mandate.targetUsername ?? 'Nieznany'
        });
        saveConfig();

        const kartoteka = cfg.kartoteki.find(entry => entry.userId === mandate.targetId);
        await interaction.reply({
          content: `Zapisano zmiany dla mandatu ${mandateId}.`,
          embeds: kartoteka ? [buildKartotekaEmbed(kartoteka)] : [buildMandateEmbed({ ...mandate, statusLabel: getMandateStatusLabel(mandate.status) })],
          components: kartoteka ? getKartotekaViewComponents(mandate.targetId) : [],
          flags: 64
        });
        return;
      }

      if (interaction.customId.startsWith('kartoteka_edytuj_arrest_modal:')) {
        if (!hasKartotekaPermission(interaction.member, cfg) && !hasArrestPermission(interaction.member, cfg) && !isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Brak uprawnien do edycji aresztow w kartotece.', flags: 64 });
          return;
        }

        const arrestId = interaction.customId.split(':')[1];
        const arrest = cfg.arrests.find(item => item.id === arrestId);
        if (!arrest) {
          await interaction.reply({ content: 'Nie znalazlem aresztu o tym ID.', flags: 64 });
          return;
        }

        const newReason = interaction.fields.getTextInputValue('arrest_reason').trim();
        const rawKind = interaction.fields.getTextInputValue('arrest_kind').trim().toLowerCase();
        const newDuration = interaction.fields.getTextInputValue('arrest_duration').trim();

        if (!newReason) {
          await interaction.reply({ content: 'Powod aresztu nie moze byc pusty.', flags: 64 });
          return;
        }

        const normalizedKind = ['wiezienie', 'wiezienie.'].includes(rawKind) ? 'wiezienie' : 'areszt';
        if (normalizedKind === 'wiezienie' && !newDuration) {
          await interaction.reply({ content: 'Dla pojscia do wiezienia podaj czas.', flags: 64 });
          return;
        }

        arrest.reason = newReason;
        arrest.kind = normalizedKind;
        arrest.duration = normalizedKind === 'wiezienie' ? newDuration : null;

        syncArrestToKartoteka(cfg, arrest, {
          id: arrest.targetId,
          username: arrest.targetUsername ?? 'Nieznany',
          displayName: arrest.targetDisplayName ?? arrest.targetUsername ?? 'Nieznany'
        });
        saveConfig();

        const kartoteka = cfg.kartoteki.find(entry => entry.userId === arrest.targetId);
        await interaction.reply({
          content: `Zapisano zmiany dla aresztu ${arrestId}.`,
          embeds: kartoteka ? [buildKartotekaEmbed(kartoteka)] : [buildArrestEmbed(arrest)],
          components: kartoteka ? getKartotekaViewComponents(arrest.targetId) : [],
          flags: 64
        });
        return;
      }
    }

    if (interaction.isButton()) {
      const cfg = ensureGuild(interaction.guildId);

      if (interaction.customId === 'kartoteka_otworz_panel') {
        if (!hasKartotekaPermission(interaction.member, cfg) && !isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Brak uprawnien do otwierania kartotek.', flags: 64 });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId('kartoteka_otworz_modal')
          .setTitle('Otworz kartoteke');

        const nickInput = new TextInputBuilder()
          .setCustomId('kartoteka_nick')
          .setLabel('Nick Discord gracza')
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setPlaceholder('Wpisz nick Discord gracza');

        modal.addComponents(new ActionRowBuilder().addComponents(nickInput));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('kartoteka_edytuj:')) {
        if (!hasKartotekaPermission(interaction.member, cfg) && !isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Brak uprawnien do edycji kartotek.', flags: 64 });
          return;
        }

        const userId = interaction.customId.split(':')[1];
        const kartoteka = cfg.kartoteki.find(entry => entry.userId === userId);
        if (!kartoteka) {
          await interaction.reply({ content: 'Nie znalazlem kartoteki tej osoby.', flags: 64 });
          return;
        }

        const modal = new ModalBuilder()
          .setCustomId(`kartoteka_edytuj_modal:${userId}`)
          .setTitle('Edytuj kartoteke');

        const noteInput = new TextInputBuilder()
          .setCustomId('kartoteka_opis')
          .setLabel('Opis kartoteki')
          .setStyle(TextInputStyle.Paragraph)
          .setRequired(false)
          .setPlaceholder('Dodaj notatke policyjna, podsumowanie albo dodatkowe informacje')
          .setValue((kartoteka.note || '').slice(0, 4000));

        modal.addComponents(new ActionRowBuilder().addComponents(noteInput));
        await interaction.showModal(modal);
        return;
      }

      if (interaction.customId.startsWith('kartoteka_odswiez:')) {
        if (!hasKartotekaPermission(interaction.member, cfg) && !isConfigOwner(interaction.user.id)) {
          await interaction.reply({ content: 'Brak uprawnien do podgladu kartotek.', flags: 64 });
          return;
        }

        const userId = interaction.customId.split(':')[1];
        const kartoteka = cfg.kartoteki.find(entry => entry.userId === userId);
        if (!kartoteka) {
          await interaction.reply({ content: 'Nie znalazlem kartoteki tej osoby.', flags: 64 });
          return;
        }

        await interaction.update({
          embeds: [buildKartotekaEmbed(kartoteka)],
          components: getKartotekaViewComponents(userId)
        });
        return;
      }

      const [action, mandateId] = interaction.customId.split(':');
      if (!['mandat_zaplac', 'mandat_odrzuc', 'mandat_oplacono', 'mandat_zamknij'].includes(action) || !mandateId) return;

      const mandate = cfg.mandates.find(item => item.id === mandateId);
      if (!mandate) {
        await interaction.reply({ content: 'Nie znalazlem tego mandatu.', flags: 64 });
        return;
      }
      const actionMap = {
        mandat_zaplac: 'zaplac',
        mandat_odrzuc: 'odrzuc',
        mandat_oplacono: 'oplacono',
        mandat_zamknij: 'zamknij'
      };

      try {
        const result = applyMandateAction(cfg, mandate, actionMap[action], interaction.user.id);
        saveConfig();

        await interaction.update(buildMandateCasePayload(mandate, result.content));

        if (result.closeChannelAfterMs) {
          await scheduleMandateChannelDeletion(interaction.guild, mandate, 'Zamknieta sprawa mandatu');
        }
      } catch (actionError) {
        await interaction.reply({ content: actionError.message || 'Nie udalo sie wykonac akcji.', flags: 64 });
      }
    }
  } catch (err) {
    console.error('Blad interakcji:', err);
    try {
      if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
        await interaction.reply({ content: 'Wystapil blad. Sprawdz logi bota.', flags: 64 });
      }
    } catch {}
  }
});

(async () => {
  startPanelServer();
  await registerCommands();
  await client.login(DISCORD_TOKEN);
})();
