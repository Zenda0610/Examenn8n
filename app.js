/* ==========================================================================
   TALENTAI — SHARED APPLICATION ENGINE & AUTHENTICATION GUARD
   ========================================================================== */

/* ==========================================
   N8N WEBHOOK CONFIGURATION & ENGINE
   ========================================== */

const N8N_DEFAULTS = {
  candidateUrl: '',
  decisionUrl: '',
  testUrl: '',
  getCandidatesUrl: '',
  enabled: false
};

function getN8nConfig() {
  const raw = localStorage.getItem('talentai_n8n_config');
  try {
    return raw ? { ...N8N_DEFAULTS, ...JSON.parse(raw) } : { ...N8N_DEFAULTS };
  } catch (e) {
    return { ...N8N_DEFAULTS };
  }
}

function saveN8nConfig(config) {
  localStorage.setItem('talentai_n8n_config', JSON.stringify(config));
}

/**
 * Helper to read a File object as a Base64 Data URL string.
 */
function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = err => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Sends a JSON or Multipart POST to the configured n8n webhook endpoint.
 * @param {'candidate'|'decision'|'test'} eventType
 * @param {Object} payload
 * @returns {Promise<{ok: boolean, status: number, data: any, error: string|null}>}
 */
async function sendN8nWebhook(eventType, payload) {
  const config = getN8nConfig();

  if (!config.enabled) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: 'Webhooks desactivados en Configuración.'
    };
  }

  let url = '';

  if (eventType === 'candidate') {
    url = config.candidateUrl;
  } else if (eventType === 'decision') {
    url = config.decisionUrl;
  } else if (eventType === 'test') {
    url = config.testUrl || config.candidateUrl;
  }

  if (!url) {
    return {
      ok: false,
      status: 0,
      data: null,
      error: `URL de Webhook para "${eventType}" no configurada.`
    };
  }

  const { pdf_file, ...cleanPayload } = payload;

  const fullPayload = {
    ...cleanPayload,
    source: 'TalentAI',
    event: eventType,
    timestamp: new Date().toISOString()
  };

  // Clean log payload for UI logging (truncate large base64 strings)
  const logPayload = { ...fullPayload };
  if (logPayload.pdf_base64 && typeof logPayload.pdf_base64 === 'string') {
    logPayload.pdf_base64 = `[BASE64_PDF_DATA: ${logPayload.pdf_base64.length} caracteres]`;
  }

  try {
    console.log('=================================');
    console.log('Enviando solicitud a n8n');
    console.log('URL:', url);
    console.log('Payload:', logPayload);
    console.log('=================================');

    let fetchOptions = {};

    if (pdf_file && pdf_file instanceof File) {
      const formData = new FormData();
      formData.append('cv', pdf_file, pdf_file.name);
      formData.append('file', pdf_file, pdf_file.name);

      for (const [key, value] of Object.entries(fullPayload)) {
        if (typeof value === 'object' && value !== null) {
          formData.append(key, JSON.stringify(value));
        } else if (value !== undefined && value !== null) {
          formData.append(key, value);
        }
      }

      fetchOptions = {
        method: 'POST',
        mode: 'cors',
        body: formData
      };
    } else {
      fetchOptions = {
        method: 'POST',
        mode: 'cors',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(fullPayload)
      };
    }

    const response = await fetch(url, fetchOptions);

    console.log('HTTP Status:', response.status);

    const responseText = await response.text();

    console.log('Respuesta RAW de n8n:', responseText);

    let data = null;

    if (responseText && responseText.trim() !== '') {
      try {
        data = JSON.parse(responseText);
      } catch (jsonError) {
        console.warn(
          'La respuesta de n8n no es JSON válido:',
          responseText
        );

        data = responseText;
      }
    }

    addWebhookLog(
      eventType,
      url,
      logPayload,
      response.status,
      data,
      response.ok ? 'success' : 'error'
    );

    return {
      ok: response.ok,
      status: response.status,
      data: data,
      error: response.ok ? null : `HTTP ${response.status}`
    };

  } catch (error) {

    console.error('Error de conexión con n8n:', error);

    const errorMessage =
      error instanceof TypeError
        ? 'Failed to fetch. Revisa la URL, CORS o que n8n esté disponible.'
        : error.message;

    addWebhookLog(
      eventType,
      url,
      logPayload,
      0,
      errorMessage,
      'error'
    );

    return {
      ok: false,
      status: 0,
      data: null,
      error: errorMessage
    };
  }
}
async function testN8nConnection() {
  const btn = document.getElementById('n8n-test-btn');
  const statusEl = document.getElementById('n8n-test-status');
  if (btn) { btn.disabled = true; btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Conectando...'; }
  if (statusEl) statusEl.innerHTML = '';

  const result = await sendN8nWebhook('test', {
    mensaje: 'Prueba de conexión desde TalentAI',
    version: '2.0'
  });

  if (btn) { btn.disabled = false; btn.innerHTML = '<i class="fa-solid fa-bolt"></i> Probar Conexión'; }

  if (result.ok) {
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--green-success);"><i class="fa-solid fa-circle-check"></i> Conexión exitosa — HTTP ${result.status}</span>`;
    showNotification('n8n Conectado', `Webhook respondió correctamente (HTTP ${result.status})`, 'info');
  } else {
    const msg = result.error || `HTTP ${result.status}`;
    if (statusEl) statusEl.innerHTML = `<span style="color:var(--red-danger);"><i class="fa-solid fa-circle-xmark"></i> Error: ${msg}</span>`;
    showNotification('n8n Error', msg, 'error');
  }
  renderWebhookLog();
}

// --- Webhook Log Store (in-memory + localStorage) ---
let webhookLogs = [];
function addWebhookLog(eventType, url, payload, status, response, result) {
  webhookLogs.unshift({
    id: Date.now(),
    eventType,
    url,
    payload,
    status,
    response,
    result,
    timestamp: new Date().toLocaleTimeString('es-CO')
  });
  if (webhookLogs.length > 20) webhookLogs.pop();
}

function renderWebhookLog() {
  const container = document.getElementById('webhook-log-container');
  if (!container) return;
  if (webhookLogs.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); font-size:0.85rem; text-align:center; padding:20px;">Ningún evento disparado todavía.</p>';
    return;
  }
  container.innerHTML = webhookLogs.map(log => `
    <div style="border:1px solid var(--slate-border); border-left:4px solid ${log.result === 'success' ? 'var(--green-success)' : 'var(--red-danger)'}; border-radius:var(--radius-sm); padding:12px; margin-bottom:10px; font-size:0.82rem;">
      <div style="display:flex; justify-content:space-between; margin-bottom:6px; flex-wrap:wrap; gap:4px;">
        <strong style="text-transform:uppercase; letter-spacing:0.5px;">${log.eventType}</strong>
        <span style="color:${log.result === 'success' ? 'var(--green-success)' : 'var(--red-danger)'};">
          ${log.result === 'success' ? '✓' : '✗'} HTTP ${log.status || 'ERR'} — ${log.timestamp}
        </span>
      </div>
      <div style="color:var(--text-muted); margin-bottom:4px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;" title="${log.url}">
        <i class="fa-solid fa-link"></i> ${log.url}
      </div>
      <details style="margin-top:6px;">
        <summary style="cursor:pointer; color:var(--blue-primary);">Ver payload enviado</summary>
        <pre style="margin-top:6px; background:var(--navy-dark); color:#a5f3fc; padding:10px; border-radius:var(--radius-sm); overflow:auto; font-size:0.78rem;">${JSON.stringify(log.payload, null, 2)}</pre>
      </details>
      ${log.response ? `
      <details style="margin-top:4px;">
        <summary style="cursor:pointer; color:var(--text-muted);">Ver respuesta de n8n</summary>
        <pre style="margin-top:6px; background:var(--navy-dark); color:#bbf7d0; padding:10px; border-radius:var(--radius-sm); overflow:auto; font-size:0.78rem;">${typeof log.response === 'string' ? log.response : JSON.stringify(log.response, null, 2)}</pre>
      </details>` : ''}
    </div>
  `).join('');
}

