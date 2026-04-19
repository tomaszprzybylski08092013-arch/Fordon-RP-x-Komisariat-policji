const state = {
  guildId: null,
  authRequired: true,
  sessionToken: localStorage.getItem('panelSessionToken') || '',
  sessionRole: localStorage.getItem('panelSessionRole') || '',
  sessionUsername: localStorage.getItem('panelSessionUsername') || '',
  sessionDisplayName: localStorage.getItem('panelSessionDisplayName') || '',
  sessionAccountType: localStorage.getItem('panelSessionAccountType') || '',
  sessionDiscordUserId: localStorage.getItem('panelSessionDiscordUserId') || '',
  sessionPermissions: JSON.parse(localStorage.getItem('panelSessionPermissions') || 'null'),
  socket: null,
  snapshot: null,
  currentCategory: 'kartoteki',
  authMode: 'owner',
  earnings: {
    candidates: [],
    selectedUserId: '',
    scope: 'all',
    date: '',
    stats: null,
    showMandates: false
  },
  punishmentCandidates: [],
  activityLogs: [],
  activityActor: 'all',
  panelUsers: [],
  mandateCaseSignature: '',
  dismissedMandateCaseSignature: ''
};

const authOverlay = document.getElementById('authOverlay');
const authForm = document.getElementById('authForm');
const authKeyInput = document.getElementById('authKeyInput');
const authError = document.getElementById('authError');
const ownerModeButton = document.getElementById('ownerModeButton');
const userModeButton = document.getElementById('userModeButton');
const ownerAuthFields = document.getElementById('ownerAuthFields');
const userAuthFields = document.getElementById('userAuthFields');
const ownerLoginButton = document.getElementById('ownerLoginButton');
const discordLoginButton = document.getElementById('discordLoginButton');
const logoutButton = document.getElementById('logoutButton');
const liveDot = document.getElementById('liveDot');
const liveStatusLabel = document.getElementById('liveStatusLabel');
const mandatesList = document.getElementById('mandatesList');
const arrestsList = document.getElementById('arrestsList');
const kartotekiGrid = document.getElementById('kartotekiGrid');
const refreshButton = document.getElementById('refreshButton');
const mandatesCount = document.getElementById('mandatesCount');
const arrestsCount = document.getElementById('arrestsCount');
const kartotekiCount = document.getElementById('kartotekiCount');
const usersCount = document.getElementById('usersCount');
const usersList = document.getElementById('usersList');
const editorModal = document.getElementById('editorModal');
const editorBackdrop = document.getElementById('editorBackdrop');
const closeEditorButton = document.getElementById('closeEditorButton');
const editorTitle = document.getElementById('editorTitle');
const editorEyebrow = document.getElementById('editorEyebrow');
const editorForm = document.getElementById('editorForm');
const editorError = document.getElementById('editorError');
const categoryButtons = [...document.querySelectorAll('[data-category]')];
const categorySections = [...document.querySelectorAll('[data-section]')];
const ownerOnlyElements = [...document.querySelectorAll('.owner-only')];
const earningsOfficerSelect = document.getElementById('earningsOfficerSelect');
const earningsScopeSelect = document.getElementById('earningsScopeSelect');
const earningsDateInput = document.getElementById('earningsDateInput');
const earningsLoadButton = document.getElementById('earningsLoadButton');
const earningsShowMandatesButton = document.getElementById('earningsShowMandatesButton');
const earningsStatsGrid = document.getElementById('earningsStatsGrid');
const earningsMandatesPanel = document.getElementById('earningsMandatesPanel');
const earningsMandatesList = document.getElementById('earningsMandatesList');
const earningsMandatesCount = document.getElementById('earningsMandatesCount');
const punishmentForm = document.getElementById('punishmentForm');
const punishmentTargetSelect = document.getElementById('punishmentTargetSelect');
const punishmentTypeSelect = document.getElementById('punishmentTypeSelect');
const punishmentAmountGroup = document.getElementById('punishmentAmountGroup');
const punishmentAmountInput = document.getElementById('punishmentAmountInput');
const punishmentPointsGroup = document.getElementById('punishmentPointsGroup');
const punishmentPointsInput = document.getElementById('punishmentPointsInput');
const punishmentDurationGroup = document.getElementById('punishmentDurationGroup');
const punishmentDurationInput = document.getElementById('punishmentDurationInput');
const punishmentDescriptionGroup = document.getElementById('punishmentDescriptionGroup');
const punishmentDescriptionInput = document.getElementById('punishmentDescriptionInput');
const punishmentReasonInput = document.getElementById('punishmentReasonInput');
const punishmentError = document.getElementById('punishmentError');
const activityActorSelect = document.getElementById('activityActorSelect');
const activityLogsLoadButton = document.getElementById('activityLogsLoadButton');
const activityLogsCount = document.getElementById('activityLogsCount');
const activityLogsList = document.getElementById('activityLogsList');
const mandateCaseModal = document.getElementById('mandateCaseModal');
const mandateCaseBackdrop = document.getElementById('mandateCaseBackdrop');
const closeMandateCaseButton = document.getElementById('closeMandateCaseButton');
const mandateCaseList = document.getElementById('mandateCaseList');

const statCardTemplate = document.getElementById('statCardTemplate');
const listCardTemplate = document.getElementById('listCardTemplate');
const kartotekaTemplate = document.getElementById('kartotekaTemplate');
const userCardTemplate = document.getElementById('userCardTemplate');
const PERMISSION_LABELS = {
  viewKartoteka: 'Widok kartoteki',
  editKartoteka: 'Edycja kartoteki',
  viewMandaty: 'Widok mandatow',
  editMandaty: 'Edycja mandatow',
  deleteMandaty: 'Usuwanie mandatow',
  viewAreszty: 'Widok aresztow',
  editAreszty: 'Edycja aresztow',
  deleteAreszty: 'Usuwanie aresztow',
  viewZarobek: 'Widok zarobku'
};

function getHeaders() {
  const headers = { 'Content-Type': 'application/json' };
  if (state.sessionToken) headers.Authorization = `Bearer ${state.sessionToken}`;
  return headers;
}

function setLiveStatus(label, connected) {
  liveStatusLabel.textContent = label;
  liveDot.classList.toggle('connected', connected);
}

