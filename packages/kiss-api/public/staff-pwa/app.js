/* global io */
const el = (id) => document.getElementById(id);

const state = {
  socket: null,
  selectedDecision: null,
  currentInstruction: null,
  currentOptions: [],
  requireComment: false,
  audioUnlocked: false,
  wakeLock: null,
};

function showBanner(text, kind = "") {
  const b = el('banner');
  if (!text) {
    b.textContent = "";
    b.className = 'banner hidden';
    return;
  }
  b.textContent = text;
  b.className = 'banner ' + (kind || '');
}

function setStatus(text, kind) {
  const badge = el('status').querySelector('.badge');
  badge.textContent = text;
  badge.className = 'badge ' + (kind || '');
}

async function fetchBranches() {
  try {
    const resp = await fetch('/hitl/branches');
    const data = await resp.json();
    return data.branches || [];
  } catch (e) {
    return [];
  }
}

function populateBranches(branches) {
  const sel = el('branchSelect');
  sel.innerHTML = '';
  for (const b of branches) {
    const opt = document.createElement('option');
    opt.value = b.branch_id;
    opt.textContent = b.display_name || b.branch_id;
    sel.appendChild(opt);
  }
}

async function unlockAudio() {
  if (state.audioUnlocked) return true;
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.00001; // nearly silent
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.001);
    state.audioUnlocked = true;
    return true;
  } catch (e) {
    return false;
  }
}

function playAlert() {
  try {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    g.gain.value = 0.08;
    o.type = 'sine';
    o.frequency.value = 880;
    o.connect(g);
    g.connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.18);
  } catch (e) {
    // ignore
  }
}

function renderChoices(options) {
  const container = el('choices');
  container.innerHTML = '';
  const safeOptions = Array.isArray(options) && options.length ? options : ['SI', 'NO', 'INFO'];
  state.currentOptions = safeOptions;
  state.selectedDecision = null;

  safeOptions.forEach((opt) => {
    const btn = document.createElement('button');
    btn.className = 'choice';
    btn.textContent = String(opt);
    btn.dataset.decision = String(opt);
    btn.addEventListener('click', () => {
      container.querySelectorAll('.choice').forEach((b) => b.classList.remove('selected'));
      btn.classList.add('selected');
      state.selectedDecision = btn.dataset.decision;
    });
    container.appendChild(btn);
  });
}

function applyCommentConfig({ requireComment = false, placeholder = '' } = {}) {
  state.requireComment = !!requireComment;
  const label = el('commentLabel');
  label.textContent = requireComment ? 'Comentario (requerido)' : 'Comentario (opcional)';
  const input = el('commentInput');
  input.placeholder = placeholder || (requireComment
    ? 'Escribe una respuesta corta para el cliente / gerente.'
    : input.placeholder);
}

async function requestWakeLock() {
  if (!('wakeLock' in navigator)) return;
  try {
    state.wakeLock = await navigator.wakeLock.request('screen');
    state.wakeLock.addEventListener('release', () => {});
  } catch (e) {
    // ignore
  }
}

document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible') {
    await requestWakeLock();
  }
});

function showRequest(instruction) {
  state.currentInstruction = instruction;
  el('emptyState').classList.add('hidden');
  el('reqCard').classList.remove('hidden');
  const a0 = Array.isArray(instruction.actions) ? instruction.actions[0] : null;
  const params = a0?.params || {};
  const meta = params.meta || {};

  // Banner for crisis / high-priority cases
  const isCrisis = instruction.priority === 'CRITICAL' || params.response_format === 'ack_only' || meta.hitl_request_type === 'CUSTOMER_AT_RISK';
  if (isCrisis) {
    showBanner(instruction.message || 'ALERTA', 'crisis');
  } else {
    showBanner(null);
  }

  // Main text area: show customer text when available, otherwise instruction message
  el('reqText').textContent = (meta.customer_text || instruction.message || '(sin mensaje)');
  const metaParts = [];
  if (instruction.target?.location_id) metaParts.push(instruction.target.location_id);
  if (instruction.instruction_id) metaParts.push(instruction.instruction_id);
  el('reqMeta').textContent = metaParts.join(' • ');
  el('commentInput').value = '';
  el('reqMsg').textContent = '';

  // Render choices dynamically
  renderChoices(params.options);

  // Comment rules
  applyCommentConfig({
    requireComment: !!params.require_comment,
    placeholder: params.comment_placeholder || '',
  });

  playAlert();
}