function initWebhookConfigForm() {
  const config = getN8nConfig();
  const candInput = document.getElementById('n8n-url-candidate');
  const decInput = document.getElementById('n8n-url-decision');
  const testInput = document.getElementById('n8n-url-test');
  const getCandInput = document.getElementById('n8n-url-get-candidates');
  const toggle = document.getElementById('n8n-enabled-toggle');
  const statusLabel = document.getElementById('n8n-status-label');

  if (candInput) candInput.value = config.candidateUrl;
  if (decInput) decInput.value = config.decisionUrl;
  if (testInput) testInput.value = config.testUrl;
  if (getCandInput) getCandInput.value = config.getCandidatesUrl || '';
  if (toggle) {
    toggle.checked = config.enabled;
    if (statusLabel) statusLabel.textContent = config.enabled ? 'Webhooks Activos' : 'Webhooks Inactivos';
    toggle.addEventListener('change', () => {
      if (statusLabel) statusLabel.textContent = toggle.checked ? 'Webhooks Activos' : 'Webhooks Inactivos';
    });
  }
}

function saveN8nConfigFromForm() {
  const config = {
    candidateUrl: document.getElementById('n8n-url-candidate')?.value.trim() || '',
    decisionUrl: document.getElementById('n8n-url-decision')?.value.trim() || '',
    testUrl: document.getElementById('n8n-url-test')?.value.trim() || '',
    getCandidatesUrl: document.getElementById('n8n-url-get-candidates')?.value.trim() || '',
    enabled: document.getElementById('n8n-enabled-toggle')?.checked || false
  };
  saveN8nConfig(config);
  showNotification('Configuración guardada', 'URLs de Webhook n8n actualizadas correctamente.', 'info');
  const btn = document.getElementById('n8n-save-btn');
  if (btn) {
    btn.innerHTML = '<i class="fa-solid fa-check"></i> ¡Guardado!';
    setTimeout(() => { btn.innerHTML = '<i class="fa-solid fa-floppy-disk"></i> Guardar Configuración'; }, 2000);
  }
}

/* ==========================================
   GOOGLE SHEETS / N8N CANDIDATE SYNC ENGINE
   ========================================== */

function mapGoogleSheetRowToCandidate(row, index) {
  const item = row.json || row;

  const getVal = (...keys) => {
    for (const k of keys) {
      if (item[k] !== undefined && item[k] !== null && item[k] !== '') {
        return item[k];
      }
      const trimmedKey = Object.keys(item).find(ik => ik.trim() === k.trim());
      if (trimmedKey && item[trimmedKey] !== undefined && item[trimmedKey] !== null && item[trimmedKey] !== '') {
        return item[trimmedKey];
      }
    }
    return '';
  };

  const rawTicket = getVal('Ticket ', 'Ticket', 'Ticket_ID', 'ticket_id', 'id');
  const seq = String(index + 1).padStart(3, '0');
  const candidateId = rawTicket ? (rawTicket.startsWith('CAND-') ? rawTicket : `CAND-${seq}`) : `CAND-${seq}`;
  const ticketId = rawTicket || `TF-2026-${seq}`;

  const nombre = getVal('Nombre_postulante', 'Nombre', 'nombre') || `Candidato ${seq}`;
  const correo = getVal('Correo', 'correo') || 'sin.correo@email.com';
  const telefono = getVal('Numero_contacto', 'Telefono', 'telefono') || '';
  const vacante = getVal('Vacante ', 'Vacante', 'vacante') || 'Backend Developer';

  const scoreRaw = getVal('Porcentaje de aprobación', 'Porcentaje de aprobacion', 'score', 'compatibilidad');
  const score = scoreRaw !== '' ? Math.round(Number(scoreRaw)) || 75 : 75;

  const decisionRaw = String(getVal('Desición', 'Decisión', 'decision', 'estado')).toUpperCase();
  let estado = 'PENDIENTE_REVISION';
  if (decisionRaw.includes('PRESELECCIONA') || decisionRaw === 'PRESELECCIONADO') {
    estado = 'PRESELECCIONADO';
  } else if (decisionRaw.includes('ENTREVISTA') || decisionRaw === 'EN_ENTREVISTA') {
    estado = 'EN_ENTREVISTA';
  } else if (decisionRaw.includes('DESCARTA') || decisionRaw === 'DESCARTADO') {
    estado = 'DESCARTADO';
  } else if (decisionRaw.includes('REVISAR') || decisionRaw === 'REVISION_MANUAL') {
    estado = 'REVISION_MANUAL';
  } else if (score >= 80) {
    estado = 'PRESELECCIONADO';
  }

  const educacion = getVal('Nivel_educativo', 'educacion', 'Nivel académico') || 'Profesional';
  const resumen = getVal('Resumen_IA', 'resumen', 'Observaciones_IA', 'observaciones') || 'Candidato sincronizado desde Google Sheets vía n8n.';
  
  const rawSkills = getVal('Habilidades ', 'Habilidades', 'habilidades');
  let habilidades = [];
  if (Array.isArray(rawSkills)) {
    habilidades = rawSkills;
  } else if (typeof rawSkills === 'string' && rawSkills.trim() !== '') {
    habilidades = rawSkills.split(/[,;\n]+/).map(s => s.trim()).filter(Boolean);
  } else {
    habilidades = ['General'];
  }

  const rawQuestions = getVal('Preguntas_postulante', 'preguntas');
  let preguntas = [];
  if (Array.isArray(rawQuestions)) {
    preguntas = rawQuestions;
  } else if (typeof rawQuestions === 'string' && rawQuestions.trim() !== '') {
    preguntas = rawQuestions.split('\n').map(q => q.trim()).filter(Boolean);
  }

  const fecha = getVal('Fecha_Postulacion', 'fecha') || new Date().toLocaleDateString('es-CO');

  return {
    id: candidateId,
    ticket_id: ticketId,
    nombre,
    correo,
    telefono,
    vacante,
    experiencia: getVal('Experiencia', 'experiencia_anios', 'experiencia') ? Number(getVal('Experiencia', 'experiencia_anios', 'experiencia')) : 2,
    habilidades,
    educacion,
    score,
    estado,
    prioridad: getVal('Prioridad', 'prioridad'),
    recomendacion: getVal('Recomendación', 'recomendacion'),
    cumpleExperiencia: getVal('Cumple_Experiencia') === 'true' || getVal('Cumple_Experiencia') === true,
    fecha,
    resumen,
    preguntas,
    source: 'GoogleSheets'
  };
}