function setAuthMode(mode) {
  state.authMode = mode;
  ownerModeButton.classList.toggle('active', mode === 'owner');
  userModeButton.classList.toggle('active', mode === 'user');
  ownerAuthFields.classList.toggle('hidden', mode !== 'owner');
  userAuthFields.classList.toggle('hidden', mode !== 'user');
  ownerLoginButton.classList.toggle('hidden', mode !== 'owner');
  authError.textContent = '';
}

function persistSession(token, role, username, permissions = null, displayName = '', accountType = '', discordUserId = '') {
  state.sessionToken = token;
  state.sessionRole = role;
  state.sessionUsername = username;
  state.sessionDisplayName = displayName;
  state.sessionAccountType = accountType;
  state.sessionDiscordUserId = discordUserId;
  state.sessionPermissions = permissions;
  localStorage.setItem('panelSessionToken', token);
  localStorage.setItem('panelSessionRole', role);
  localStorage.setItem('panelSessionUsername', username);
  localStorage.setItem('panelSessionDisplayName', displayName || '');
  localStorage.setItem('panelSessionAccountType', accountType || '');
  localStorage.setItem('panelSessionDiscordUserId', discordUserId || '');
  localStorage.setItem('panelSessionPermissions', JSON.stringify(permissions));
}

function clearSession() {
  state.sessionToken = '';
  state.sessionRole = '';
  state.sessionUsername = '';
  state.sessionDisplayName = '';
  state.sessionAccountType = '';
  state.sessionDiscordUserId = '';
  state.sessionPermissions = null;
  state.activityLogs = [];
  state.activityActor = 'all';
  state.mandateCaseSignature = '';
  state.dismissedMandateCaseSignature = '';
  mandateCaseModal?.classList.add('hidden');
  localStorage.removeItem('panelSessionToken');
  localStorage.removeItem('panelSessionRole');
  localStorage.removeItem('panelSessionUsername');
  localStorage.removeItem('panelSessionDisplayName');
  localStorage.removeItem('panelSessionAccountType');
  localStorage.removeItem('panelSessionDiscordUserId');
  localStorage.removeItem('panelSessionPermissions');
}

function updateRoleView() {
  const isOwner = state.sessionRole === 'owner';
  for (const element of ownerOnlyElements) {
    element.classList.toggle('hidden', !isOwner);
  }

  if (state.sessionRole === 'user' && state.sessionAccountType === 'uzytkownik') {
    const categoryPermissions = {
      kartoteki: false,
      mandaty: true,
      areszty: true,
      zarobek: false,
      'nadaj-kare': false,
      'dziennik-zdarzen': false,
      'generowanie-loginow': false,
      uzytkownicy: false,
      permisje: false
    };

    for (const button of categoryButtons) {
      const allowed = categoryPermissions[button.dataset.category] ?? false;
      button.classList.toggle('hidden', !allowed);
    }

    if (!categoryPermissions[state.currentCategory]) {
      state.currentCategory = 'mandaty';
    }

    earningsShowMandatesButton.classList.add('hidden');
    return;
  }

  const permissions = state.sessionPermissions || {};
  const categoryPermissions = {
    kartoteki: isOwner || permissions.viewKartoteka || permissions.editKartoteka,
    mandaty: isOwner || permissions.viewMandaty || permissions.editMandaty || permissions.deleteMandaty,
    areszty: isOwner || permissions.viewAreszty || permissions.editAreszty || permissions.deleteAreszty,
    zarobek: isOwner || permissions.viewZarobek,
    'nadaj-kare': state.sessionAccountType === 'policjant',
    'dziennik-zdarzen': isOwner,
    uzytkownicy: isOwner,
    'generowanie-loginow': false,
    permisje: false
  };

  for (const button of categoryButtons) {
    const allowed = categoryPermissions[button.dataset.category] ?? isOwner;
    button.classList.toggle('hidden', !allowed);
  }

  if (!categoryPermissions[state.currentCategory]) {
    state.currentCategory = Object.keys(categoryPermissions).find(key => categoryPermissions[key]) || 'kartoteki';
  }

  earningsShowMandatesButton.classList.toggle('hidden', !hasPanelPermission('viewMandaty'));

}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      ...getHeaders(),
      ...(options.headers || {})
    }
  });

  if (response.status === 401) {
    clearSession();
    authOverlay.classList.remove('hidden');
    throw new Error('Brak dostepu do panelu.');
  }

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.error || 'Nie udalo sie wykonac operacji.');
  }

  return data;
}

function formatCurrency(value) {
  return new Intl.NumberFormat('pl-PL', {
    style: 'currency',
    currency: 'PLN',
    maximumFractionDigits: 0
  }).format(value || 0);
}

function createTag(text) {
  const tag = document.createElement('span');
  tag.className = 'tag-pill';
  tag.textContent = text;
  return tag;
}

function hasPanelPermission(permissionKey) {
  if (state.sessionRole === 'owner') return true;
  return Boolean(state.sessionPermissions?.[permissionKey]);
}

function setCategory(category) {
  state.currentCategory = category;
  for (const button of categoryButtons) {
    button.classList.toggle('active', button.dataset.category === category);
  }
  for (const section of categorySections) {
    section.classList.toggle('hidden', section.dataset.section !== category);
  }
}

function playSignal(type = 'soft') {
  if (!window.AudioContext && !window.webkitAudioContext) return;
  const Context = window.AudioContext || window.webkitAudioContext;
  const context = new Context();
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = type === 'alert' ? 'triangle' : 'sine';
  oscillator.frequency.value = type === 'alert' ? 740 : 520;
  gain.gain.value = 0.0001;

  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start();

  const now = context.currentTime;
  gain.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
  oscillator.stop(now + 0.38);
}