function clearRequest() {
  state.currentInstruction = null;
  showBanner(null);
  el('reqCard').classList.add('hidden');
  el('emptyState').classList.remove('hidden');
}

function connectSocket({ token, branch_id, role }) {
  if (!window.io) {
    el('setupMsg').textContent = 'socket.io client no disponible.';
    return;
  }

  state.socket = io({
    auth: {
      token,
      branch_id,
      role,
      device_id: localStorage.getItem('tagers_device_id') || ('dev_' + Math.random().toString(16).slice(2)),
    },
    transports: ['websocket', 'polling'],
  });

  state.socket.on('connect', () => {
    setStatus('Conectado', 'ok');
    el('setup').classList.add('hidden');
    el('inbox').classList.remove('hidden');
    el('setupMsg').textContent = '';
  });

  state.socket.on('disconnect', () => {
    setStatus('Desconectado', 'err');
  });

  state.socket.on('connect_error', (err) => {
    setStatus('Error', 'err');
    el('setupMsg').textContent = 'No se pudo conectar: ' + (err?.message || 'error');
  });

  state.socket.on('hitl_request', (instruction) => {
    showRequest(instruction);
  });

  state.socket.on('hitl_ack', (data) => {
    el('reqMsg').textContent = 'Respuesta registrada.';
    setTimeout(() => clearRequest(), 900);
  });
}

async function start() {
  const branches = await fetchBranches();
  if (branches.length === 0) {
    // fallback hardcoded
    populateBranches([
      { branch_id: 'SONATA', display_name: 'SONATA' },
      { branch_id: 'ZAVALETA', display_name: 'ZAVALETA' },
      { branch_id: 'ANGELOPOLIS', display_name: 'ANGELOPOLIS' },
      { branch_id: 'SAN_ANGEL', display_name: 'SAN_ANGEL' },
      { branch_id: '5_SUR', display_name: '5_SUR' },
    ]);
  } else {
    populateBranches(branches);
  }

  el('startBtn').addEventListener('click', async () => {
    const token = el('tokenInput').value.trim();
    const branch_id = el('branchSelect').value;
    const role = el('roleSelect').value;

    if (!token || !branch_id) {
      el('setupMsg').textContent = 'Falta sucursal o token.';
      return;
    }

    localStorage.setItem('tagers_branch_id', branch_id);
    localStorage.setItem('tagers_role', role);

    await unlockAudio();
    await requestWakeLock();

    connectSocket({ token, branch_id, role });
  });

  // restore
  const savedBranch = localStorage.getItem('tagers_branch_id');
  if (savedBranch) el('branchSelect').value = savedBranch;
  const savedRole = localStorage.getItem('tagers_role');
  if (savedRole) el('roleSelect').value = savedRole;

  el('sendBtn').addEventListener('click', () => {
    if (!state.socket || !state.socket.connected) {
      el('reqMsg').textContent = 'No hay conexión.';
      return;
    }
    if (!state.currentInstruction?.instruction_id) {
      el('reqMsg').textContent = 'No hay solicitud activa.';
      return;
    }
    const comment = el('commentInput').value.trim();
    if (!state.selectedDecision) {
      el('reqMsg').textContent = 'Selecciona una opción para responder.';
      return;
    }
    if (state.requireComment && !comment) {
      el('reqMsg').textContent = 'Escribe un comentario (requerido) antes de enviar.';
      return;
    }

    state.socket.emit('hitl_response', {
      instruction_id: state.currentInstruction.instruction_id,
      decision: state.selectedDecision,
      comment,
    }, (ack) => {
      if (ack?.ok) {
        state.socket.emit('hitl_ack', { instruction_id: state.currentInstruction.instruction_id });
      } else {
        el('reqMsg').textContent = 'Error: ' + (ack?.error || 'no_ack');
      }
    });
  });

  setStatus('Desconectado', '');
}

start();