async function syncCandidatesFromN8n(showNotify = false) {
  const config = getN8nConfig();
  if (!config.enabled || !config.getCandidatesUrl) {
    if (showNotify) {
      showNotification('Sincronización deshabilitada', 'Debes activar los Webhooks e ingresar la URL "Obtener Candidatos (GET)" en Configuración.', 'warning');
    }
    return false;
  }

  const syncBtns = document.querySelectorAll('#n8n-sync-btn, #n8n-sync-btn-list');
  syncBtns.forEach(btn => {
    if (btn) {
      btn.disabled = true;
      btn.dataset.origHtml = btn.innerHTML;
      btn.innerHTML = '<i class="fa-solid fa-arrows-rotate fa-spin"></i> Sincronizando...';
    }
  });

  try {
    const response = await fetch(config.getCandidatesUrl, {
      method: 'GET',
      headers: { 'Accept': 'application/json' }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const responseText = await response.text();
    let data = [];
    if (responseText && responseText.trim() !== '') {
      try {
        data = JSON.parse(responseText);
      } catch (jsonErr) {
        console.warn('La respuesta de n8n no es un JSON válido:', responseText);
      }
    }

    let rows = [];
    if (Array.isArray(data)) {
      rows = data;
    } else if (data && Array.isArray(data.data)) {
      rows = data.data;
    } else if (data && typeof data === 'object' && Object.keys(data).length > 0) {
      rows = [data];
    }

    if (rows.length > 0) {
      const fetchedCandidates = rows.map((row, idx) => mapGoogleSheetRowToCandidate(row, idx));
      candidates = fetchedCandidates;
      saveStoredState('candidates', candidates);

      const currentPage = document.body ? document.body.getAttribute('data-page') : null;
      if (currentPage === 'dashboard') renderDashboard();
      if (currentPage === 'candidatos') renderCandidates();
      if (currentPage === 'revisiones') renderReviews();

      if (showNotify) {
        showNotification('Sincronización exitosa', `Se obtuvieron ${fetchedCandidates.length} candidatos desde Google Sheets (n8n).`, 'info');
      }
    } else {
      if (showNotify) {
        showNotification('Google Sheets Vacío', 'No se encontraron candidatos en la hoja de cálculo.', 'warning');
      }
    }
    return true;
  } catch (error) {
    console.error('Error sincronizando candidatos desde n8n:', error);
    if (showNotify) {
      showNotification('Error de Sincronización', `No se pudo consultar n8n: ${error.message}`, 'error');
    }
    return false;
  } finally {
    syncBtns.forEach(btn => {
      if (btn) {
        btn.disabled = false;
        btn.innerHTML = btn.dataset.origHtml || '<i class="fa-solid fa-arrows-rotate"></i> Sincronizar Google Sheets';
      }
    });
  }
}

/* ==========================================
   INSTANT AUTHENTICATION ROUTE GUARD
   ========================================== */
(function checkAuthGuard() {
  const path = window.location.pathname.toLowerCase();
  const isLoginPage = path.endsWith('login.html');

  const sessionRaw = localStorage.getItem('talentai_auth_session');
  let session = null;
  try {
    session = sessionRaw ? JSON.parse(sessionRaw) : null;
  } catch (e) {
    session = null;
  }

  // If user is trying to access protected pages without session
  if (!isLoginPage) {
    if (!session || !session.role) {
      window.location.href = 'login.html';
      return;
    }

    // Role-based route enforcement
    const isCandidatePage = path.endsWith('candidato.html');
    if (!isCandidatePage && session.role !== 'hr') {
      // Candidate role trying to access HR admin routes -> redirect to candidate portal
      window.location.href = 'candidato.html';
      return;
    }
  }
})();

// Initial Seed Data
const initialCandidates = [
  {
    id: "CAND-001",
    nombre: "Laura Gómez",
    correo: "laura.gomez@email.com",
    telefono: "+57 300 123 4567",
    vacante: "Backend Developer",
    experiencia: 3,
    habilidades: ["Java", "Spring Boot", "PostgreSQL", "Docker", "Git", "REST API"],
    educacion: "Ingeniería de Sistemas",
    score: 87,
    estado: "PENDIENTE_REVISION",
    fecha: "10/08/2026",
    resumen: "Desarrolladora backend con 3 años de experiencia en ecosistema Java y bases de datos relacionales.",
    preguntas: [
      "Explique cómo ha utilizado Docker para desplegar una aplicación desarrollada con Spring Boot.",
      "¿Cómo implementaría una API REST utilizando Spring Boot y autenticación JWT?"
    ]
  },
  {
    id: "CAND-002",
    nombre: "Carlos Rodríguez",
    correo: "carlos.rodriguez@email.com",
    telefono: "+57 311 987 6543",
    vacante: "Frontend Developer",
    experiencia: 2,
    habilidades: ["JavaScript", "React", "HTML", "CSS", "Git"],
    educacion: "Tecnología en Desarrollo de Software",
    score: 74,
    estado: "REVISION_MANUAL",
    fecha: "09/08/2026",
    resumen: "Desarrollador frontend enfocado en React e interfaces modernas orientadas a UX.",
    preguntas: [
      "¿Cómo optimizaría el rendimiento de renderizado en componentes de React?",
      "Describa su experiencia trabajando con Git en flujos colaborativos."
    ]
  },
  {
    id: "CAND-003",
    nombre: "Andrés Pérez",
    correo: "andres.perez@email.com",
    telefono: "+57 320 456 7890",
    vacante: "Data Analyst",
    experiencia: 4,
    habilidades: ["SQL", "Python", "Power BI", "Excel", "Pandas"],
    educacion: "Estadística e Ingeniería Industrial",
    score: 91,
    estado: "PRESELECCIONADO",
    fecha: "08/08/2026",
    resumen: "Analista de datos sénior con sólidos conocimientos en modelado SQL y cuadros de mando en Power BI.",
    preguntas: [
      "Mencione una consulta compleja de SQL que haya optimizado para procesamiento masivo.",
      "¿Cómo presenta los hallazgos técnicos de data a stakeholders no técnicos?"
    ]
  },
  {
    id: "CAND-004",
    nombre: "María Fernanda Torres",
    correo: "m.torres@email.com",
    telefono: "+57 305 777 8899",
    vacante: "DevOps Engineer",
    experiencia: 5,
    habilidades: ["AWS", "Docker", "Kubernetes", "CI/CD", "Linux"],
    educacion: "Ingeniería de Telecomunicaciones",
    score: 84,
    estado: "EN_ENTREVISTA",
    fecha: "07/08/2026",
    resumen: "Ingeniera DevOps especialista en infraestructura en la nube AWS y orquestación de contenedores.",
    preguntas: [
      "Describa un pipeline CI/CD completo que haya diseñado e implementado."
    ]
  },
  {
    id: "CAND-005",
    nombre: "Javier Mendoza",
    correo: "javier.mendoza@email.com",
    telefono: "+57 312 333 4455",
    vacante: "QA Engineer",
    experiencia: 1,
    habilidades: ["Selenium", "Testing Manual", "Postman"],
    educacion: "Técnico en Sistemas",
    score: 58,
    estado: "REVISION_SECUNDARIA",
    fecha: "06/08/2026",
    resumen: "Perfil junior con bases en automatización Selenium y ejecución de pruebas funcionales manuales.",
    preguntas: [
      "¿Cómo elabora un plan de pruebas para una API REST?"
    ]
  }
];

const initialVacancies = [
  {
    id: "VAC-01",
    nombre: "Backend Developer",
    experiencia: "2+ años",
    tecnologias: ["Java", "Spring Boot", "SQL", "Git", "REST API"],
    estado: "Activa",
    candidatosCount: 32,
    scoreMin: 60
  },
  {
    id: "VAC-02",
    nombre: "Frontend Developer",
    experiencia: "2+ años",
    tecnologias: ["JavaScript", "React", "HTML", "CSS", "Git"],
    estado: "Activa",
    candidatosCount: 27,
    scoreMin: 65
  },
  {
    id: "VAC-03",
    nombre: "Data Analyst",
    experiencia: "3+ años",
    tecnologias: ["SQL", "Python", "Power BI", "Excel"],
    estado: "Activa",
    candidatosCount: 21,
    scoreMin: 70
  },
  {
    id: "VAC-04",
    nombre: "DevOps Engineer",
    experiencia: "3+ años",
    tecnologias: ["AWS", "Docker", "Kubernetes", "CI/CD"],
    estado: "Activa",
    candidatosCount: 18,
    scoreMin: 75
  },
  {
    id: "VAC-05",
    nombre: "QA Engineer",
    experiencia: "1+ años",
    tecnologias: ["Selenium", "Cypress", "Postman"],
    estado: "Activa",
    candidatosCount: 15,
    scoreMin: 60
  }
];

const initialNotifications = [
  { id: 1, text: "Nuevo candidato analizado: Laura Gómez obtuvo 87% de compatibilidad.", time: "Hace 10 min", read: false },
  { id: 2, text: "Revisión requerida para Carlos Rodríguez (Score 74%).", time: "Hace 1 hora", read: false },
  { id: 3, text: "Candidato CAND-003 enviado a fase de entrevista.", time: "Hace 3 horas", read: false }
];

// Persistent State Storage Management
function getStoredState(key, fallback) {
  const item = localStorage.getItem('talentai_' + key);
  return item ? JSON.parse(item) : fallback;
}

function saveStoredState(key, value) {
  localStorage.setItem('talentai_' + key, JSON.stringify(value));
}

let candidates = getStoredState('candidates', initialCandidates);
let vacancies = getStoredState('vacancies', initialVacancies);
let notifications = getStoredState('notifications', initialNotifications);
let selectedCandidateId = null;

// Chart Instance Trackers
let trendChartObj = null;
let donutChartObj = null;
let metricsVacanciesChartObj = null;
let metricsScoresChartObj = null;

/* ==========================================
   AUTHENTICATION & SESSION ENGINE
   ========================================== */
function loginHR(e) {
  if (e) e.preventDefault();
  const session = {
    role: 'hr',
    email: 'admin@talentai.com',
    name: 'Elena Rostova',
    timestamp: Date.now()
  };
  localStorage.setItem('talentai_auth_session', JSON.stringify(session));
  window.location.href = 'index.html';
}

function loginCandidate(e) {
  if (e) e.preventDefault();
  const email = document.getElementById('cand-login-email')?.value || 'candidato@email.com';
  const session = {
    role: 'candidate',
    email: email,
    timestamp: Date.now()
  };
  localStorage.setItem('talentai_auth_session', JSON.stringify(session));
  window.location.href = 'candidato.html';
}

function logout() {
  localStorage.removeItem('talentai_auth_session');
  window.location.href = 'login.html';
}

/* ==========================================
   INITIALIZATION ON DOM LOAD
   ========================================== */
document.addEventListener("DOMContentLoaded", () => {
  initTheme();
  initSidebar();
  initNotificationsCenter();

  const currentPage = document.body ? document.body.getAttribute('data-page') : null;
  
  if (currentPage === 'dashboard') {
    renderDashboard();
  } else if (currentPage === 'candidatos') {
    renderCandidates();
  } else if (currentPage === 'vacantes') {
    renderVacancies();
  } else if (currentPage === 'revisiones') {
    renderReviews();
  } else if (currentPage === 'metricas') {
    renderMetrics();
  } else if (currentPage === 'portal_candidato') {
    renderCandidatePortal();
  } else if (currentPage === 'configuracion') {
    initWebhookConfigForm();
  } else if (currentPage === 'integraciones') {
    renderWebhookLog();
  }
});

/* ==========================================
   THEME & SIDEBAR
   ========================================== */
function initTheme() {
  const savedTheme = localStorage.getItem('talentai_theme') || 'light';
  document.documentElement.setAttribute('data-theme', savedTheme);

  const btn = document.getElementById("theme-toggle-btn");
  const icon = document.getElementById("theme-icon");

  if (icon) {
    icon.className = savedTheme === "dark" ? "fa-regular fa-sun" : "fa-regular fa-moon";
  }

  if (btn) {
    btn.addEventListener("click", () => {
      const currentTheme = document.documentElement.getAttribute("data-theme");
      const newTheme = currentTheme === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", newTheme);
      localStorage.setItem('talentai_theme', newTheme);
      if (icon) icon.className = newTheme === "dark" ? "fa-regular fa-sun" : "fa-regular fa-moon";
    });
  }
}

function initSidebar() {
  const sidebarToggle = document.getElementById("sidebar-toggle");
  const sidebar = document.getElementById("sidebar");
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener("click", () => {
      sidebar.classList.toggle("collapsed");
      const icon = document.getElementById("toggle-icon");
      if (icon) {
        icon.className = sidebar.classList.contains("collapsed") ? "fa-solid fa-angles-right" : "fa-solid fa-angles-left";
      }
    });
  }
}

/* ==========================================
   NOTIFICATIONS
   ========================================== */
function initNotificationsCenter() {
  const notifBtn = document.getElementById("notif-bell-btn");
  const notifDropdown = document.getElementById("notification-dropdown");
  
  if (notifBtn && notifDropdown) {
    notifBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      notifDropdown.classList.toggle("show");
    });
    document.addEventListener("click", () => {
      notifDropdown.classList.remove("show");
    });
  }
  renderNotifications();
}