function openEditor(config) {
  editorError.textContent = '';
  editorEyebrow.textContent = config.eyebrow;
  editorTitle.textContent = config.title;
  editorForm.innerHTML = '';

  for (const field of config.fields) {
    const wrapper = document.createElement('div');
    wrapper.className = 'form-group';

    const label = document.createElement('label');
    label.textContent = field.label;
    label.htmlFor = field.name;
    wrapper.appendChild(label);

    let input;
    if (field.type === 'textarea') {
      input = document.createElement('textarea');
      input.value = field.value ?? '';
    } else if (field.type === 'select') {
      input = document.createElement('select');
      for (const option of field.options) {
        const optionNode = document.createElement('option');
        optionNode.value = option.value;
        optionNode.textContent = option.label;
        if (field.value === option.value) optionNode.selected = true;
        input.appendChild(optionNode);
      }
    } else {
      input = document.createElement('input');
      input.type = field.type || 'text';
      input.value = field.value ?? '';
      if (field.placeholder) input.placeholder = field.placeholder;
    }

    input.id = field.name;
    input.name = field.name;
    wrapper.appendChild(input);
    editorForm.appendChild(wrapper);
  }

  const actions = document.createElement('div');
  actions.className = 'form-actions';

  const saveButton = document.createElement('button');
  saveButton.className = 'primary-button';
  saveButton.type = 'submit';
  saveButton.textContent = 'Zapisz zmiany';

  const cancelButton = document.createElement('button');
  cancelButton.className = 'ghost-button';
  cancelButton.type = 'button';
  cancelButton.textContent = 'Anuluj';
  cancelButton.addEventListener('click', closeEditor);

  actions.append(saveButton, cancelButton);
  editorForm.appendChild(actions);

  editorForm.onsubmit = async event => {
    event.preventDefault();
    editorError.textContent = '';

    const payload = Object.fromEntries(new FormData(editorForm).entries());
    try {
      await config.onSubmit(payload);
      closeEditor();
      await fetchDashboard({ manual: false });
      if (state.sessionRole === 'owner') await loadPanelUsers();
      playSignal('soft');
    } catch (error) {
      editorError.textContent = error.message;
    }
  };

  editorModal.classList.remove('hidden');
}

function closeEditor() {
  editorModal.classList.add('hidden');
  editorForm.onsubmit = null;
}

function getRelevantMandateCases() {
  if (!state.snapshot || !state.sessionDiscordUserId) return [];
  return state.snapshot.mandates.filter(mandate =>
    mandate.status !== 'zamkniety' &&
    (mandate.targetId === state.sessionDiscordUserId || mandate.issuerId === state.sessionDiscordUserId)
  );
}

function getMandateCaseSignature(cases = []) {
  return cases
    .map(mandate => `${mandate.id}:${mandate.status}`)
    .join('|');
}

function isMandateCaseTarget(mandate) {
  return mandate.targetId === state.sessionDiscordUserId;
}

function isMandateCaseIssuer(mandate) {
  return mandate.issuerId === state.sessionDiscordUserId;
}

function createMandateCaseActionButton(label, variant = 'ghost-button', onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = variant;
  button.textContent = label;
  button.addEventListener('click', onClick);
  return button;
}

async function performMandateCaseAction(mandateId, action) {
  const result = await api(`/api/dashboard/${state.guildId}/mandates/${mandateId}/action`, {
    method: 'POST',
    body: JSON.stringify({ action })
  });
  await fetchDashboard({ manual: false });
  if (result?.message) {
    playSignal(action === 'odrzuc' ? 'alert' : 'soft');
  }
}

function openMandateCaseModal() {
  mandateCaseModal.classList.remove('hidden');
}

function closeMandateCaseModal(persistDismiss = true) {
  mandateCaseModal.classList.add('hidden');
  if (persistDismiss) {
    state.dismissedMandateCaseSignature = state.mandateCaseSignature;
  }
}

function renderMandateCaseModal() {
  if (!mandateCaseList) return;
  const cases = getRelevantMandateCases();
  mandateCaseList.innerHTML = '';

  if (cases.length === 0) {
    closeMandateCaseModal(false);
    return;
  }

  for (const mandate of cases) {
    const node = listCardTemplate.content.firstElementChild.cloneNode(true);
    const isIssuer = isMandateCaseIssuer(mandate);
    const isTarget = isMandateCaseTarget(mandate);

    node.querySelector('.list-title').textContent = `${mandate.id} | ${mandate.targetLabel}`;
    node.querySelector('.status-badge').textContent = mandate.statusLabel;
    node.querySelector('.list-meta').textContent = `Wystawil ${mandate.issuerLabel} | ${mandate.createdAtLabel}`;
    const descriptionNode = node.querySelector('.list-description');
    descriptionNode.textContent = mandate.reason;

    const instruction = document.createElement('p');
    instruction.className = 'list-description';
    instruction.textContent = mandate.status === 'oczekiwanie-na-zaplate'
      ? 'Wejdz na serwer Fordon RP i przelej kase w ekonomii do 01 | Polish Potato. Po przelewie osoba, ktora wystawila mandat, potwierdzi oplacenie.'
      : mandate.status === 'odrzucony-oczekuje-platnosci'
        ? 'Mandat jest odrzucony, ale nadal mozesz kliknac ZAPLAC i zmienic decyzje.'
        : mandate.status === 'zaplacony'
          ? 'Mandat jest juz oznaczony jako oplacony.'
          : 'Mozesz podjac decyzje tak samo jak na Discordzie.';
    descriptionNode.after(instruction);

    const tags = node.querySelector('.list-tags');
    tags.append(
      createTag(`Kwota: ${mandate.amount} PLN`),
      createTag(`Punkty: ${mandate.penaltyPoints ?? 'brak'}`)
    );
    if (mandate.description?.trim()) {
      tags.append(createTag(`Opis: ${mandate.description.trim()}`));
    }

    const actions = node.querySelector('.card-actions');
    actions.className = 'mandate-case-actions';
    actions.innerHTML = '';

    if (isTarget) {
      const payButton = createMandateCaseActionButton('ZAPLAC', 'primary-button', async () => {
        try {
          await performMandateCaseAction(mandate.id, 'zaplac');
        } catch (error) {
          window.alert(error.message);
        }
      });
      const rejectButton = createMandateCaseActionButton('ODRZUC', 'ghost-button danger-button', async () => {
        try {
          await performMandateCaseAction(mandate.id, 'odrzuc');
        } catch (error) {
          window.alert(error.message);
        }
      });

      payButton.disabled = mandate.status === 'oczekiwanie-na-zaplate' || mandate.status === 'zaplacony' || mandate.status === 'zamkniety';
      rejectButton.disabled = mandate.status === 'odrzucony-oczekuje-platnosci' || mandate.status === 'oczekiwanie-na-zaplate' || mandate.status === 'zaplacony' || mandate.status === 'zamkniety';
      actions.append(payButton, rejectButton);
    }

    if (isIssuer) {
      const paidButton = createMandateCaseActionButton('OPLACONO', 'ghost-button', async () => {
        try {
          await performMandateCaseAction(mandate.id, 'oplacono');
        } catch (error) {
          window.alert(error.message);
        }
      });
      const closeButton = createMandateCaseActionButton('ZAMKNIJ SPRAWE', 'ghost-button', async () => {
        try {
          await performMandateCaseAction(mandate.id, 'zamknij');
        } catch (error) {
          window.alert(error.message);
        }
      });

      paidButton.disabled = mandate.status !== 'oczekiwanie-na-zaplate';
      closeButton.disabled = mandate.status === 'zamkniety';
      actions.append(paidButton, closeButton);
    }

    if (!actions.children.length) {
      actions.remove();
    }

    mandateCaseList.appendChild(node);
  }
}

