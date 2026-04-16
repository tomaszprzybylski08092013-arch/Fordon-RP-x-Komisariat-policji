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
import fs from 'fs';
import path from 'path';

const { DISCORD_TOKEN, DISCORD_APP_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !DISCORD_APP_ID || !GUILD_ID) {
  throw new Error('Brak env DISCORD_TOKEN / DISCORD_APP_ID / GUILD_ID');
}

const CONFIG_OWNER_IDS = ['1034884709479612436', '1378291577973379117'];
const MANDATE_PAYMENT_USER_ID = '1034884709479612436';
const DATA_DIR = process.env.RAILWAY_VOLUME_MOUNT_PATH || process.cwd();
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');
const CONFIG_BACKUP_PATH = path.join(DATA_DIR, 'config.backup.json');
const CONFIG_TEMP_PATH = path.join(DATA_DIR, 'config.json.tmp');

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

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
}

function ensureGuild(guildId) {
  const cfg = guildConfig[guildId] || {};
  cfg.mandateCommandChannelId = cfg.mandateCommandChannelId ?? null;
  cfg.mandateInfoChannelId = cfg.mandateInfoChannelId ?? null;
  cfg.mandateRoleIds = Array.isArray(cfg.mandateRoleIds) ? cfg.mandateRoleIds : [];
  cfg.mandateUserIds = Array.isArray(cfg.mandateUserIds) ? cfg.mandateUserIds : [];
  cfg.mandates = Array.isArray(cfg.mandates) ? cfg.mandates : [];
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

  return new EmbedBuilder()
    .setColor(Colors.Orange)
    .setTitle('Mandat')
    .addFields(fields)
    .setTimestamp(new Date(mandate.createdAt));
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
  entry.status = mandate.status;
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
    { name: 'Suma punktow karnych', value: String(totalPenaltyPoints), inline: true }
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
        `Wystawil: <@${entry.issuerId}> | ${formatDateTime(entry.createdAt)}`
      ].join('\n');
    }).join('\n\n')
    : 'Brak wpisow mandatowych.';

  fields.push({
    name: latestEntries.length < mandateEntries.length
      ? `Historia mandatow (ostatnie ${latestEntries.length} z ${mandateEntries.length})`
      : 'Historia mandatow',
    value: historyValue.slice(0, 1024),
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
      if (action === 'mandat_zamknij') {
        if (interaction.user.id !== mandate.issuerId) {
          await interaction.reply({ content: 'Tylko osoba, ktora wystawila mandat, moze zamknac sprawe.', flags: 64 });
          return;
        }
        if (mandate.status === 'zamkniety') {
          await interaction.reply({ content: 'Ta sprawa jest juz zamknieta.', flags: 64 });
          return;
        }

        mandate.status = 'zamkniety';
        syncMandateToKartoteka(cfg, mandate, {
          id: mandate.targetId,
          username: mandate.targetUsername ?? 'Nieznany',
          displayName: mandate.targetDisplayName ?? mandate.targetUsername ?? 'Nieznany'
        });
        saveConfig();

        const closedEmbed = buildMandateEmbed({
          ...mandate,
          statusLabel: getMandateStatusLabel(mandate.status)
        }).setColor(Colors.DarkGrey);

        await interaction.update({
          content: `Sprawa zostala zamknieta przez <@${interaction.user.id}>. Kanal zostanie usuniety za chwile.`,
          embeds: [closedEmbed],
          components: getMandateComponents(mandate.id, { payDisabled: true, rejectDisabled: true, closeDisabled: true })
        });

        setTimeout(async () => {
          try {
            const channel = await interaction.guild.channels.fetch(mandate.channelId).catch(() => null);
            if (channel && typeof channel.delete === 'function') {
              await channel.delete('Zamknieta sprawa mandatu');
            }
          } catch (deleteError) {
            console.error('Nie udalo sie usunac kanalu sprawy:', deleteError);
          }
        }, 5000);
        return;
      }
      if (action === 'mandat_oplacono') {
        if (interaction.user.id !== mandate.issuerId) {
          await interaction.reply({ content: 'Tylko osoba, ktora wystawila mandat, moze potwierdzic oplacenie.', flags: 64 });
          return;
        }
        if (mandate.status === 'zaplacony') {
          await interaction.reply({ content: 'Ten mandat jest juz oznaczony jako oplacony.', flags: 64 });
          return;
        }
        if (mandate.status !== 'oczekiwanie-na-zaplate') {
          await interaction.reply({ content: 'Najpierw osoba z mandatem musi kliknac ZAPLAC.', flags: 64 });
          return;
        }

        mandate.status = 'zaplacony';
        syncMandateToKartoteka(cfg, mandate, {
          id: mandate.targetId,
          username: mandate.targetUsername ?? 'Nieznany',
          displayName: mandate.targetDisplayName ?? mandate.targetUsername ?? 'Nieznany'
        });
        saveConfig();

        const paidEmbed = buildMandateEmbed({
          ...mandate,
          statusLabel: getMandateStatusLabel(mandate.status)
        }).setColor(Colors.Green);

        await interaction.update({
          content: 'Mandat oplacony.',
          embeds: [paidEmbed],
          components: getMandateComponents(mandate.id, {
            payDisabled: true,
            rejectDisabled: true,
            paidDisabled: true,
            closeDisabled: false
          })
        });
        return;
      }
      if (interaction.user.id !== mandate.targetId) {
        await interaction.reply({ content: 'Tylko osoba, ktora dostala mandat, moze uzyc tego przycisku.', flags: 64 });
        return;
      }
      if (mandate.status === 'zaplacony') {
        await interaction.reply({ content: 'Ten mandat jest juz oznaczony jako oplacony.', flags: 64 });
        return;
      }
      if (mandate.status === 'zamkniety') {
        await interaction.reply({ content: 'Ta sprawa jest juz zamknieta.', flags: 64 });
        return;
      }
      if (mandate.status === 'oczekiwanie-na-zaplate') {
        await interaction.reply({ content: 'Ten mandat oczekuje juz na potwierdzenie platnosci przez osobe, ktora go wystawila.', flags: 64 });
        return;
      }

      if (action === 'mandat_odrzuc') {
        if (mandate.status === 'odrzucony-oczekuje-platnosci' || mandate.status === 'odrzucony') {
          await interaction.reply({ content: 'Ten mandat jest juz odrzucony. Nadal mozesz kliknac ZAPLAC, jesli zmienisz zdanie.', flags: 64 });
          return;
        }

        mandate.status = 'odrzucony-oczekuje-platnosci';
        syncMandateToKartoteka(cfg, mandate, {
          id: mandate.targetId,
          username: mandate.targetUsername ?? 'Nieznany',
          displayName: mandate.targetDisplayName ?? mandate.targetUsername ?? 'Nieznany'
        });
        saveConfig();

        const updatedEmbed = buildMandateEmbed({
          ...mandate,
          statusLabel: getMandateStatusLabel(mandate.status)
        }).setColor(Colors.Red);

        await interaction.update({
          content: `Mandat zostal odrzucony. Jesli zmienisz zdanie, nadal mozesz kliknac ZAPLAC i wtedy bot wysle instrukcje platnosci.`,
          embeds: [updatedEmbed],
          components: getMandateComponents(mandate.id, {
            payDisabled: false,
            rejectDisabled: true,
            paidDisabled: true,
            closeDisabled: false
          })
        });
        return;
      }

      mandate.status = 'oczekiwanie-na-zaplate';
      syncMandateToKartoteka(cfg, mandate, {
        id: mandate.targetId,
        username: mandate.targetUsername ?? 'Nieznany',
        displayName: mandate.targetDisplayName ?? mandate.targetUsername ?? 'Nieznany'
      });
      saveConfig();

      const updatedEmbed = buildMandateEmbed({
        ...mandate,
        statusLabel: getMandateStatusLabel(mandate.status)
      }).setColor(Colors.Green);

      await interaction.update({
        content: `Wejdz na serwer Fordon RP i przelej kase w ekonomii do <@${MANDATE_PAYMENT_USER_ID}>. Po przelewie osoba, ktora wystawila mandat, potwierdzi oplacenie.`,
        embeds: [updatedEmbed],
        components: getMandateComponents(mandate.id, {
          payDisabled: true,
          rejectDisabled: true,
          paidDisabled: false,
          closeDisabled: false
        })
      });
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
  await registerCommands();
  await client.login(DISCORD_TOKEN);
})();