function renderNotifications() {
  const container = document.getElementById("notif-list-container");
  const countBadge = document.getElementById("notif-count");
  if (!container) return;

  container.innerHTML = "";

  notifications.forEach(n => {
    const item = document.createElement("div");
    item.className = "notif-item" + (n.read ? "" : " unread");
    item.innerHTML = `
      <div class="notif-icon"><i class="fa-solid fa-bell"></i></div>
      <div class="notif-content">
        <p>${n.text}</p>
        <span>${n.time}</span>
      </div>
    `;
    container.appendChild(item);
  });

  const unreadCount = notifications.filter(n => !n.read).length;
  if (countBadge) countBadge.innerText = unreadCount;
}

function showNotification(title, message, type = 'info') {
  notifications.unshift({
    id: Date.now(),
    text: `${title}: ${message}`,
    time: "Ahora mismo",
    read: false
  });
  saveStoredState('notifications', notifications);
  renderNotifications();
}

function markAllNotificationsRead() {
  notifications.forEach(n => n.read = true);
  saveStoredState('notifications', notifications);
  renderNotifications();
}

/* ==========================================
   CANDIDATE PORTAL SPECIFICS
   ========================================== */
function renderCandidatePortal() {
  renderCandidateVacancies();
}

function renderCandidateVacancies() {
  const container = document.getElementById("cand-vacancies-container");
  if (!container) return;

  container.innerHTML = "";
  vacancies.forEach(v => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
        <div>
          <h3>${v.nombre}</h3>
          <span style="font-size:0.8rem; color:var(--text-muted);">Requisito: ${v.experiencia}</span>
        </div>
        <span class="badge badge-status-preselected">${v.estado}</span>
      </div>

      <div style="margin-bottom:16px;">
        <p style="font-size:0.82rem; color:var(--text-muted); margin-bottom:6px;">Stack tecnológico buscado:</p>
        <div class="skills-tags">
          ${v.tecnologias.map(t => `<span class="skill-tag">${t}</span>`).join('')}
        </div>
      </div>

      <button class="btn btn-primary btn-sm" style="width:100%; justify-content:center;" onclick="prefillCandidateVacancy('${v.nombre}')">
        <i class="fa-solid fa-paper-plane"></i> Postularme a esta vacante
      </button>
    `;
    container.appendChild(card);
  });
}

function prefillCandidateVacancy(vacancyName) {
  const sel = document.getElementById("app-vacancy");
  if (sel) {
    sel.value = vacancyName;
    window.scrollTo({ top: document.getElementById('application-form-section').offsetTop - 80, behavior: 'smooth' });
  }
}

function trackCandidateApplication() {
  const query = document.getElementById("track-search-id")?.value.trim().toUpperCase();
  const resultBox = document.getElementById("track-result-box");
  if (!query || !resultBox) return;

  const c = candidates.find(item => item.id.toUpperCase() === query || item.correo.toUpperCase() === query);

  if (!c) {
    resultBox.style.display = "block";
    resultBox.innerHTML = `
      <div style="text-align:center; padding:20px; color:var(--red-danger);">
        <i class="fa-solid fa-circle-exclamation" style="font-size:2rem; margin-bottom:8px;"></i>
        <p>No se encontró ninguna postulación con el ID o correo <strong>${query}</strong>.</p>
        <span style="font-size:0.8rem; color:var(--text-muted);">Sugerencia: Prueba con CAND-001 o registra una nueva postulación abajo.</span>
      </div>
    `;
    return;
  }

  let step1 = "completed", step2 = "completed", step3 = "timeline-step", step4 = "timeline-step";
  if (c.estado === 'PENDIENTE_REVISION') {
    step3 = "active";
  } else if (c.estado === 'PRESELECCIONADO' || c.estado === 'REVISION_MANUAL') {
    step3 = "completed";
    step4 = "active";
  } else if (c.estado === 'EN_ENTREVISTA') {
    step3 = "completed";
    step4 = "completed";
  }

  resultBox.style.display = "block";
  resultBox.innerHTML = `
    <div style="background:var(--slate-bg); border-radius:var(--radius-md); padding:20px; border:1px solid var(--slate-border);">
      <div style="display:flex; justify-content:space-between; align-items:center; flex-wrap:wrap; gap:12px; margin-bottom:16px;">
        <div>
          <h3>${c.nombre}</h3>
          <span style="font-size:0.82rem; color:var(--text-muted);">${c.id} — ${c.vacante}</span>
        </div>
        ${getStatusBadge(c.estado)}
      </div>

      <div class="candidate-timeline">
        <div class="timeline-step completed">
          <div class="timeline-node"><i class="fa-solid fa-check"></i></div>
          <span class="timeline-label">Recibido</span>
        </div>
        <div class="timeline-step completed">
          <div class="timeline-node"><i class="fa-solid fa-brain"></i></div>
          <span class="timeline-label">Análisis IA</span>
        </div>
        <div class="timeline-step ${step3}">
          <div class="timeline-node"><i class="fa-solid fa-magnifying-glass"></i></div>
          <span class="timeline-label">Revisión RRHH</span>
        </div>
        <div class="timeline-step ${step4}">
          <div class="timeline-node"><i class="fa-solid fa-comments"></i></div>
          <span class="timeline-label">Entrevista</span>
        </div>
      </div>

      <div style="font-size:0.88rem; margin-top:16px; padding-top:12px; border-top:1px solid var(--slate-border); display:flex; justify-content:space-between; flex-wrap:wrap; gap:12px;">
        <span><strong>Score de Compatibilidad Objetiva:</strong> ${c.score}%</span>
        <span><strong>Fecha de Envío:</strong> ${c.fecha}</span>
      </div>
    </div>
  `;
}

/* ==========================================
   PAGE RENDERERS
   ========================================== */

// 1. DASHBOARD
function renderDashboard() {
  const statTotal = document.getElementById("stat-total-candidates");
  const statPending = document.getElementById("stat-pending-candidates");
  const statPreselected = document.getElementById("stat-preselected");
  const statInterview = document.getElementById("stat-interview");

  if (statTotal) statTotal.innerText = candidates.length;
  if (statPending) statPending.innerText = candidates.filter(c => c.estado === 'PENDIENTE_REVISION' || c.estado === 'REVISION_MANUAL').length;
  if (statPreselected) statPreselected.innerText = candidates.filter(c => c.estado === 'PRESELECCIONADO').length;
  if (statInterview) statInterview.innerText = candidates.filter(c => c.estado === 'EN_ENTREVISTA').length;

  const recentTable = document.getElementById("dashboard-recent-table");
  if (recentTable) {
    recentTable.innerHTML = "";
    candidates.slice(0, 5).forEach(c => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td><strong>${c.id}</strong></td>
        <td>
          <div class="candidate-cell">
            <div class="candidate-avatar">${c.nombre.substring(0, 2).toUpperCase()}</div>
            <div>
              <div class="candidate-name">${c.nombre}</div>
              <div style="font-size:0.75rem; color:var(--text-muted);">${c.correo}</div>
            </div>
          </div>
        </td>
        <td>${c.vacante}</td>
        <td>${c.experiencia} años</td>
        <td><span class="score-pill ${getScoreColorClass(c.score)}">${c.score}%</span></td>
        <td>${getStatusBadge(c.estado)}</td>
        <td>${c.fecha}</td>
        <td>
          <button class="btn btn-sm btn-secondary" onclick="showCandidate('${c.id}')">Ver candidato</button>
        </td>
      `;
      recentTable.appendChild(tr);
    });
  }

  initDashboardCharts();
}