function syncMandateCaseModal() {
  const cases = getRelevantMandateCases();
  const signature = getMandateCaseSignature(cases);
  state.mandateCaseSignature = signature;
  renderMandateCaseModal();

  if (!signature) {
    state.dismissedMandateCaseSignature = '';
    return;
  }

  if (signature !== state.dismissedMandateCaseSignature) {
    openMandateCaseModal();
  }
}

async function deleteMandate(mandateId) {
  if (!window.confirm(`Czy na pewno chcesz usunac mandat ${mandateId}?`)) return;
  await api(`/api/dashboard/${state.guildId}/mandates/${mandateId}`, { method: 'DELETE' });
  await fetchDashboard({ manual: false });
  playSignal('alert');
}

async function deleteArrest(arrestId) {
  if (!window.confirm(`Czy na pewno chcesz usunac areszt ${arrestId}?`)) return;
  await api(`/api/dashboard/${state.guildId}/arrests/${arrestId}`, { method: 'DELETE' });
  await fetchDashboard({ manual: false });
  playSignal('alert');
}

async function deletePanelUser(userId) {
  if (!window.confirm('Czy na pewno chcesz usunac to konto?')) return;
  const result = await api(`/api/panel/users/${userId}`, { method: 'DELETE' });
  state.panelUsers = result.users || [];
  renderPanelUsers();
}

function openMandateEditor(mandate) {
  openEditor({
    eyebrow: 'Edycja mandatu',
    title: mandate.id,
    fields: [
      { name: 'reason', label: 'Powod mandatu', type: 'textarea', value: mandate.reason },
      { name: 'description', label: 'Opis', type: 'textarea', value: mandate.description ?? '' },
      { name: 'penaltyPoints', label: 'Punkty karne', type: 'number', value: mandate.penaltyPoints ?? '' },
      {
        name: 'status',
        label: 'Status',
        type: 'select',
        value: mandate.status,
        options: [
          { value: 'oczekuje-na-decyzje', label: 'Oczekuje na decyzje' },
          { value: 'odrzucony-oczekuje-platnosci', label: 'Odrzucony, ale nadal mozna zaplacic' },
          { value: 'oczekiwanie-na-zaplate', label: 'Oczekiwanie na zaplate' },
          { value: 'zaplacony', label: 'Mandat oplacony' },
          { value: 'zamkniety', label: 'Zamkniety' }
        ]
      }
    ],
    onSubmit: payload => api(`/api/dashboard/${state.guildId}/mandates/${mandate.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    })
  });
}

function openArrestEditor(arrest) {
  openEditor({
    eyebrow: 'Edycja aresztu',
    title: arrest.id,
    fields: [
      { name: 'reason', label: 'Powod aresztu', type: 'textarea', value: arrest.reason },
      {
        name: 'kind',
        label: 'Rodzaj',
        type: 'select',
        value: arrest.kind,
        options: [
          { value: 'areszt', label: 'Areszt' },
          { value: 'wiezienie', label: 'Pojscie do wiezienia' }
        ]
      },
      { name: 'duration', label: 'Czas', type: 'text', value: arrest.duration ?? '', placeholder: 'Np. 30 minut albo 2 dni' }
    ],
    onSubmit: payload => api(`/api/dashboard/${state.guildId}/arrests/${arrest.id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload)
    })
  });
}

function renderEarningsStats() {
  earningsStatsGrid.innerHTML = '';

  if (!state.earnings.stats) {
    earningsStatsGrid.innerHTML = '<p class="muted">Wybierz osobe i kliknij Pokaz, aby zobaczyc statystyki.</p>';
    return;
  }

  const cards = [
    ['Wszystkie mandaty', state.earnings.stats.mandateCount],
    ['Mandaty oplacone', state.earnings.stats.paidMandateCount],
    ['Mandaty oczekujace', state.earnings.stats.pendingMandateCount],
    ['Laczny wplyw z mandatow', formatCurrency(state.earnings.stats.mandateRevenue)],
    ['Wszystkie areszty', state.earnings.stats.arrestCount]
  ];

  for (const [label, value] of cards) {
    const node = statCardTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.stat-label').textContent = label;
    node.querySelector('.stat-value').textContent = String(value);
    earningsStatsGrid.appendChild(node);
  }
}

function getFilteredOfficerMandates() {
  if (!state.snapshot || !state.earnings.selectedUserId) return [];
  return state.snapshot.mandates.filter(mandate => {
    if (mandate.issuerId !== state.earnings.selectedUserId) return false;
    if (state.earnings.scope !== 'date') return true;
    if (!state.earnings.date) return false;
    return new Date(mandate.createdAt).toISOString().slice(0, 10) === state.earnings.date;
  });
}

function renderMandateCard(mandate) {
  const node = listCardTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector('.list-title').textContent = `${mandate.id} | ${mandate.targetLabel}`;
  node.querySelector('.status-badge').textContent = mandate.statusLabel;
  node.querySelector('.list-meta').textContent = `Wystawil ${mandate.issuerLabel} | ${mandate.createdAtLabel}`;
  node.querySelector('.list-description').textContent = mandate.reason;

  const tags = node.querySelector('.list-tags');
  tags.append(
    createTag(`Kwota: ${mandate.amount} PLN`),
    createTag(`Punkty: ${mandate.penaltyPoints ?? 'brak'}`)
  );
  if (mandate.description?.trim()) {
    tags.append(createTag(`Opis: ${mandate.description.trim()}`));
  }

  const actions = node.querySelector('.card-actions');
  const editButton = node.querySelector('.action-edit');
  const deleteButton = node.querySelector('.action-delete');

  if (hasPanelPermission('editMandaty')) {
    editButton.addEventListener('click', () => openMandateEditor(mandate));
  } else {
    editButton.remove();
  }

  if (hasPanelPermission('deleteMandaty')) {
    deleteButton.addEventListener('click', () => {
      deleteMandate(mandate.id).catch(error => window.alert(error.message));
    });
  } else {
    deleteButton.remove();
  }

  if (!actions.children.length) {
    actions.remove();
  }

  return node;
}

function renderEarningsMandates() {
  earningsMandatesList.innerHTML = '';

  if (!state.earnings.showMandates) {
    earningsMandatesPanel.classList.add('hidden');
    return;
  }

  earningsMandatesPanel.classList.remove('hidden');
  const mandates = getFilteredOfficerMandates();
  earningsMandatesCount.textContent = String(mandates.length);

  if (mandates.length === 0) {
    earningsMandatesList.innerHTML = '<p class="muted">Brak mandatow dla tej osoby w wybranym zakresie.</p>';
    return;
  }

  for (const mandate of mandates) {
    earningsMandatesList.appendChild(renderMandateCard(mandate));
  }
}

async function loadEarningsCandidates() {
  const result = await api(`/api/dashboard/${state.guildId}/earnings/candidates`);
  state.earnings.candidates = result.candidates || [];
  earningsOfficerSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = state.earnings.candidates.length ? 'Wybierz osobe' : 'Brak osob z tej roli';
  earningsOfficerSelect.appendChild(placeholder);

  for (const person of state.earnings.candidates) {
    const option = document.createElement('option');
    option.value = person.id;
    option.textContent = person.label;
    earningsOfficerSelect.appendChild(option);
  }

  if (state.earnings.selectedUserId && state.earnings.candidates.some(person => person.id === state.earnings.selectedUserId)) {
    earningsOfficerSelect.value = state.earnings.selectedUserId;
  }
}

async function loadPunishmentCandidates() {
  if (state.sessionAccountType !== 'policjant') return;
  const result = await api(`/api/dashboard/${state.guildId}/punishment-candidates`);
  state.punishmentCandidates = result.candidates || [];
  punishmentTargetSelect.innerHTML = '';

  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = state.punishmentCandidates.length ? 'Wybierz uzytkownika' : 'Brak dostepnych osob';
  punishmentTargetSelect.appendChild(placeholder);

  for (const person of state.punishmentCandidates) {
    const option = document.createElement('option');
    option.value = person.id;
    option.textContent = person.label;
    punishmentTargetSelect.appendChild(option);
  }
}

function updatePunishmentFormVisibility() {
  const selectedType = punishmentTypeSelect?.value || 'mandat';
  const isMandate = selectedType === 'mandat';
  const isPrison = selectedType === 'wiezienie';

  punishmentAmountGroup?.classList.toggle('hidden', !isMandate);
  punishmentPointsGroup?.classList.toggle('hidden', !isMandate);
  punishmentDescriptionGroup?.classList.toggle('hidden', !isMandate);
  punishmentDurationGroup?.classList.toggle('hidden', isMandate);

  if (isMandate) {
    punishmentAmountInput?.setAttribute('required', 'required');
  } else {
    punishmentAmountInput?.removeAttribute('required');
    punishmentAmountInput.value = '';
    punishmentPointsInput.value = '';
    punishmentDescriptionInput.value = '';
  }

  if (isPrison) {
    punishmentDurationInput?.setAttribute('required', 'required');
  } else {
    punishmentDurationInput?.removeAttribute('required');
    if (selectedType === 'areszt') {
      punishmentDurationInput.value = '';
    }
  }
}

async function fetchEarningsSummary() {
  const userId = earningsOfficerSelect.value;
  const scope = earningsScopeSelect.value;
  const date = earningsDateInput.value;

  if (!userId) {
    window.alert('Najpierw wybierz osobe.');
    return;
  }
  if (scope === 'date' && !date) {
    window.alert('Wybierz date dla statystyk dziennych.');
    return;
  }

  state.earnings.selectedUserId = userId;
  state.earnings.scope = scope;
  state.earnings.date = date;

  const params = new URLSearchParams({ userId, scope });
  if (scope === 'date') params.set('date', date);

  const result = await api(`/api/dashboard/${state.guildId}/earnings/summary?${params.toString()}`);
  state.earnings.stats = result.stats;
  renderEarningsStats();
  renderEarningsMandates();
}

async function loadPanelUsers() {
  if (state.sessionRole !== 'owner') return;
  const result = await api('/api/panel/users');
  state.panelUsers = result.users || [];
  renderPanelUsers();
  renderActivityActorOptions();
}

function renderActivityActorOptions(extraUsers = null) {
  if (!activityActorSelect) return;
  const users = extraUsers || [
    { value: 'all', label: 'Wszyscy' },
    { value: 'wlasciciel', label: 'Wlasciciel' },
    ...state.panelUsers.map(user => ({ value: user.username, label: user.displayName || user.username }))
  ];

  activityActorSelect.innerHTML = '';
  for (const user of users) {
    const option = document.createElement('option');
    option.value = user.value;
    option.textContent = user.label;
    activityActorSelect.appendChild(option);
  }

  activityActorSelect.value = users.some(user => user.value === state.activityActor) ? state.activityActor : 'all';
}

function renderActivityLogs() {
  if (!activityLogsList || !activityLogsCount) return;
  activityLogsList.innerHTML = '';
  activityLogsCount.textContent = String(state.activityLogs.length);

  if (state.activityLogs.length === 0) {
    activityLogsList.innerHTML = '<p class="muted">Brak zdarzen dla wybranego filtra.</p>';
    return;
  }

  for (const log of state.activityLogs) {
    const node = listCardTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.list-title').textContent = `${log.actorLabel} | ${log.action}`;
    node.querySelector('.status-badge').textContent = log.actorRole === 'owner' ? 'Wlasciciel' : 'Uzytkownik';
    node.querySelector('.list-meta').textContent = `${log.createdAtLabel}`;
    node.querySelector('.list-description').textContent = log.details;
    const tags = node.querySelector('.list-tags');
    tags.appendChild(createTag(`Data: ${log.createdAtLabel}`));
    node.querySelector('.card-actions')?.remove();
    activityLogsList.appendChild(node);
  }
}

async function loadActivityLogs() {
  if (state.sessionRole !== 'owner') return;
  const params = new URLSearchParams({ actor: state.activityActor || 'all' });
  const result = await api(`/api/panel/activity-logs?${params.toString()}`);
  state.activityLogs = result.logs || [];
  renderActivityActorOptions(result.users || null);
  renderActivityLogs();
}