// 2. CANDIDATOS
function renderCandidates() {
  const tbody = document.getElementById("candidates-full-table");
  if (!tbody) return;

  tbody.innerHTML = "";
  candidates.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${c.id}</strong></td>
      <td>
        <div class="candidate-cell">
          <div class="candidate-avatar">${c.nombre.substring(0, 2).toUpperCase()}</div>
          <div>
            <div class="candidate-name">${c.nombre}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${c.correo}</div>
          </div>
        </div>
      </td>
      <td>${c.vacante}</td>
      <td>${c.experiencia} años</td>
      <td>${c.educacion}</td>
      <td><span class="score-pill ${getScoreColorClass(c.score)}">${c.score}%</span></td>
      <td>${getStatusBadge(c.estado)}</td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="showCandidate('${c.id}')">Detalles</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const pagInfo = document.getElementById("pagination-info");
  if (pagInfo) pagInfo.innerText = `Mostrando 1-${candidates.length} de ${candidates.length} candidatos`;
}

function filterCandidatesTable() {
  const searchVal = (document.getElementById("cand-search-filter")?.value || "").toLowerCase();
  const vacancyVal = document.getElementById("cand-vacancy-filter")?.value || "";
  const statusVal = document.getElementById("cand-status-filter")?.value || "";
  const scoreVal = document.getElementById("cand-score-filter")?.value || "";

  const filtered = candidates.filter(c => {
    const matchesSearch = c.nombre.toLowerCase().includes(searchVal) || c.correo.toLowerCase().includes(searchVal);
    const matchesVacancy = vacancyVal === "" || c.vacante === vacancyVal;
    const matchesStatus = statusVal === "" || c.estado === statusVal;
    
    let matchesScore = true;
    if (scoreVal === 'high') matchesScore = c.score >= 80;
    if (scoreVal === 'mid') matchesScore = c.score >= 60 && c.score < 80;
    if (scoreVal === 'low') matchesScore = c.score < 60;

    return matchesSearch && matchesVacancy && matchesStatus && matchesScore;
  });

  const tbody = document.getElementById("candidates-full-table");
  if (!tbody) return;

  tbody.innerHTML = "";
  filtered.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${c.id}</strong></td>
      <td>
        <div class="candidate-cell">
          <div class="candidate-avatar">${c.nombre.substring(0, 2).toUpperCase()}</div>
          <div>
            <div class="candidate-name">${c.nombre}</div>
            <div style="font-size:0.75rem; color:var(--text-muted);">${c.correo}</div>
          </div>
        </div>
      </td>
      <td>${c.vacante}</td>
      <td>${c.experiencia} años</td>
      <td>${c.educacion}</td>
      <td><span class="score-pill ${getScoreColorClass(c.score)}">${c.score}%</span></td>
      <td>${getStatusBadge(c.estado)}</td>
      <td>
        <button class="btn btn-sm btn-primary" onclick="showCandidate('${c.id}')">Detalles</button>
      </td>
    `;
    tbody.appendChild(tr);
  });

  const pagInfo = document.getElementById("pagination-info");
  if (pagInfo) pagInfo.innerText = `Mostrando 1-${filtered.length} de ${filtered.length} candidatos filtrados`;
}

// 3. VACANTES
function renderVacancies() {
  const container = document.getElementById("vacancies-grid-container");
  if (!container) return;

  container.innerHTML = "";
  vacancies.forEach(v => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
        <div>
          <h3>${v.nombre}</h3>
          <span style="font-size:0.8rem; color:var(--text-muted);">Exp: ${v.experiencia}</span>
        </div>
        <span class="badge badge-status-preselected">${v.estado}</span>
      </div>

      <div style="margin-bottom:16px;">
        <p style="font-size:0.82rem; color:var(--text-muted); margin-bottom:6px;">Tecnologías clave:</p>
        <div class="skills-tags">
          ${v.tecnologias.map(t => `<span class="skill-tag">${t}</span>`).join('')}
        </div>
      </div>

      <div style="display:flex; justify-content:space-between; align-items:center; font-size:0.85rem; border-top:1px solid var(--slate-border); padding-top:12px; margin-bottom:16px;">
        <span><i class="fa-solid fa-users"></i> ${v.candidatosCount} Candidatos</span>
        <span>Score Mín: <strong>${v.scoreMin}%</strong></span>
      </div>

      <div style="display:flex; gap:8px;">
        <button class="btn btn-sm btn-secondary" style="flex:1;" onclick="showVacancyReqs('${v.nombre}')">Ver Requisitos</button>
        <button class="btn btn-sm btn-primary" style="flex:1;" onclick="filterCandidatesByVacancy('${v.nombre}')">Ver Candidatos</button>
      </div>
    `;
    container.appendChild(card);
  });
}

// 4. REVISIONES
function renderReviews() {
  const tbody = document.getElementById("reviews-table-body");
  if (!tbody) return;

  tbody.innerHTML = "";
  const pending = candidates.filter(c => c.estado === 'PENDIENTE_REVISION' || c.estado === 'REVISION_MANUAL');

  pending.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td><strong>${c.nombre}</strong><br><span style="font-size:0.75rem; color:var(--text-muted);">${c.id}</span></td>
      <td>${c.vacante}</td>
      <td><span class="score-pill ${getScoreColorClass(c.score)}">${c.score}%</span></td>
      <td>${c.habilidades.slice(0, 3).map(h => `<span class="skill-tag">${h}</span>`).join(' ')}</td>
      <td>${getStatusBadge(c.estado)}</td>
      <td>
        <div style="display:flex; gap:6px;">
          <button class="btn btn-sm btn-primary" onclick="showCandidate('${c.id}')">Revisar</button>
          <button class="btn btn-sm btn-success" onclick="updateCandidateStatus('${c.id}', 'PRESELECCIONADO')">Preseleccionar</button>
          <button class="btn btn-sm btn-warning" onclick="updateCandidateStatus('${c.id}', 'EN_ENTREVISTA')">Entrevista</button>
        </div>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

/* ==========================================
   CANDIDATE DETAIL MODAL
   ========================================== */
function showCandidate(id) {
  const c = candidates.find(item => item.id === id);
  if (!c) return;

  selectedCandidateId = c.id;
  document.getElementById("modal-cand-name").innerText = c.nombre;
  document.getElementById("modal-cand-subtitle").innerText = `${c.id} — ${c.vacante}`;
  document.getElementById("modal-cand-email").innerText = c.correo;
  document.getElementById("modal-cand-phone").innerText = c.telefono;
  document.getElementById("modal-cand-date").innerText = c.fecha;

  const scoreGauge = document.getElementById("modal-score-gauge");
  if (scoreGauge) scoreGauge.style.setProperty("--score-pct", c.score);
  document.getElementById("modal-score-val").innerText = c.score + "%";

  if (c.score >= 80) {
    document.getElementById("modal-score-label").innerText = "Compatibilidad Alta";
    document.getElementById("modal-score-desc").innerText = "Cumple la mayoría de los requisitos técnicos definidos para la vacante.";
  } else if (c.score >= 60) {
    document.getElementById("modal-score-label").innerText = "Compatibilidad Media";
    document.getElementById("modal-score-desc").innerText = "Cumple parcialmente con los requisitos. Se sugiere entrevista de nivelación.";
  } else {
    document.getElementById("modal-score-label").innerText = "Compatibilidad Baja";
    document.getElementById("modal-score-desc").innerText = "Presenta brechas de conocimiento para el perfil actual.";
  }

  document.getElementById("modal-ai-summary").innerText = c.resumen;

  const skillsContainer = document.getElementById("modal-skills-list");
  if (skillsContainer) skillsContainer.innerHTML = c.habilidades.map(h => `<span class="skill-tag">${h}</span>`).join('');

  const checklistContainer = document.getElementById("modal-checklist-container");
  if (checklistContainer) {
    checklistContainer.innerHTML = `
      <div class="checklist-item"><span>Java / Lenguaje Base</span> <span style="color:var(--green-success); font-weight:600;"><i class="fa-solid fa-check"></i> Cumple</span></div>
      <div class="checklist-item"><span>Framework Principal</span> <span style="color:var(--green-success); font-weight:600;"><i class="fa-solid fa-check"></i> Cumple</span></div>
      <div class="checklist-item"><span>Base de Datos</span> <span style="color:var(--green-success); font-weight:600;"><i class="fa-solid fa-check"></i> Cumple</span></div>
      <div class="checklist-item"><span>Herramientas DevOps (Docker/AWS)</span> <span style="color:${c.habilidades.includes('Docker') || c.habilidades.includes('AWS') ? 'var(--green-success)' : 'var(--amber-warning)'}; font-weight:600;">${c.habilidades.includes('Docker') || c.habilidades.includes('AWS') ? '<i class="fa-solid fa-check"></i> Cumple' : '<i class="fa-solid fa-minus"></i> Parcial'}</span></div>
    `;
  }

  const questionsContainer = document.getElementById("modal-questions-list");
  if (questionsContainer) {
    questionsContainer.innerHTML = c.preguntas ? c.preguntas.map(q => `<li>${q}</li>`).join('') : '<li>Explicar experiencia general en proyectos pasados.</li>';
  }

  openModal("candidate-modal");
}

function changeCandidateStatusFromModal(newStatus) {
  if (selectedCandidateId) {
    updateCandidateStatus(selectedCandidateId, newStatus);
    closeModal("candidate-modal");
  }
}

function updateCandidateStatus(id, newStatus) {
  const c = candidates.find(item => item.id === id);
  if (c) {
    c.estado = newStatus;
    saveStoredState('candidates', candidates);
    showNotification("Estado Actualizado", `Candidato ${c.nombre} actualizado a ${newStatus}`, "info");

    // Dispatch decision event to n8n
    sendN8nWebhook('decision', {
      ticket_id: c.ticket_id || c.id,
      id_candidato: c.id,
      candidato_id: c.id,
      nombre: c.nombre,
      correo: c.correo,
      vacante: c.vacante,
      score: c.score,
      nuevo_estado: newStatus,
      decision_por: 'RRHH'
    }).then(result => {
      if (result.ok) {
        showNotification('n8n', `Decisión enviada a n8n: ${c.nombre} → ${newStatus}`, 'info');
        renderWebhookLog();
      }
    });

    const page = document.body ? document.body.getAttribute('data-page') : null;
    if (page === 'dashboard') renderDashboard();
    if (page === 'candidatos') renderCandidates();
    if (page === 'revisiones') renderReviews();
  }
}

/* ==========================================
   FORM SUBMISSION & AI PROCESSING
   ========================================== */
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (file) {
    document.getElementById("pdf-filename-display").innerText = "Archivo seleccionado: " + file.name;
  }
}