function renderPanelUsers() {
  usersList.innerHTML = '';
  usersCount.textContent = String(state.panelUsers.length);

  if (state.panelUsers.length === 0) {
    usersList.innerHTML = '<p class="muted">Nie ma jeszcze zadnych kont.</p>';
    return;
  }

  for (const user of state.panelUsers) {
    const node = userCardTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.list-title').textContent = user.displayName || user.username;
    node.querySelector('.list-meta').textContent = `Typ: ${user.accountType === 'policjant' ? 'Policjant' : 'Uzytkownik'} | Utworzono ${new Date(user.createdAt).toLocaleString('pl-PL')}`;
    node.querySelector('.user-type-badge').textContent = user.accountType === 'policjant' ? 'Policjant' : 'Uzytkownik';
    const tags = node.querySelector('.list-tags');
    tags.appendChild(createTag(`Login Discord: ${user.displayName || user.username}`));
    if (user.accountType === 'policjant') {
      const activePermissions = Object.entries(user.permissions || {})
        .filter(([, value]) => value)
        .map(([key]) => PERMISSION_LABELS[key] || key);
      if (activePermissions.length === 0) {
        tags.appendChild(createTag('Brak permisji'));
      } else {
        for (const permission of activePermissions) {
          tags.appendChild(createTag(permission));
        }
      }

      node.querySelector('.action-user-permissions').addEventListener('click', () => {
        openPermissionsEditor(user);
      });
    } else {
      const permissionButton = node.querySelector('.action-user-permissions');
      permissionButton.textContent = 'Permisje zablokowane';
      permissionButton.disabled = true;
      tags.appendChild(createTag('Widok tylko swoich mandatow'));
    }

    node.querySelector('.action-user-delete').addEventListener('click', () => {
      deletePanelUser(user.id).catch(error => window.alert(error.message));
    });
    usersList.appendChild(node);
  }
}

function openPermissionsEditor(user) {
  if (user.accountType !== 'policjant') {
    window.alert('Permisje mozna edytowac tylko dla policjantow.');
    return;
  }
  const permissions = user.permissions || {};
  const boolOptions = [
    { value: 'true', label: 'Tak' },
    { value: 'false', label: 'Nie' }
  ];

  openEditor({
    eyebrow: 'Permisje panelu',
    title: user.username,
    fields: [
      { name: 'viewKartoteka', label: 'Widok kartoteki', type: 'select', value: String(Boolean(permissions.viewKartoteka)), options: boolOptions },
      { name: 'editKartoteka', label: 'Edycja kartoteki', type: 'select', value: String(Boolean(permissions.editKartoteka)), options: boolOptions },
      { name: 'viewMandaty', label: 'Widok mandatow', type: 'select', value: String(Boolean(permissions.viewMandaty)), options: boolOptions },
      { name: 'editMandaty', label: 'Edycja mandatow', type: 'select', value: String(Boolean(permissions.editMandaty)), options: boolOptions },
      { name: 'deleteMandaty', label: 'Usuwanie mandatow', type: 'select', value: String(Boolean(permissions.deleteMandaty)), options: boolOptions },
      { name: 'viewAreszty', label: 'Widok aresztow', type: 'select', value: String(Boolean(permissions.viewAreszty)), options: boolOptions },
      { name: 'editAreszty', label: 'Edycja aresztow', type: 'select', value: String(Boolean(permissions.editAreszty)), options: boolOptions },
      { name: 'deleteAreszty', label: 'Usuwanie aresztow', type: 'select', value: String(Boolean(permissions.deleteAreszty)), options: boolOptions },
      { name: 'viewZarobek', label: 'Widok zarobku', type: 'select', value: String(Boolean(permissions.viewZarobek)), options: boolOptions }
    ],
    onSubmit: async payload => {
      const permissionsPayload = Object.fromEntries(
        Object.entries(payload).map(([key, value]) => [key, value === 'true'])
      );
      const result = await api(`/api/panel/users/${user.id}/permissions`, {
        method: 'PATCH',
        body: JSON.stringify({ permissions: permissionsPayload })
      });
      state.panelUsers = result.users || [];
      renderPanelUsers();
    }
  });
}

function renderArrestCard(arrest) {
  const node = listCardTemplate.content.firstElementChild.cloneNode(true);
  node.querySelector('.list-title').textContent = `${arrest.id} | ${arrest.targetLabel}`;
  node.querySelector('.status-badge').textContent = arrest.kindLabel;
  node.querySelector('.list-meta').textContent = `Nadal ${arrest.issuerLabel} | ${arrest.createdAtLabel}`;
  node.querySelector('.list-description').textContent = arrest.reason;

  const tags = node.querySelector('.list-tags');
  if (arrest.duration) {
    tags.appendChild(createTag(`Czas: ${arrest.duration}`));
  }

  const actions = node.querySelector('.card-actions');
  const editButton = node.querySelector('.action-edit');
  const deleteButton = node.querySelector('.action-delete');

  if (hasPanelPermission('editAreszty')) {
    editButton.addEventListener('click', () => openArrestEditor(arrest));
  } else {
    editButton.remove();
  }

  if (hasPanelPermission('deleteAreszty')) {
    deleteButton.addEventListener('click', () => {
      deleteArrest(arrest.id).catch(error => window.alert(error.message));
    });
  } else {
    deleteButton.remove();
  }

  if (!actions.children.length) {
    actions.remove();
  }

  return node;
}

function renderMandates(snapshot) {
  mandatesList.innerHTML = '';
  mandatesCount.textContent = String(snapshot.mandates.length);

  if (snapshot.mandates.length === 0) {
    mandatesList.innerHTML = '<p class="muted">Brak mandatow do pokazania.</p>';
    return;
  }

  for (const mandate of snapshot.mandates) {
    mandatesList.appendChild(renderMandateCard(mandate));
  }
}

function renderArrests(snapshot) {
  arrestsList.innerHTML = '';
  arrestsCount.textContent = String(snapshot.arrests.length);

  if (snapshot.arrests.length === 0) {
    arrestsList.innerHTML = '<p class="muted">Brak aresztow do pokazania.</p>';
    return;
  }

  for (const arrest of snapshot.arrests) {
    arrestsList.appendChild(renderArrestCard(arrest));
  }
}