function handleFormSubmit(e) {
  e.preventDefault();
  
  const name = document.getElementById("app-name").value;
  const email = document.getElementById("app-email").value;
  const phone = document.getElementById("app-phone").value;
  const vacancy = document.getElementById("app-vacancy").value;
  const exp = parseInt(document.getElementById("app-exp").value);
  const skillsInput = document.getElementById("app-skills").value;
  const skillsArray = skillsInput ? skillsInput.split(',').map(s => s.trim()) : ["General"];

  openModal("processing-modal");
  resetProcessingSteps();

  setTimeout(() => setStepCompleted("step-1", "step-2"), 1000);
  setTimeout(() => setStepCompleted("step-2", "step-3"), 2200);
  setTimeout(() => setStepCompleted("step-3", "step-4"), 3400);
  setTimeout(() => setStepCompleted("step-4", "step-5"), 4400);
  setTimeout(async () => {
    setStepCompleted("step-5", "step-6");

    const seq = candidates.length + 1;
    const ticketId = `TF-2026-${String(seq).padStart(4, '0')}`;
    const candidateId = `CAND-${String(seq).padStart(3, '0')}`;

    // Extract PDF File if attached
    const pdfFileInput = document.getElementById('app-pdf');
    const pdfFile = pdfFileInput?.files ? pdfFileInput.files[0] : null;
    let pdfBase64 = null;
    let pdfNombre = null;
    let pdfMime = null;

    if (pdfFile) {
      pdfNombre = pdfFile.name;
      pdfMime = pdfFile.type || 'application/pdf';
      try {
        pdfBase64 = await readFileAsBase64(pdfFile);
      } catch (err) {
        console.warn('Error leyendo archivo PDF:', err);
      }
    }

    // Build candidate payload for n8n
    const candidatePayload = {
      ticket_id: ticketId,
      id_candidato: candidateId,
      nombre: name,
      correo: email,
      telefono: phone,
      vacante: vacancy,
      experiencia: exp,
      experiencia_anios: exp,
      habilidades: skillsArray,
      acepta_tratamiento_datos: true,
      pdf_adjunto: pdfNombre || null,
      pdf_base64: pdfBase64 || null,
      pdf_nombre: pdfNombre || null,
      pdf_mime: pdfMime || null,
      pdf_file: pdfFile || null
    };

    // Try dispatching to n8n — if it responds with AI data, use it
    let calculatedScore = calculateScore(exp, skillsArray);
    let resumen = `Candidato registrado para la vacante ${vacancy} con ${exp} años de experiencia laboral.`;
    let habilidadesFinales = skillsArray;

    const n8nResult = await sendN8nWebhook('candidate', candidatePayload);
    if (n8nResult.ok && n8nResult.data && typeof n8nResult.data === 'object') {
      if (n8nResult.data.success === false || n8nResult.data.error === 'pdf_no_legible') {
        const errorMsg = n8nResult.data.mensaje || 'El archivo PDF adjunto no contiene texto legible (posible imagen o escaneo sin OCR).';
        showNotification('PDF No Legible', errorMsg, 'error');
        alert('⚠️ PDF No Legible:\n\n' + errorMsg + '\n\nPor favor adjunta un documento PDF que contenga texto seleccionable.');
        renderWebhookLog();
        const procContainer = document.getElementById("processing-steps");
        if (procContainer) procContainer.style.display = "none";
        return;
      }
      if (typeof n8nResult.data.compatibilidad === 'number') calculatedScore = n8nResult.data.compatibilidad;
      if (typeof n8nResult.data.score_compatibilidad === 'number') calculatedScore = n8nResult.data.score_compatibilidad;
      if (typeof n8nResult.data.observaciones === 'string') resumen = n8nResult.data.observaciones;
      if (Array.isArray(n8nResult.data.habilidades)) habilidadesFinales = n8nResult.data.habilidades;
      showNotification('n8n', 'Análisis recibido desde n8n correctamente.', 'info');
    }
    renderWebhookLog();

    const newCand = {
      id: candidateId,
      ticket_id: ticketId,
      nombre: name,
      correo: email,
      telefono: phone,
      vacante: vacancy,
      experiencia: exp,
      habilidades: habilidadesFinales,
      educacion: "Profesional",
      score: calculatedScore,
      estado: calculatedScore >= 80 ? "PRESELECCIONADO" : (calculatedScore >= 60 ? "PENDIENTE_REVISION" : "REVISION_SECUNDARIA"),
      fecha: new Date().toLocaleDateString('es-CO'),
      resumen: resumen,
      preguntas: ["Explicar principales retos técnicos afrontados en roles previos."]
    };

    candidates.unshift(newCand);
    saveStoredState('candidates', candidates);

    document.getElementById("res-generated-id").innerText = ticketId;
    document.getElementById("processing-result").style.display = "block";
    showNotification("Nueva Postulación", `Candidato ${name} registrado (${ticketId}) con Score ${calculatedScore}%`, "success");
  }, 5400);
}

function calculateScore(exp, skills) {
  let score = 50;
  score += Math.min(exp * 8, 30);
  score += Math.min(skills.length * 5, 20);
  return Math.min(score, 98);
}

function resetProcessingSteps() {
  for (let i = 1; i <= 6; i++) {
    const el = document.getElementById(`step-${i}`);
    if (el) {
      el.className = "proc-step" + (i === 1 ? " active" : "");
    }
  }
  const res = document.getElementById("processing-result");
  if (res) res.style.display = "none";
}

function setStepCompleted(currId, nextId) {
  const curr = document.getElementById(currId);
  if (curr) {
    curr.className = "proc-step completed";
    curr.querySelector(".proc-icon").innerHTML = '<i class="fa-solid fa-check"></i>';
  }

  const next = document.getElementById(nextId);
  if (next) {
    next.className = "proc-step active";
    next.querySelector(".proc-icon").innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
  }
}