function renderKartoteki(snapshot) {
  kartotekiGrid.innerHTML = '';
  kartotekiCount.textContent = String(snapshot.kartoteki.length);

  if (snapshot.kartoteki.length === 0) {
    kartotekiGrid.innerHTML = '<p class="muted">Brak kartotek do pokazania.</p>';
    return;
  }

  for (const kartoteka of snapshot.kartoteki) {
    const node = kartotekaTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.list-title').textContent = kartoteka.displayName || kartoteka.username;
    node.querySelector('.status-badge').textContent = `ID ${kartoteka.userId}`;
    node.querySelector('.list-meta').textContent = `Zalozono ${kartoteka.createdAtLabel}`;
    node.querySelector('.kartoteka-note').textContent = kartoteka.note || 'Brak dodatkowego opisu kartoteki.';

    const stats = node.querySelector('.kartoteka-stats');
    stats.append(
      createTag(`Mandaty: ${kartoteka.stats.mandateCount}`),
      createTag(`Oplacone: ${kartoteka.stats.paidMandateCount}`),
      createTag(`Punkty: ${kartoteka.stats.penaltyPointsTotal}`),
      createTag(`Areszty: ${kartoteka.stats.arrestCount}`)
    );

    const history = node.querySelector('.kartoteka-history');
    const latest = kartoteka.entries.slice(0, 6);
    if (latest.length === 0) {
      history.innerHTML = '<p class="muted">Brak wpisow.</p>';
    } else {
      for (const entry of latest) {
        const wrapper = document.createElement('div');
        wrapper.className = 'history-item';

        const title = document.createElement('p');
        title.className = 'history-item-title';
        title.textContent = entry.type === 'mandat'
          ? `${entry.mandateId} | ${entry.statusLabel}`
          : `${entry.arrestId} | ${entry.kindLabel}`;

        const copy = document.createElement('p');
        copy.className = 'history-item-copy';
        copy.textContent = entry.type === 'mandat'
          ? `${entry.reason}${entry.description?.trim() ? ` | ${entry.description.trim()}` : ''} | ${entry.amount} PLN | ${entry.penaltyPoints ?? 0} pkt`
          : `${entry.reason}${entry.duration ? ` | ${entry.duration}` : ''}`;

        const actions = document.createElement('div');
        actions.className = 'history-item-actions';

        const editButton = document.createElement('button');
        editButton.className = 'ghost-button';
        editButton.type = 'button';
        editButton.textContent = 'Edytuj';

        const deleteButton = document.createElement('button');
        deleteButton.className = 'ghost-button danger-button';
        deleteButton.type = 'button';
        deleteButton.textContent = 'Usun';

        if (entry.type === 'mandat') {
          const mandate = snapshot.mandates.find(item => item.id === entry.mandateId);
          let allowEdit = false;
          let allowDelete = false;
          if (hasPanelPermission('editMandaty')) {
            allowEdit = true;
            editButton.addEventListener('click', () => {
              if (!mandate) return;
              openMandateEditor(mandate);
            });
          }

          if (hasPanelPermission('deleteMandaty')) {
            allowDelete = true;
            deleteButton.addEventListener('click', () => {
              deleteMandate(entry.mandateId).catch(error => window.alert(error.message));
            });
          }

          if (allowEdit) actions.appendChild(editButton);
          if (allowDelete) actions.appendChild(deleteButton);
        } else {
          const arrest = snapshot.arrests.find(item => item.id === entry.arrestId);
          let allowEdit = false;
          let allowDelete = false;
          if (hasPanelPermission('editAreszty')) {
            allowEdit = true;
            editButton.addEventListener('click', () => {
              if (!arrest) return;
              openArrestEditor(arrest);
            });
          }

          if (hasPanelPermission('deleteAreszty')) {
            allowDelete = true;
            deleteButton.addEventListener('click', () => {
              deleteArrest(entry.arrestId).catch(error => window.alert(error.message));
            });
          }

          if (allowEdit) actions.appendChild(editButton);
          if (allowDelete) actions.appendChild(deleteButton);
        }

        wrapper.append(title, copy);
        if (actions.children.length) {
          wrapper.append(actions);
        }
        history.appendChild(wrapper);
      }
    }

    const noteButton = node.querySelector('.action-note-edit');
    if (hasPanelPermission('editKartoteka')) {
      noteButton.addEventListener('click', () => {
        openEditor({
          eyebrow: 'Edycja kartoteki',
          title: kartoteka.displayName || kartoteka.username,
          fields: [
            { name: 'note', label: 'Opis kartoteki', type: 'textarea', value: kartoteka.note ?? '' }
          ],
          onSubmit: payload => api(`/api/dashboard/${state.guildId}/kartoteki/${kartoteka.userId}`, {
            method: 'PATCH',
            body: JSON.stringify(payload)
          })
        });
      });
    } else {
      noteButton.remove();
    }

    kartotekiGrid.appendChild(node);
  }
}

function render(snapshot) {
  renderMandates(snapshot);
  renderArrests(snapshot);
  renderKartoteki(snapshot);
  renderEarningsStats();
  renderEarningsMandates();
  syncMandateCaseModal();
  updateRoleView();
  setCategory(state.currentCategory);
}

async function fetchDashboard({ manual = true } = {}) {
  if (!state.guildId) return;
  refreshButton.disabled = true;

  try {
    const previous = state.snapshot;
    const snapshot = await api(`/api/dashboard/${state.guildId}`);
    state.snapshot = snapshot;
    render(snapshot);

    if (previous) {
      const newMandates = snapshot.mandates.length > previous.mandates.length;
      const newArrests = snapshot.arrests.length > previous.arrests.length;
      if (newMandates || newArrests) {
        playSignal(newArrests ? 'alert' : 'soft');
      }
    }
  } finally {
    refreshButton.disabled = false;
    if (manual) {
      refreshButton.textContent = 'Odswiezono';
      window.setTimeout(() => {
        refreshButton.textContent = 'Odswiez';
      }, 900);
    }
  }
}