/* ==========================================
   TELEGRAM BOT SIMULATOR
   ========================================== */
function sendTelegramCmd(cmd) {
  const chat = document.getElementById("telegram-chat-window");
  if (!chat) return;

  const userMsg = document.createElement("div");
  userMsg.className = "chat-msg user";
  userMsg.innerText = cmd;
  chat.appendChild(userMsg);

  let botReply = "";
  if (cmd.startsWith("/candidato")) {
    botReply = `👤 Candidato: Laura Gómez\n💼 Vacante: Backend Developer\n📊 Compatibilidad: 87%\n⭐ Experiencia: 3 años\n🛠️ Habilidades: Java, Spring Boot, PostgreSQL, Docker\n📌 Estado: PENDIENTE DE REVISIÓN`;
  } else if (cmd === "/pendientes") {
    const pendingCount = candidates.filter(c => c.estado === 'PENDIENTE_REVISION').length;
    botReply = `📋 Candidatos Pendientes de Revisión: ${pendingCount}\n- CAND-001: Laura Gómez (87%)\n- CAND-002: Carlos Rodríguez (74%)`;
  } else if (cmd === "/vacantes") {
    botReply = `💼 Vacantes Activas:\n1. Backend Developer (32 postulados)\n2. Frontend Developer (27 postulados)\n3. Data Analyst (21 postulados)`;
  } else if (cmd === "/estadisticas") {
    botReply = `📈 Estadísticas Generales:\n• Total candidatos: ${candidates.length + 120}\n• Score Promedio: 76%\n• Preseleccionados: 42`;
  } else {
    botReply = "Comando no reconocido. Prueba /candidato CAND-001, /pendientes, /vacantes o /estadisticas.";
  }

  setTimeout(() => {
    const botMsg = document.createElement("div");
    botMsg.className = "chat-msg bot";
    botMsg.innerText = botReply;
    chat.appendChild(botMsg);
    chat.scrollTop = chat.scrollHeight;
  }, 400);
}

/* ==========================================
   CHART.JS INTEGRATION
   ========================================== */
function initDashboardCharts() {
  const trendElem = document.getElementById('chart-applications-trend');
  if (trendElem) {
    const trendCtx = trendElem.getContext('2d');
    if (trendChartObj) trendChartObj.destroy();

    // Group candidates by date
    const dateCounts = {};
    candidates.forEach(c => {
      const d = c.fecha || 'Reciente';
      dateCounts[d] = (dateCounts[d] || 0) + 1;
    });

    const labels = Object.keys(dateCounts).length > 0 ? Object.keys(dateCounts) : ['Sin candidatos'];
    const dataPoints = Object.keys(dateCounts).length > 0 ? Object.values(dateCounts) : [0];

    trendChartObj = new Chart(trendCtx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'Postulaciones',
          data: dataPoints,
          borderColor: '#2563EB',
          backgroundColor: 'rgba(37, 99, 235, 0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 3
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { display: false } },
        scales: {
          y: { grid: { color: 'rgba(226, 232, 240, 0.5)' }, beginAtZero: true },
          x: { grid: { display: false } }
        }
      }
    });
  }

  const donutElem = document.getElementById('chart-distribution-donut');
  if (donutElem) {
    const donutCtx = donutElem.getContext('2d');
    if (donutChartObj) donutChartObj.destroy();

    const highCount = candidates.filter(c => c.score >= 80).length;
    const midCount = candidates.filter(c => c.score >= 60 && c.score < 80).length;
    const lowCount = candidates.filter(c => c.score < 60).length;

    donutChartObj = new Chart(donutCtx, {
      type: 'doughnut',
      data: {
        labels: ['Score Alto (>=80%)', 'Score Medio (60-79%)', 'Score Bajo (<60%)'],
        datasets: [{
          data: [highCount, midCount, lowCount],
          backgroundColor: ['#16A34A', '#F59E0B', '#DC2626'],
          borderWidth: 0
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { position: 'bottom' } }
      }
    });
  }
}

function renderMetrics() {
  const vacElem = document.getElementById('chart-metrics-vacancies');
  if (vacElem) {
    const vacCtx = vacElem.getContext('2d');
    if (metricsVacanciesChartObj) metricsVacanciesChartObj.destroy();

    metricsVacanciesChartObj = new Chart(vacCtx, {
      type: 'bar',
      data: {
        labels: vacancies.map(v => v.nombre),
        datasets: [{
          label: 'Candidatos Postulados',
          data: vacancies.map(v => candidates.filter(c => c.vacante === v.nombre).length),
          backgroundColor: '#3B82F6',
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true } }
      }
    });
  }

  const scoreElem = document.getElementById('chart-metrics-scores');
  if (scoreElem) {
    const scoreCtx = scoreElem.getContext('2d');
    if (metricsScoresChartObj) metricsScoresChartObj.destroy();

    metricsScoresChartObj = new Chart(scoreCtx, {
      type: 'bar',
      data: {
        labels: candidates.map(c => c.nombre),
        datasets: [{
          label: 'Score %',
          data: candidates.map(c => c.score),
          backgroundColor: candidates.map(c => c.score >= 80 ? '#16A34A' : (c.score >= 60 ? '#F59E0B' : '#DC2626')),
          borderRadius: 6
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100 } }
      }
    });
  }
}

/* ==========================================
   UTILITY HELPERS
   ========================================== */
function getScoreColorClass(score) {
  if (score >= 80) return "badge-score-high";
  if (score >= 60) return "badge-score-mid";
  return "badge-score-low";
}

function getStatusBadge(status) {
  switch (status) {
    case 'PENDIENTE_REVISION':
      return '<span class="badge badge-status-pending">Pendiente Revisión</span>';
    case 'REVISION_MANUAL':
      return '<span class="badge badge-status-manual">Revisión Manual</span>';
    case 'PRESELECCIONADO':
      return '<span class="badge badge-status-preselected">Preseleccionado</span>';
    case 'EN_ENTREVISTA':
      return '<span class="badge badge-status-interview">En Entrevista</span>';
    case 'REVISION_SECUNDARIA':
    case 'FINALIZADO':
      return '<span class="badge badge-status-rejected">Revisión Secundaria</span>';
    default:
      return `<span class="badge">${status}</span>`;
  }
}

function openModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.add("active");
}

function closeModal(id) {
  const m = document.getElementById(id);
  if (m) m.classList.remove("active");
}

function openPdfModal() {
  openModal("pdf-modal");
}

function copyJsonSnippet() {
  const code = document.getElementById("json-snippet")?.innerText;
  if (code) {
    navigator.clipboard.writeText(code);
    showNotification("Copiado", "JSON copiado al portapapeles", "info");
  }
}

function refreshDashboardData() {
  renderDashboard();
  showNotification("Actualizado", "Datos sincronizados", "info");
}

function filterCandidatesByVacancy(vacancyName) {
  window.location.href = `candidatos.html?vacancy=${encodeURIComponent(vacancyName)}`;
}

function showVacancyReqs(vacancyName) {
  const v = vacancies.find(item => item.nombre === vacancyName);
  if (v) {
    alert(`Requisitos para ${v.nombre}:\n\n- Experiencia: ${v.experiencia}\n- Tecnologías: ${v.tecnologias.join(', ')}\n- Score Mínimo Recomendado: ${v.scoreMin}%`);
  }
}