function connectRealtime() {
  if (state.socket) {
    state.socket.disconnect();
  }

  state.socket = io({
    auth: {
      token: state.sessionToken
    }
  });

  state.socket.on('connect', () => {
    setLiveStatus('Polaczono na zywo', true);
    state.socket.emit('dashboard:watch', state.guildId);
  });

  state.socket.on('disconnect', () => {
    setLiveStatus('Polaczenie przerwane', false);
  });

  state.socket.on('connect_error', error => {
    setLiveStatus('Brak autoryzacji lub polaczenia', false);
    clearSession();
    authError.textContent = error.message || 'Nie udalo sie polaczyc z panelem.';
    authOverlay.classList.remove('hidden');
  });

  state.socket.on('dashboard:update', async () => {
    await fetchDashboard({ manual: false });
    if (state.sessionAccountType === 'policjant') {
      await loadPunishmentCandidates();
    }
    if (state.sessionRole === 'owner') {
      await loadPanelUsers();
      await loadActivityLogs();
    }
  });

  state.socket.on('panel:force-logout', () => {
    clearSession();
    if (state.socket) state.socket.disconnect();
    authError.textContent = 'Twoja sesja zostala zakonczona. Zaloguj sie ponownie.';
    authOverlay.classList.remove('hidden');
  });
}

async function boot() {
  const meta = await fetch('/api/panel/meta').then(response => response.json());
  state.guildId = meta.guildId;
  state.authRequired = meta.authRequired;

  if (!state.sessionToken) {
    authOverlay.classList.remove('hidden');
    updateRoleView();
    return;
  }

  const session = await api('/api/panel/session');
  state.sessionRole = session.role;
  state.sessionUsername = session.username;
  state.sessionDisplayName = session.displayName || session.username || '';
  state.sessionAccountType = session.accountType || '';
  state.sessionDiscordUserId = session.discordUserId || '';
  state.sessionPermissions = session.permissions || null;
  localStorage.setItem('panelSessionDiscordUserId', state.sessionDiscordUserId);
  authOverlay.classList.add('hidden');
  updateRoleView();
  connectRealtime();
  if (state.sessionRole === 'owner' || state.sessionPermissions?.viewZarobek) {
    await loadEarningsCandidates();
  }
  if (state.sessionAccountType === 'policjant') {
    await loadPunishmentCandidates();
  }
  if (state.sessionRole === 'owner') {
    await loadPanelUsers();
    await loadActivityLogs();
  }
  await fetchDashboard({ manual: false });
}

authForm.addEventListener('submit', async event => {
  event.preventDefault();
  authError.textContent = '';

  try {
    if (state.authMode !== 'owner') {
      window.location.href = '/api/panel/discord/start';
      return;
    }

    const payload = { mode: 'owner', adminKey: authKeyInput.value.trim() };

    const result = await fetch('/api/panel/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(async response => {
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Nie udalo sie zalogowac.');
      return data;
    });

    persistSession(result.token, result.role, result.username, result.permissions || null, result.displayName || result.username, result.accountType || '');
    authKeyInput.value = '';
    await boot();
  } catch (error) {
    authError.textContent = error.message;
  }
});

ownerModeButton.addEventListener('click', () => setAuthMode('owner'));
userModeButton.addEventListener('click', () => setAuthMode('user'));
discordLoginButton?.addEventListener('click', () => {
  window.location.href = '/api/panel/discord/start';
});

for (const button of categoryButtons) {
  button.addEventListener('click', () => {
    if (button.classList.contains('hidden')) return;
    if (button.classList.contains('owner-only') && state.sessionRole !== 'owner') return;
    setCategory(button.dataset.category);
  });
}

earningsScopeSelect.addEventListener('change', () => {
  const isDate = earningsScopeSelect.value === 'date';
  earningsDateInput.disabled = !isDate;
});

earningsLoadButton.addEventListener('click', () => {
  fetchEarningsSummary().catch(error => window.alert(error.message));
});

earningsShowMandatesButton.addEventListener('click', async () => {
  if (!earningsOfficerSelect.value) {
    window.alert('Najpierw wybierz osobe.');
    return;
  }

  state.earnings.selectedUserId = earningsOfficerSelect.value;
  state.earnings.scope = earningsScopeSelect.value;
  state.earnings.date = earningsDateInput.value;
  state.earnings.showMandates = true;

  if (!state.earnings.stats) {
    await fetchEarningsSummary();
    return;
  }

  renderEarningsMandates();
});

punishmentTypeSelect?.addEventListener('change', updatePunishmentFormVisibility);

punishmentForm?.addEventListener('submit', async event => {
  event.preventDefault();
  punishmentError.textContent = '';

  try {
    const payload = Object.fromEntries(new FormData(punishmentForm).entries());
    const result = await api(`/api/dashboard/${state.guildId}/punishments`, {
      method: 'POST',
      body: JSON.stringify(payload)
    });

    punishmentForm.reset();
    updatePunishmentFormVisibility();
    await fetchDashboard({ manual: false });

    const message = result.type === 'mandat'
      ? `Nadano mandat ${result.id}. Utworzono prywatny kanal sprawy.`
      : `Nadano ${result.type === 'wiezienie' ? 'wiezienie' : 'areszt'} ${result.id}.`;
    punishmentError.textContent = message;
  } catch (error) {
    punishmentError.textContent = error.message;
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    if (state.sessionToken) {
      await api('/api/panel/logout', { method: 'POST' });
    }
  } catch {}
  clearSession();
  if (state.socket) state.socket.disconnect();
  state.snapshot = null;
  state.panelUsers = [];
  state.punishmentCandidates = [];
  updateRoleView();
  authOverlay.classList.remove('hidden');
  setAuthMode('owner');
});

refreshButton.addEventListener('click', async () => {
  try {
    await fetchDashboard({ manual: true });
    if (state.sessionAccountType === 'policjant') {
      await loadPunishmentCandidates();
    }
    if (state.sessionRole === 'owner') {
      await loadPanelUsers();
      await loadActivityLogs();
    }
  } catch (error) {
    console.error(error);
  }
});

activityActorSelect?.addEventListener('change', () => {
  state.activityActor = activityActorSelect.value || 'all';
});

activityLogsLoadButton?.addEventListener('click', () => {
  state.activityActor = activityActorSelect.value || 'all';
  loadActivityLogs().catch(error => window.alert(error.message));
});

closeEditorButton.addEventListener('click', closeEditor);
editorBackdrop.addEventListener('click', closeEditor);
closeMandateCaseButton?.addEventListener('click', () => closeMandateCaseModal(true));
mandateCaseBackdrop?.addEventListener('click', () => closeMandateCaseModal(true));

setAuthMode(state.authMode);
setCategory(state.currentCategory);
earningsDateInput.disabled = true;
updatePunishmentFormVisibility();
updateRoleView();

boot().catch(error => {
  authError.textContent = error.message;
  authOverlay.classList.remove('hidden');
});
