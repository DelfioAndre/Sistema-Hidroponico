// ══════════════════════════════════════════════════════════════════
// SISTEMA NFT — Dashboard Firebase
// Ficheiro app.js completo — todas as funções incluídas
// ══════════════════════════════════════════════════════════════════

// ── CREDENCIAIS FIREBASE ──────────────────────────────────────────
// Substitua pela sua API Key real (Firebase Console → Configurações do projeto → Geral → Os seus apps)
const FB_API_KEY = "AIzaSyD-lfrEElCMTxDoQLLJWLcndA4MZaf5xo4";
const FB_DB_URL  = "https://sistema-hidroponico-92e17-default-rtdb.europe-west1.firebasedatabase.app";
const FB_PATH    = "sistema";

// MQTT via WebSocket seguro. Preencher com os dados do broker (ex.: HiveMQ Cloud).
// O endpoint WSS costuma usar a porta 8884 e o caminho /mqtt; confirmar no painel do broker.

const MQTT_WS_URL = "wss://broker.freemqtt.com:8084/mqtt";
const MQTT_USER = "freemqtt";
const MQTT_PASSWORD = "public";
const MQTT_BASE = "nft/prototipo-atlas-7f3a92";


// ══════════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ══════════════════════════════════════════════════════════════════
let historico = [];
let historicoSistema = [];
let historicoFiltrado = [];
let totalRegistos = 0;
let dbRef = null;
let firebaseConnected = false;
let firebaseConnecting = false;
let firebaseListenersAttached = false;
let firebaseRetryTimeout = null;
let mqttClient = null;
let mqttConnected = false;
let mqttLastState = null;
let esp32Online = false;
let ultimoEstadoAlarme = false;
let estadoBotaoAlarmeAtivo = false;
let alarmeSilenciado = false;
let pedidoSilenciarAlarme = false;
let ultimoEstadoBomba = null;
let estadoBombaESP32 = null;
let smsTestInProgress = false;
let intervaloLeituraSegundos = 10;
let gsmStatusAtual = null;
const gsmRelatorios = new Map();

let SP = {
  ph_min: 5.6, ph_max: 6.0, ph_crit_l: 5.0, ph_crit_h: 7.5,
  ec_min: 1.2, ec_max: 1.8, ec_crit_l: 0.5, ec_crit_h: 3.0,
  t_max: 24, t_crit: 30,
  t_dose_ph: 3, t_dose_ec: 5
};

const estacoesConfig = {
  'Primavera': {
    setpoints: { ph_min: 5.6, ph_max: 6.0, ph_crit_l: 5.0, ph_crit_h: 7.5, ec_min: 1.2, ec_max: 1.8, ec_crit_l: 0.5, ec_crit_h: 3.0, t_max: 24, t_crit: 30, t_dose_ph: 3, t_dose_ec: 5 },
    periodos: ['06:00', '12:00', '18:00'], duracaoIrrigacao: 15
  },
  'Verão': {
    setpoints: { ph_min: 5.8, ph_max: 6.2, ph_crit_l: 5.2, ph_crit_h: 7.2, ec_min: 1.4, ec_max: 1.9, ec_crit_l: 0.7, ec_crit_h: 2.8, t_max: 25, t_crit: 30, t_dose_ph: 3, t_dose_ec: 5 },
    periodos: ['05:30', '11:30', '17:30'], duracaoIrrigacao: 20
  },
  'Outono': {
    setpoints: { ph_min: 5.5, ph_max: 5.9, ph_crit_l: 4.8, ph_crit_h: 7.0, ec_min: 1.1, ec_max: 1.7, ec_crit_l: 0.6, ec_crit_h: 2.7, t_max: 23, t_crit: 29, t_dose_ph: 3, t_dose_ec: 5 },
    periodos: ['07:00', '13:00', '19:00'], duracaoIrrigacao: 18
  },
  'Inverno': {
    setpoints: { ph_min: 5.7, ph_max: 6.1, ph_crit_l: 5.1, ph_crit_h: 7.4, ec_min: 1.3, ec_max: 1.8, ec_crit_l: 0.6, ec_crit_h: 3.0, t_max: 22, t_crit: 28, t_dose_ph: 3, t_dose_ec: 5 },
    periodos: ['08:00', '14:00', '20:00'], duracaoIrrigacao: 22
  }
};

let estacaoActiva = 'Primavera';

// ══════════════════════════════════════════════════════════════════
// NAVEGAÇÃO ENTRE SEPARADORES
// ══════════════════════════════════════════════════════════════════
function irPara(id, el) {
  document.querySelectorAll('.section').forEach(s => s.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  const sec = document.getElementById('sec-' + id);
  if (sec) sec.classList.add('active');
  if (el) el.classList.add('active');
}

// ══════════════════════════════════════════════════════════════════
// GRÁFICOS
// ══════════════════════════════════════════════════════════════════
const MAX_PTS = 50;
let gLabels = [], gPH = [], gEC = [], gTemp = [];

const cfgBase = (label, color, data, yMin, yMax, yStep) => ({
  type: 'line',
  data: {
    labels: gLabels,
    datasets: [{
      label, data,
      borderColor: color, backgroundColor: color + '22',
      borderWidth: 2, pointRadius: 2, tension: 0.3, fill: true,
    }]
  },
  options: {
    responsive: true, maintainAspectRatio: false,
    animation: { duration: 300 },
    plugins: { legend: { display: false } },
    scales: {
      x: { grid: { color: '#E2DCCB' }, ticks: { maxTicksLimit: 8, minRotation: 45, maxRotation: 45, font: { size: 10 }, color: '#35483E' } },
      y: { min: yMin, max: yMax, grid: { color: '#E2DCCB' }, ticks: { stepSize: yStep, font: { size: 10 }, color: '#35483E' } }
    }
  }
});

const gPHChart   = new Chart(document.getElementById('g-ph'),   cfgBase('pH', '#02110C', gPH, 0, 14, 5));
const gECChart   = new Chart(document.getElementById('g-ec'),   cfgBase('EC', '#1A422F', gEC, 0, 5, 1));
const gTempChart = new Chart(document.getElementById('g-temp'), cfgBase('T°C', '#35483E', gTemp, 10, 40, 10));

const gGeralChart = new Chart(document.getElementById('g-geral'), {
  type: 'line',
  data: {
    labels: gLabels,
    datasets: [
      { label: 'pH/14', data: gPH.map(v => v / 14 * 100), borderColor: '#02110C', backgroundColor: '#02110C33', borderWidth: 2, pointRadius: 1, tension: .3, fill: true },
      { label: 'EC/5',  data: gEC.map(v => v / 5 * 100),  borderColor: '#1A422F', backgroundColor: '#1A422F55', borderWidth: 2, pointRadius: 1, tension: .3, fill: true },
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
    scales: {
      x: { grid: { color: '#E2DCCB' }, ticks: { maxTicksLimit: 8, minRotation: 45, maxRotation: 45, font: { size: 10 }, color: '#35483E' } },
      y: { min: 0, max: 100, grid: { color: '#E2DCCB' }, ticks: { font: { size: 10 }, color: '#35483E', callback: v => v + '%' } }
    }
  }
});

function actualizarGraficos(ph, ec, temp) {
  const hora = new Date().toLocaleTimeString('pt', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  gLabels.push(hora); gPH.push(ph); gEC.push(ec); gTemp.push(temp);
  if (gLabels.length > MAX_PTS) { gLabels.shift(); gPH.shift(); gEC.shift(); gTemp.shift(); }
  gGeralChart.data.datasets[0].data = gPH.map(v => +(v / 14 * 100).toFixed(1));
  gGeralChart.data.datasets[1].data = gEC.map(v => +(v / 5 * 100).toFixed(1));
  gPHChart.update(); gECChart.update(); gTempChart.update(); gGeralChart.update();
}

// ══════════════════════════════════════════════════════════════════
// ACTUALIZAÇÃO DE ESTADOS
// ══════════════════════════════════════════════════════════════════
function avaliarEstadoParametro(val, min, max, critL, critH) {
  if (val < critL || val > critH) return 'critico';
  if (val < min || val > max) return 'atencao';
  return 'normal';
}

function actualizarTudo(ph, ec, temp, ts, alarmeESP32 = null, alarmeSilenciadoESP32 = null) {
  const clPH   = avaliarEstadoParametro(ph, SP.ph_min, SP.ph_max, SP.ph_crit_l, SP.ph_crit_h);
  const clEC   = avaliarEstadoParametro(ec, SP.ec_min, SP.ec_max, SP.ec_crit_l, SP.ec_crit_h);
  const clTemp = avaliarEstadoParametro(temp, 18, SP.t_max, 0, SP.t_crit);
  const bombaLigada = typeof estadoBombaESP32 === 'boolean' ? estadoBombaESP32 : verificarHorarioBomba();

  const critico = clPH === 'critico' || clEC === 'critico' || clTemp === 'critico';
  const bannerEl = document.getElementById('banner-alerta');
  sincronizarEstadoBotaoAlarme(
    typeof alarmeESP32 === 'boolean' ? alarmeESP32 : critico,
    alarmeSilenciadoESP32
  );
  if (bannerEl) {
    if (critico && !ultimoEstadoAlarme) {
      bannerEl.classList.remove('silenciado');
    }
    bannerEl.style.display = critico ? 'flex' : 'none';
  }

  const hora = ts ? new Date(ts).toLocaleTimeString('pt') : new Date().toLocaleTimeString('pt');
  const stUlt = document.getElementById('st-ultima');
  const stReg = document.getElementById('st-registos');
  if (stUlt) stUlt.textContent = hora;
  if (stReg) stReg.textContent = totalRegistos;

  actualizarHomeMonitorizacao(ph, ec, temp, critico, bombaLigada);

  const entrada = { ts: ts || Date.now(), ph, ec, temp, ph_est: clPH, ec_est: clEC, alarme: critico };
  historico.push(entrada);
  totalRegistos++;
  historicoFiltrado = [...historicoSistema];

  registrarEvento('leitura', {
    ts: entrada.ts, ph, ec, temp, alarme: critico,
    estado: critico ? 'critico' : (clPH === 'atencao' || clEC === 'atencao' || clTemp === 'atencao' ? 'atencao' : 'normal'),
    descricao: critico ? 'Leitura crítica registada' : 'Leitura normal registada'
  });

  if (critico !== ultimoEstadoAlarme) {
    registrarEvento('alarme', {
      ts: entrada.ts, ph, ec, temp, alarme: true,
      estado: critico ? 'critico' : 'normal',
      descricao: critico ? 'Alarme activo: parâmetros fora dos limites seguros.' : 'Alarme resolvido.'
    });
    ultimoEstadoAlarme = critico;
  }

  const bombaEstado = bombaLigada ? 'ligada' : 'desligada';
  if (ultimoEstadoBomba !== bombaEstado) {
    registrarEvento('actuador', {
      ts: entrada.ts,
      descricao: `Bomba de circulação ${bombaEstado}.`,
      actuador: 'Bomba de circulação NFT',
      estado: bombaEstado, alarme: false
    });
    ultimoEstadoBomba = bombaEstado;
  }

  actualizarGraficos(ph, ec, temp);
}

function actualizarLeituraRealESP32(datos, ts = Date.now()) {
  const valores = [datos?.ph, datos?.ec, datos?.temperatura];
  if (valores.some(valor => valor === null || valor === undefined || valor === '' || !Number.isFinite(Number(valor)))) {
    console.warn('[ESP32] Leitura ignorada: pH, EC ou temperatura inválido.');
    return false;
  }

  actualizarTudo(
    Number(datos.ph),
    Number(datos.ec),
    Number(datos.temperatura),
    ts,
    typeof datos.alarme === 'boolean' ? datos.alarme : null,
    typeof datos.alarme_silenciado === 'boolean' ? datos.alarme_silenciado : null
  );
  return true;
}

function actualizarHomeMonitorizacao(ph, ec, temp, critico, bombaLigada) {
  const estacao = document.getElementById('estacao-atual');
  const modo = document.getElementById('modo-estacao');
  const janela = document.getElementById('janela-estacao');
  const statusEstacao = document.getElementById('status-estacao');
  const statusActuadores = document.getElementById('status-actuadores');
  const statusAlarmes = document.getElementById('status-alarmes');
  const listaCiclos = document.getElementById('lista-ciclos');
  const listaAlarmes = document.getElementById('lista-alarmes');
  const pumpCirculacao = document.getElementById('pump-circulacao');
  const pumpPH = document.getElementById('pump-ph');
  const pumpEC = document.getElementById('pump-ec');

  if (estacao) estacao.textContent = `${operacaoAnual.estacao || 'Estação 01'} — NFT`;
  if (modo) modo.textContent = operacaoAnual.modo || 'Automático';
  if (janela) janela.textContent = operacaoAnual.janela || '06:00 – 21:00';
  if (statusEstacao) statusEstacao.textContent = bombaLigada ? 'Ciclo activo' : 'Em espera';
  if (statusActuadores) statusActuadores.textContent = bombaLigada ? 'OK' : 'Aguardando';

  const homeBomba = document.getElementById('home-bomba-estado');
  const homePH = document.getElementById('home-ph-estado');
  const homeEC = document.getElementById('home-ec-estado');
  const homeTemp = document.getElementById('home-temp-estado');

  if (homeBomba) homeBomba.textContent = bombaLigada ? 'Ligada' : 'Desligada';
  const phEstado = ph < SP.ph_min || ph > SP.ph_max ? 'Instável' : 'Estável';
  const ecEstado = ec < SP.ec_min || ec > SP.ec_max ? 'Instável' : 'Estável';
  const tempEstado = temp < 18 || temp > SP.t_max ? 'Instável' : 'Estável';

  if (homePH) homePH.textContent = `${phEstado} · ${ph.toFixed(2)} pH`;
  if (homeEC) homeEC.textContent = `${ecEstado} · ${ec.toFixed(2)} mS/cm`;
  if (homeTemp) homeTemp.textContent = `${tempEstado} · ${temp.toFixed(1)} °C`;

  const ciclos = Array.isArray(operacaoAnual.intervalos) && operacaoAnual.intervalos.length ? operacaoAnual.intervalos : ['06:00', '12:00', '18:00'];
  if (listaCiclos) {
    listaCiclos.innerHTML = ciclos.map((item, index) => {
      const ativo = index === 0 && bombaLigada;
      return `<div class="cycle-item ${ativo ? 'active' : ''}"><span>Rega ${index + 1}</span><strong>${item}</strong></div>`;
    }).join('');
  }

  if (pumpCirculacao) {
    pumpCirculacao.textContent = bombaLigada ? 'Ligada' : 'Em espera';
    pumpCirculacao.className = bombaLigada ? '' : 'warning';
  }
  if (pumpPH) {
    pumpPH.textContent = ph < SP.ph_min || ph > SP.ph_max ? 'A dosar' : 'Normal';
    pumpPH.className = ph < SP.ph_min || ph > SP.ph_max ? 'warning' : '';
  }
  if (pumpEC) {
    pumpEC.textContent = ec < SP.ec_min ? 'A dosar' : 'Normal';
    pumpEC.className = ec < SP.ec_min ? 'warning' : '';
  }

  const alarmas = [];
  if (ph < SP.ph_min || ph > SP.ph_max) alarmas.push({ tipo: 'warn', icon: 'warning', txt: `pH fora do intervalo recomendado (${ph.toFixed(2)})` });
  if (ph < SP.ph_crit_l || ph > SP.ph_crit_h) alarmas.push({ tipo: 'alert', icon: 'notification_important', txt: `pH crítico — leitura ${ph.toFixed(2)}` });
  if (ec < SP.ec_min || ec > SP.ec_max) alarmas.push({ tipo: 'warn', icon: 'warning', txt: `EC fora do intervalo recomendado (${ec.toFixed(2)} mS/cm)` });
  if (ec < SP.ec_crit_l || ec > SP.ec_crit_h) alarmas.push({ tipo: 'alert', icon: 'notification_important', txt: `EC crítica — leitura ${ec.toFixed(2)} mS/cm` });
  if (temp > SP.t_max) alarmas.push({ tipo: 'warn', icon: 'warning', txt: `Temperatura elevada (${temp.toFixed(1)}°C)` });
  if (temp >= SP.t_crit) alarmas.push({ tipo: 'alert', icon: 'notification_important', txt: `Temperatura crítica (${temp.toFixed(1)}°C)` });
  if (!alarmas.length && !critico) alarmas.push({ tipo: 'ok', icon: 'check_circle', txt: 'Sistema em condições normais.' });

  if (listaAlarmes) {
    const prioridadeAlarme = { alert: 0, warn: 1, ok: 2 };
    const alarmasOrdenadas = [...alarmas].sort((a, b) => prioridadeAlarme[a.tipo] - prioridadeAlarme[b.tipo]);
    listaAlarmes.innerHTML = alarmasOrdenadas.map(item => {
      const classe = item.tipo === 'ok' ? 'ok-item' : item.tipo === 'warn' ? 'warn-item' : 'alert-item';
      return `<li class="${classe}"><span class="material-icon alarm-list-icon" aria-hidden="true">${item.icon}</span>${item.txt}</li>`;
    }).join('');
  }

  if (statusAlarmes) {
    statusAlarmes.textContent = alarmas.some(a => a.tipo === 'alert') ? 'Alerta' : alarmas.some(a => a.tipo === 'warn') ? 'Atenção' : 'Sem alarmes';
    statusAlarmes.classList.toggle('danger', alarmas.some(a => a.tipo === 'alert'));
  }
}

// ══════════════════════════════════════════════════════════════════
// HISTÓRICO / TABELA
// ══════════════════════════════════════════════════════════════════
function formatarEventoTipo(tipo) {
  return { leitura: 'Leitura', alarme: 'Alarme', actuador: 'Actuador', setpoint: 'Setpoint' }[tipo] || 'Evento';
}

function formatarEstadoBadge(estado) {
  if (!estado) return '<span class="pill ok">OK</span>';
  const mapa = { normal: 'ok', atencao: 'warn', critico: 'alert', ligada: 'ok', desligada: 'warn', activo: 'ok', inactivo: 'warn' };
  const key = mapa[estado.toLowerCase()] || 'ok';
  return `<span class="pill ${key}">${estado.toUpperCase()}</span>`;
}

function registrarEvento(tipo, dados = {}) {
  const evento = {
    ts: dados.ts || Date.now(), tipo,
    ph: dados.ph ?? null, ec: dados.ec ?? null, temp: dados.temp ?? null,
    alarme: Boolean(dados.alarme),
    estado: dados.estado || 'normal',
    actuador: dados.actuador || '',
    descricao: dados.descricao || '',
    detalhe: dados.detalhe || ''
  };
  historicoSistema.push(evento);
  historicoFiltrado = [...historicoSistema];
  renderTabela(historicoFiltrado);
}

function renderTabela(dados) {
  const tbody = document.getElementById('corpo-tabela');
  const totalEl = document.getElementById('total-registos');
  if (totalEl) totalEl.textContent = dados.length + ' registo(s)';
  if (!tbody) return;
  if (!dados.length) {
    tbody.innerHTML = '<tr><td colspan="8" class="empty">Sem dados para o filtro seleccionado.</td></tr>';
    return;
  }
  const ultimos = dados.slice(-200).reverse();
  tbody.innerHTML = ultimos.map(r => {
    const dt = new Date(r.ts).toLocaleString('pt', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const tipo = formatarEventoTipo(r.tipo);
    const ph = r.ph != null ? r.ph.toFixed(2) : '--';
    const ec = r.ec != null ? r.ec.toFixed(2) : '--';
    const temp = r.temp != null ? r.temp.toFixed(1) : '--';
    const estado = r.estado ? formatarEstadoBadge(r.estado) : '<span class="pill ok">OK</span>';
    const alarme = `<span class="pill ${r.alarme ? 'alert' : 'ok'}">${r.alarme ? 'SIM' : 'NÃO'}</span>`;
    const detalhes = r.descricao || r.detalhe || (r.actuador ? `${r.actuador} ${r.estado || ''}` : '');
    return `<tr>
      <td>${dt}</td><td><strong>${tipo}</strong></td><td>${ph}</td><td>${ec}</td>
      <td>${temp}</td><td>${estado}</td><td>${alarme}</td><td>${detalhes || '—'}</td>
    </tr>`;
  }).join('');
}

function setHistoricoCategoria(tipo) {
  const select = document.getElementById('filtro-param');
  if (select) select.value = tipo;
  document.querySelectorAll('.history-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.historico === tipo);
  });
  filtrarHistorico();
}

function filtrarHistorico() {
  const ini = document.getElementById('data-ini')?.value;
  const fim = document.getElementById('data-fim')?.value;
  const param = document.getElementById('filtro-param')?.value || 'leitura';
  let dados = [...historicoSistema];
  if (ini) dados = dados.filter(r => new Date(r.ts) >= new Date(ini));
  if (fim) dados = dados.filter(r => new Date(r.ts) <= new Date(fim + 'T23:59:59'));
  if (param !== 'todos') dados = dados.filter(r => r.tipo === param);
  historicoFiltrado = dados;
  renderTabela(dados);
}

function limparHistorico() {
  if (!confirm('Limpar todo o histórico local?')) return;
  historico = []; historicoSistema = []; historicoFiltrado = []; totalRegistos = 0;
  renderTabela([]);
}

function getLeiturasHistorico() {
  return historicoSistema.filter(r => r.tipo === 'leitura');
}

// ══════════════════════════════════════════════════════════════════
// EXPORTAÇÃO PDF
// ══════════════════════════════════════════════════════════════════
function exportarPDF() {
  if (!historicoFiltrado.length) { alert('Sem dados para exportar.'); return; }
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF('landscape');
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginX = 8;
  const startY = 18;
  const rowHeight = 7;
  const cols = [
    { title: 'Data/Hora', width: 34 }, { title: 'Tipo', width: 18 },
    { title: 'pH', width: 14 }, { title: 'EC', width: 16 }, { title: 'Temp', width: 16 },
    { title: 'Estado', width: 18 }, { title: 'Alarme', width: 16 }, { title: 'Detalhes', width: 60 }
  ];
  const colPositions = [];
  let currentX = marginX;
  cols.forEach(col => { colPositions.push({ x: currentX, width: col.width }); currentX += col.width; });

  const getCellX = (index) => {
    const before = colPositions.slice(0, index).reduce((sum, item) => sum + item.width, 0);
    return marginX + before;
  };

  doc.setFillColor(15, 118, 110);
  doc.rect(0, 0, pageWidth, 18, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFontSize(14);
  doc.setFont(undefined, 'bold');
  doc.text('Relatório — Sistema Hidropónico NFT', 12, 12);

  const linhas = historicoFiltrado.slice(-500).map(r => ({
    data: new Date(r.ts).toLocaleString('pt'),
    tipo: formatarEventoTipo(r.tipo),
    ph: r.ph != null ? r.ph.toFixed(2) : '--',
    ec: r.ec != null ? r.ec.toFixed(2) : '--',
    temp: r.temp != null ? r.temp.toFixed(1) : '--',
    estado: (r.estado || 'normal').toUpperCase(),
    alarme: r.alarme ? 'SIM' : 'NÃO',
    detalhes: (r.descricao || r.detalhe || r.actuador || '—').slice(0, 100)
  }));

  let y = startY;
  doc.setDrawColor(148, 163, 184);
  doc.setTextColor(255, 255, 255);
  doc.setFillColor(30, 64, 175);
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  cols.forEach((col, index) => {
    const x = getCellX(index);
    doc.rect(x, y, col.width, rowHeight, 'FD');
    doc.text(col.title, x + 2, y + 5);
  });
  y += rowHeight;
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(6.5);

  linhas.forEach((linha, index) => {
    if (y > pageHeight - 18) {
      doc.addPage();
      y = 16;
    }
    const rowValues = [linha.data, linha.tipo, linha.ph, linha.ec, linha.temp, linha.estado, linha.alarme, linha.detalhes];
    const rowColor = index % 2 === 0 ? [245, 248, 250] : [255, 255, 255];
    doc.setFillColor(...rowColor);
    cols.forEach((col, colIndex) => {
      const x = getCellX(colIndex);
      doc.rect(x, y, col.width, rowHeight, 'FD');
      doc.text(String(rowValues[colIndex]), x + 2, y + 5, { maxWidth: col.width - 4 });
    });
    y += rowHeight;
  });
  doc.save('relatorio_nft_' + new Date().toISOString().slice(0, 10) + '.pdf');
}

function aplicarBordasExcel(ws, linhas, colunas) {
  const borderStyle = {
    top: { style: 'thin', color: { rgb: 'FFB7BDC7' } },
    bottom: { style: 'thin', color: { rgb: 'FFB7BDC7' } },
    left: { style: 'thin', color: { rgb: 'FFB7BDC7' } },
    right: { style: 'thin', color: { rgb: 'FFB7BDC7' } }
  };

  const totalLinhas = linhas.length + 1;
  for (let row = 1; row <= totalLinhas; row += 1) {
    for (let col = 1; col <= colunas; col += 1) {
      const cellRef = XLSX.utils.encode_cell({ r: row - 1, c: col - 1 });
      const cell = ws[cellRef] || { t: 's', v: '' };
      cell.s = { ...cell.s, border: borderStyle };
      ws[cellRef] = cell;
    }
  }

  if (ws['!ref']) {
    const range = XLSX.utils.decode_range(ws['!ref']);
    range.s.c = 0;
    range.s.r = 0;
    ws['!autofilter'] = { ref: XLSX.utils.encode_range(range) };
  }
}

// ══════════════════════════════════════════════════════════════════
// EXPORTAÇÃO EXCEL
// ══════════════════════════════════════════════════════════════════
function exportarExcel() {
  const leituras = getLeiturasHistorico();
  if (!leituras.length) { alert('Sem leituras registadas para exportar.'); return; }
  const cabecalho = [['Data/Hora', 'Tipo', 'pH', 'EC (mS/cm)', 'Temperatura (°C)', 'Estado', 'Alarme', 'Detalhes']];
  const linhas = leituras.map(r => [
    new Date(r.ts).toLocaleString('pt'),
    formatarEventoTipo(r.tipo),
    r.ph != null ? Number(r.ph).toFixed(2) : '--',
    r.ec != null ? Number(r.ec).toFixed(2) : '--',
    r.temp != null ? Number(r.temp).toFixed(1) : '--',
    (r.estado || 'normal').toUpperCase(),
    r.alarme ? 'SIM' : 'NÃO',
    (r.descricao || r.detalhe || r.actuador || '—')
  ]);
  const ws = XLSX.utils.aoa_to_sheet(cabecalho.concat(linhas));
  ws['!cols'] = [{ wch: 22 }, { wch: 14 }, { wch: 12 }, { wch: 14 }, { wch: 16 }, { wch: 16 }, { wch: 12 }, { wch: 38 }];

  const headerRange = XLSX.utils.decode_range(ws['!ref']);
  for (let c = headerRange.s.c; c <= headerRange.e.c; c += 1) {
    for (let r = headerRange.s.r; r <= headerRange.e.r; r += 1) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref] || { t: 's', v: '' };
      cell.s = {
        ...(cell.s || {}),
        fill: { fgColor: { rgb: 'FFDBEAFE' } },
        font: { bold: true, color: { rgb: 'FF0F172A' } },
        alignment: { vertical: 'center', horizontal: 'center' },
        border: {
          top: { style: 'thin', color: { rgb: 'FF94A3B8' } },
          bottom: { style: 'thin', color: { rgb: 'FF94A3B8' } },
          left: { style: 'thin', color: { rgb: 'FF94A3B8' } },
          right: { style: 'thin', color: { rgb: 'FF94A3B8' } }
        }
      };
      ws[ref] = cell;
    }
  }

  const dataRange = XLSX.utils.decode_range(ws['!ref']);
  for (let r = 1; r <= dataRange.e.r; r += 1) {
    for (let c = 0; c <= dataRange.e.c; c += 1) {
      const ref = XLSX.utils.encode_cell({ r, c });
      const cell = ws[ref] || { t: 's', v: '' };
      cell.s = {
        ...(cell.s || {}),
        border: {
          top: { style: 'thin', color: { rgb: 'FFB7BDC7' } },
          bottom: { style: 'thin', color: { rgb: 'FFB7BDC7' } },
          left: { style: 'thin', color: { rgb: 'FFB7BDC7' } },
          right: { style: 'thin', color: { rgb: 'FFB7BDC7' } }
        },
        alignment: { vertical: 'center', wrapText: true }
      };
      ws[ref] = cell;
    }
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Histórico NFT');
  XLSX.writeFile(wb, 'historico_nft_' + new Date().toISOString().slice(0, 10) + '.xlsx');
}

// ══════════════════════════════════════════════════════════════════
// SETPOINTS
// ══════════════════════════════════════════════════════════════════
function atualizarCamposSetpoints() {
  const set = (id, v) => { const el = document.getElementById(id); if (el) el.value = v; };
  set('sp-ph-min', SP.ph_min); set('sp-ph-max', SP.ph_max);
  set('sp-ph-crit-l', SP.ph_crit_l); set('sp-ph-crit-h', SP.ph_crit_h);
  set('sp-ec-min', SP.ec_min); set('sp-ec-max', SP.ec_max);
  set('sp-ec-crit-l', SP.ec_crit_l); set('sp-ec-crit-h', SP.ec_crit_h);
  set('sp-t-max', SP.t_max); set('sp-t-crit', SP.t_crit);
  set('sp-t-ph', SP.t_dose_ph); set('sp-t-ec', SP.t_dose_ec);
  const spPh = document.getElementById('sp-ph');
  const spEc = document.getElementById('sp-ec');
  if (spPh) spPh.textContent = `Setpoint: ${SP.ph_min} – ${SP.ph_max}`;
  if (spEc) spEc.textContent = `Setpoint: ${SP.ec_min} – ${SP.ec_max}`;
}

function carregarConfigEstacao(nome) {
  const chave = nome || 'Primavera';
  estacaoActiva = chave;
  const cfg = estacoesConfig[chave] || estacoesConfig['Primavera'];
  Object.assign(SP, cfg.setpoints);
  atualizarCamposSetpoints();

  const periodos = cfg.periodos || ['06:00', '12:00', '18:00'];
  const numIrrig = document.getElementById('num-irrigacoes');
  if (numIrrig) numIrrig.value = periodos.length || 3;
  renderPeriodosIrrigacao();
  Array.from({ length: periodos.length }, (_, i) => {
    const input = document.getElementById(`periodo-${i + 1}`);
    if (input) input.value = periodos[i] || '06:00';
  });
  const durIrrig = document.getElementById('duracao-irrigacao');
  if (durIrrig) durIrrig.value = cfg.duracaoIrrigacao || 15;
  const selEst = document.getElementById('sel-estacao-config');
  if (selEst) selEst.value = chave;
  const opEstacao = document.getElementById('op-estacao');
  if (opEstacao) opEstacao.value = chave;

  if (typeof operacaoAnual !== 'undefined') {
    operacaoAnual.estacao = chave;
    operacaoAnual.intervalos = [...periodos];
    operacaoAnual.intervaloDuracao = Number(cfg.duracaoIrrigacao || 15);
    renderOperacaoSlots();
    syncOperacaoUI();
  }
}

function guardarConfigEstacao() {
  if (!estacaoActiva) return;
  const cfg = estacoesConfig[estacaoActiva] || { setpoints: {}, periodos: [], duracaoIrrigacao: 15 };
  cfg.setpoints = {
    ph_min: parseFloat(document.getElementById('sp-ph-min').value),
    ph_max: parseFloat(document.getElementById('sp-ph-max').value),
    ph_crit_l: parseFloat(document.getElementById('sp-ph-crit-l').value),
    ph_crit_h: parseFloat(document.getElementById('sp-ph-crit-h').value),
    ec_min: parseFloat(document.getElementById('sp-ec-min').value),
    ec_max: parseFloat(document.getElementById('sp-ec-max').value),
    ec_crit_l: parseFloat(document.getElementById('sp-ec-crit-l').value),
    ec_crit_h: parseFloat(document.getElementById('sp-ec-crit-h').value),
    t_max: parseFloat(document.getElementById('sp-t-max').value),
    t_crit: parseFloat(document.getElementById('sp-t-crit').value),
    t_dose_ph: parseFloat(document.getElementById('sp-t-ph').value),
    t_dose_ec: parseFloat(document.getElementById('sp-t-ec').value)
  };
  const total = Math.max(1, Math.min(12, Number(document.getElementById('num-irrigacoes').value || 3)));
  cfg.periodos = Array.from({ length: total }, (_, i) => document.getElementById(`periodo-${i + 1}`)?.value || '06:00');
  cfg.duracaoIrrigacao = parseInt(document.getElementById('duracao-irrigacao').value || 15, 10);
  Object.assign(SP, cfg.setpoints);
  atualizarCamposSetpoints();
  if (operacaoAnual.estacao === estacaoActiva) {
    operacaoAnual.intervalos = [...cfg.periodos];
    operacaoAnual.intervaloDuracao = cfg.duracaoIrrigacao;
    syncOperacaoUI();
    guardarPlanoOperacao();
    publicarConfiguracaoOperacaoMQTT();
  }
  if (dbRef && firebaseConnected) {
    dbRef.ref(FB_PATH + '/configuracao/estacoes/' + estacaoActiva).set({...cfg, actualizadoEm: firebase.database.ServerValue.TIMESTAMP}).catch(e => console.error('[Firebase] Configuração da estação não guardada:', e));
    dbRef.ref(FB_PATH + '/setpoints').set(cfg.setpoints).catch(e => console.error('[Firebase] Setpoints activos não guardados:', e));
  }
  try { localStorage.setItem('nft-estacoes-config', JSON.stringify(estacoesConfig)); } catch (_) {}
  alert(`✅ Configuração guardada para ${estacaoActiva}${firebaseConnected ? ' no Firebase' : ' localmente'}.`);
}

function guardarSetpoints(tipo) {
  if (tipo === 'gsm') {
    const inputNumero = document.getElementById('sp-gsm-num');
    const numero = (inputNumero?.value || '').replace(/[\s()-]/g, '');
    if (!/^\+\d{8,15}$/.test(numero)) {
      alert('Introduza um número GSM válido com indicativo internacional, por exemplo: +258871234567.');
      return;
    }

    let erroArmazenamentoLocal = null;
    try {
      localStorage.setItem('gsmNumeroOperador', numero);
    } catch (err) {
      console.error('Não foi possível guardar o número GSM neste navegador:', err);
      erroArmazenamentoLocal = err;
    }

    if (inputNumero) inputNumero.value = numero;
    if (!dbRef) {
      if (erroArmazenamentoLocal) {
        alert('Não foi possível guardar o número GSM: ' + erroArmazenamentoLocal.message);
        return;
      }
      alert('✅ Número GSM guardado neste navegador.\nLigue ao Firebase para o guardar também no sistema.');
      return;
    }

    dbRef.ref(FB_PATH + '/gsm/numero').set(numero)
      .then(() => alert(erroArmazenamentoLocal
        ? '✅ Número GSM guardado no Firebase, mas não neste navegador: ' + erroArmazenamentoLocal.message
        : '✅ Número GSM guardado no Firebase.'))
      .catch(err => {
        console.error('Não foi possível guardar o número GSM no Firebase:', err);
        alert('❌ Não foi possível guardar o número GSM no Firebase: ' + err.message +
              (erroArmazenamentoLocal ? '' : '\nO número continua guardado neste navegador.'));
      });
    return;
  }

  if (tipo === 'ph') {
    SP.ph_min = parseFloat(document.getElementById('sp-ph-min').value);
    SP.ph_max = parseFloat(document.getElementById('sp-ph-max').value);
    SP.ph_crit_l = parseFloat(document.getElementById('sp-ph-crit-l').value);
    SP.ph_crit_h = parseFloat(document.getElementById('sp-ph-crit-h').value);
  } else if (tipo === 'ec') {
    SP.ec_min = parseFloat(document.getElementById('sp-ec-min').value);
    SP.ec_max = parseFloat(document.getElementById('sp-ec-max').value);
    SP.ec_crit_l = parseFloat(document.getElementById('sp-ec-crit-l').value);
    SP.ec_crit_h = parseFloat(document.getElementById('sp-ec-crit-h').value);
  } else if (tipo === 'temp') {
    SP.t_max = parseFloat(document.getElementById('sp-t-max').value);
    SP.t_crit = parseFloat(document.getElementById('sp-t-crit').value);
    SP.t_dose_ph = parseFloat(document.getElementById('sp-t-ph').value);
    SP.t_dose_ec = parseFloat(document.getElementById('sp-t-ec').value);
  }

  const setpointsFB = {
    ph_min: SP.ph_min, ph_max: SP.ph_max, ph_crit_l: SP.ph_crit_l, ph_crit_h: SP.ph_crit_h,
    ec_min: SP.ec_min, ec_max: SP.ec_max, ec_crit_l: SP.ec_crit_l, ec_crit_h: SP.ec_crit_h,
    t_max: SP.t_max, t_crit: SP.t_crit,
    t_dose_ph: SP.t_dose_ph || 3, t_dose_ec: SP.t_dose_ec || 5
  };
  if (estacoesConfig[estacaoActiva]) {
    estacoesConfig[estacaoActiva].setpoints = {...setpointsFB};
    if (operacaoAnual.estacao === estacaoActiva) publicarConfiguracaoOperacaoMQTT();
  }

  if (dbRef) {
    dbRef.ref(FB_PATH + '/setpoints').set(setpointsFB)
      .then(() => alert('✅ Setpoints guardados no Firebase! O ESP32 vai aplicar em até 10s.'))
      .catch(err => alert('❌ Erro ao guardar no Firebase: ' + err.message));
  } else {
    alert('✅ Setpoints actualizados localmente.\n(Ligue ao Firebase para guardar permanentemente.)');
  }
}

function testarSMS() {
  const statusEl = document.getElementById('gsm-test-status');
  const button = document.getElementById('btn-test-sms');
  const inputNumero = document.getElementById('sp-gsm-num');
  const numero = (inputNumero?.value || '').replace(/[\s()-]/g, '');
  if (!/^\+\d{8,15}$/.test(numero)) {
    if (statusEl) statusEl.textContent = 'Introduza e guarde um número válido com indicativo internacional.';
    return;
  }
  if (smsTestInProgress) return;
  if (!publicarComandoMQTT('gsm_teste', numero)) return;
  smsTestInProgress = true;
  if (button) button.disabled = true;
  if (statusEl) statusEl.textContent = 'Pedido enviado por MQTT; aguardar resultado do ESP32...';
  setTimeout(() => { smsTestInProgress = false; if (button) button.disabled = false; }, 90000);
  if (dbRef && firebaseConnected) {
    dbRef.ref(FB_PATH + '/gsm/test/request').set({id: String(Date.now()), numero, origem: 'dashboard-mqtt', timestamp: firebase.database.ServerValue.TIMESTAMP})
      .catch(err => console.error('[Firebase] Não guardou o pedido de teste GSM:', err));
  }
}
function actualizarCicloLeituraUI() {
  const input = document.getElementById('intervalo-leitura-segundos');
  const status = document.getElementById('st-ciclo-leitura');
  if (input) input.value = intervaloLeituraSegundos;
  if (status) status.textContent = `${intervaloLeituraSegundos} segundos`;
}

function guardarCicloLeitura() {
  const input = document.getElementById('intervalo-leitura-segundos');
  const status = document.getElementById('intervalo-leitura-status');
  const valor = Number(input?.value);
  if (!Number.isInteger(valor) || valor < 5 || valor > 3600) {
    if (status) status.textContent = 'Escolha um intervalo inteiro entre 5 e 3600 segundos.';
    return;
  }

  intervaloLeituraSegundos = valor;
  actualizarCicloLeituraUI();
  let erroArmazenamentoLocal = null;
  try {
    localStorage.setItem('intervaloLeituraSegundos', String(valor));
  } catch (err) {
    console.error('Não foi possível guardar o ciclo de leituras neste navegador:', err);
    erroArmazenamentoLocal = err;
  }

  if (!dbRef) {
    if (erroArmazenamentoLocal) {
      if (status) status.textContent = 'Não foi possível guardar: ' + erroArmazenamentoLocal.message;
      return;
    }
    if (status) status.textContent = `Ciclo de ${valor} segundos guardado neste navegador. Ligue o Firebase para aplicar no ESP32.`;
    return;
  }

  dbRef.ref(FB_PATH + '/configuracao/intervaloLeituraSegundos').set(valor)
    .then(() => {
      if (status) status.textContent = erroArmazenamentoLocal
        ? `Ciclo de ${valor} segundos guardado no Firebase; não foi guardado neste navegador: ${erroArmazenamentoLocal.message}`
        : `Ciclo de ${valor} segundos guardado. O ESP32 aplica a alteração no próximo ciclo.`;
    })
    .catch(err => {
      console.error('Não foi possível guardar o ciclo de leituras no Firebase:', err);
      if (status) status.textContent = 'Falha ao guardar no Firebase: ' + err.message +
        (erroArmazenamentoLocal ? '' : ' O valor foi mantido neste navegador.');
    });
}

function formatarDataRelatorioGSM(timestamp) {
  const valor = Number(timestamp);
  return Number.isFinite(valor) && valor > 0
    ? new Date(valor).toLocaleString('pt', { dateStyle: 'short', timeStyle: 'medium' })
    : '--';
}

function actualizarRelatorioGSMUI() {
  const badge = document.getElementById('st-gsm');
  const resumo = document.getElementById('gsm-relatorio-atual');
  if (!gsmStatusAtual) {
    if (badge) badge.textContent = 'Sem relatório do ESP32';
    if (resumo) resumo.textContent = 'Sem dados reais recebidos. Confirme que o ESP32 está ligado e usa o firmware com diagnóstico GSM.';
    return;
  }

  const estado = gsmStatusAtual.estado || 'Estado desconhecido';
  const sinalRssi = Number(gsmStatusAtual.sinalRssi);
  const sinalDbm = Number(gsmStatusAtual.sinalDbm);
  const sinal = sinalRssi >= 0 && sinalRssi <= 31
    ? `CSQ ${sinalRssi}/31 (~${sinalDbm} dBm)`
    : 'Sem leitura';
  const timestamp = Number(gsmStatusAtual.timestamp);
  const desactualizado = !Number.isFinite(timestamp) || Date.now() - timestamp > 120000;
  if (badge) badge.textContent = desactualizado ? 'Relatório desactualizado' : estado;
  if (resumo) {
    const sms = gsmStatusAtual.ultimoSms || {};
    const ultimoSms = sms.estado && sms.estado !== 'Sem envio registado'
      ? ` Último SMS: ${sms.estado}${sms.numero ? ` para ${sms.numero}` : ''}${sms.detalhe ? ` — ${sms.detalhe}` : ''}.`
      : ' Ainda não há envio de SMS registado.';
    resumo.textContent = `${desactualizado ? 'Sem actualização recente. ' : ''}Módulo: ${gsmStatusAtual.moduloRespondendo ? 'a responder' : 'sem resposta'}; SIM: ${gsmStatusAtual.simPronto ? 'pronto' : 'não pronto'}; rede: ${gsmStatusAtual.rede || 'desconhecida'}; sinal: ${sinal}. ${gsmStatusAtual.detalhe || ''}${ultimoSms} Última verificação: ${formatarDataRelatorioGSM(timestamp)}.`;
  }
}

function renderRelatoriosGSM() {
  const tbody = document.getElementById('gsm-relatorios-corpo');
  if (!tbody) return;
  const relatorios = Array.from(gsmRelatorios.values())
    .sort((a, b) => Number(b.timestamp || 0) - Number(a.timestamp || 0))
    .slice(0, 20);
  tbody.replaceChildren();
  if (!relatorios.length) {
    const row = tbody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 5;
    cell.className = 'empty';
    cell.textContent = 'Sem relatórios recebidos do ESP32.';
    return;
  }

  relatorios.forEach(relatorio => {
    const row = tbody.insertRow();
    const sinalRssi = Number(relatorio.sinalRssi);
    const sinalDbm = Number(relatorio.sinalDbm);
    const sinal = sinalRssi >= 0 && sinalRssi <= 31 ? `CSQ ${sinalRssi}/31 (~${sinalDbm} dBm)` : 'Sem leitura';
    const destino = relatorio.numero ? ` Número: ${relatorio.numero}.` : '';
    const campos = [
      formatarDataRelatorioGSM(relatorio.timestamp),
      relatorio.tipo === 'sms' ? 'SMS' : 'Diagnóstico',
      `${relatorio.estado || 'Estado desconhecido'} / ${relatorio.rede || 'Rede desconhecida'} / SIM ${relatorio.sim || 'desconhecido'}`,
      sinal,
      `${relatorio.resultado || ''}${relatorio.detalhe ? ` — ${relatorio.detalhe}` : ''}${destino}`
    ];
    campos.forEach(valor => {
      const cell = row.insertCell();
      cell.textContent = valor;
    });
  });
}

// ══════════════════════════════════════════════════════════════════
// MQTT — CANAL DE COMANDOS EM TEMPO REAL (Firebase continua como base de dados)
// ══════════════════════════════════════════════════════════════════
function ligarMQTT() {
  if (typeof mqtt === 'undefined') {
    console.error('[MQTT] Biblioteca mqtt.js não carregada.');
    return;
  }
  if (!MQTT_WS_URL.startsWith('wss://') || MQTT_WS_URL.includes('COLOQUE_') || MQTT_USER.includes('COLOQUE_')) {
    console.warn('[MQTT] Preencha URL WSS, utilizador e senha do broker no início de app.js.');
    return;
  }
  try { if (mqttClient) mqttClient.end(true); } catch (_) {}
  mqttClient = mqtt.connect(MQTT_WS_URL, {
    username: MQTT_USER, password: MQTT_PASSWORD,
    clientId: 'nft-dashboard-' + Math.random().toString(16).slice(2, 10),
    clean: true, connectTimeout: 10000, reconnectPeriod: 3000,
    keepalive: 30
  });
  mqttClient.on('connect', () => {
    mqttConnected = true;
    console.log('[MQTT] Dashboard ligado ao broker.');
    mqttClient.subscribe(`${MQTT_BASE}/estado/#`, { qos: 1 });
    mqttClient.subscribe(`${MQTT_BASE}/resposta/#`, { qos: 1 });
    publicarConfiguracaoOperacaoMQTT();
    const st = document.getElementById('st-wifi');
    if (st) st.textContent = 'MQTT ligado';
    atualizarEstadoConexao();
  });
  mqttClient.on('reconnect', () => { mqttConnected = false; console.warn('[MQTT] A reconectar...'); });
  mqttClient.on('close', () => { mqttConnected = false; atualizarEstadoConexao(); });
  mqttClient.on('error', err => console.error('[MQTT] Erro:', err.message));
  mqttClient.on('message', (topic, bytes) => {
    const texto = bytes.toString();
    console.log(`[MQTT RX] ${topic}: ${texto}`);
    if (topic === `${MQTT_BASE}/estado/ligacao`) {
      const estadoLigacao = texto.trim().toLowerCase();
      if (estadoLigacao === 'online' || estadoLigacao === 'offline') {
        esp32Online = estadoLigacao === 'online';
        atualizarEstadoConexao();
      } else {
        console.warn('[MQTT] Estado de ligação do ESP32 desconhecido:', texto);
      }
    } else if (topic === `${MQTT_BASE}/estado/actuadores`) {
      try {
        const a = JSON.parse(texto); mqttLastState = a;
        if (typeof a.modo_automatico === 'boolean') {
          operacaoAnual.modo = a.modo_automatico ? 'Automático' : 'Manual';
          syncOperacaoUI();
        }
        if (typeof a.estacao === 'string' && estacoesConfig[a.estacao]) {
          operacaoAnual.estacao = a.estacao;
          const seletorEstacao = document.getElementById('op-estacao');
          if (seletorEstacao) seletorEstacao.value = a.estacao;
        }
        if (typeof a.alarme === 'boolean') {
          sincronizarEstadoBotaoAlarme(
            a.alarme,
            typeof a.alarme_silenciado === 'boolean' ? a.alarme_silenciado : null
          );
        }
        const bomba = document.getElementById('op-bomba-circulacao');
        if (bomba && typeof a.bomba_circulacao === 'boolean') {
          bomba.checked = a.bomba_circulacao;
          estadoBombaESP32 = a.bomba_circulacao;
          operacaoAnual.bombaCirculacao = a.bomba_circulacao;
          const home = document.getElementById('home-bomba-estado');
          if (home) home.textContent = a.bomba_circulacao ? 'Ligada' : 'Desligada';
          syncOperacaoUI();
        }
        if (dbRef && firebaseConnected) dbRef.ref(FB_PATH + '/actuadores').set({...a, origem: 'mqtt', timestamp: firebase.database.ServerValue.TIMESTAMP}).catch(e => console.error('[Firebase] Estado MQTT não guardado:', e));
      } catch (e) { console.error('[MQTT] Estado de actuadores inválido:', e); }
    } else if (topic === `${MQTT_BASE}/estado/sensores`) {
      try {
        const d = JSON.parse(texto);
        if (!firebaseConnected && esp32Online) actualizarLeituraRealESP32(d);
        if (dbRef && firebaseConnected) {
          dbRef.ref(FB_PATH + '/actual').update({...d, origem: 'mqtt', timestamp: firebase.database.ServerValue.TIMESTAMP}).catch(e => console.error('[Firebase] Telemetria MQTT não guardada:', e));
        }
      } catch (e) { console.error('[MQTT] Telemetria inválida:', e); }
    } else if (topic === `${MQTT_BASE}/estado/gsm`) {
      try {
        const d = JSON.parse(texto);
        const statusEl = document.getElementById('gsm-test-status');
        if (statusEl) statusEl.textContent = d.status === 'sent' ? 'ESP32 submeteu o SMS ao módulo GSM; a entrega final depende da rede móvel.' : `Falha no teste GSM: ${d.message || d.status}`;
        smsTestInProgress = false;
        const smsButton = document.getElementById('btn-test-sms'); if (smsButton) smsButton.disabled = false;
        if (dbRef && firebaseConnected) dbRef.ref(FB_PATH + '/gsm/test/status').set({...d, timestamp: firebase.database.ServerValue.TIMESTAMP}).catch(e => console.error(e));
      } catch (e) { console.error('[MQTT] Estado GSM inválido:', e); }
    } else if (topic.startsWith(`${MQTT_BASE}/resposta/`)) {
      const respostaAlarme = texto.trim().toLowerCase();
      if (respostaAlarme === 'alarme:silenciado' && estadoBotaoAlarmeAtivo) {
        sincronizarEstadoBotaoAlarme(true, true);
      } else if (respostaAlarme === 'alarme:reactivado' && estadoBotaoAlarmeAtivo) {
        sincronizarEstadoBotaoAlarme(true, false);
      }
      const pill = document.getElementById('op-status-pill');
      if (pill) pill.textContent = texto;
      if (dbRef && firebaseConnected) dbRef.ref(FB_PATH + '/eventos/comandos').push({mensagem: texto, topico: topic, timestamp: firebase.database.ServerValue.TIMESTAMP}).catch(e => console.error('[Firebase] Não guardou evento MQTT:', e));
    }
  });
}

function publicarComandoMQTT(nome, valor, retain = false) {
  if (!mqttClient || !mqttConnected) {
    alert('MQTT não está ligado. Verifique URL, credenciais e estado do broker.');
    console.error('[MQTT] Comando não enviado:', nome, valor);
    return false;
  }
  const topico = `${MQTT_BASE}/comando/${nome}`;
  mqttClient.publish(topico, String(valor), { qos: 1, retain }, err => {
    if (err) {
      console.error('[MQTT] Falha no envio:', err);
      alert('Falha ao enviar comando MQTT: ' + err.message);
      if (nome === 'silenciar_alarme') {
        pedidoSilenciarAlarme = false;
        atualizarIconeSilenciarAlarme();
      }
    }
    else {
      console.log(`[MQTT TX] ${topico} <= ${valor}`);
      const pill = document.getElementById('op-status-pill');
      if (pill) pill.textContent = `Enviado: ${nome} — a aguardar ESP32`;
    }
  });
  return true;
}

// ══════════════════════════════════════════════════════════════════
// FIREBASE — ligação + listeners
// ══════════════════════════════════════════════════════════════════
function ligarFirebase(silencioso = false) {
  if (firebaseConnecting) return;

  const apiKey = FB_API_KEY.trim();
  const dbURL = FB_DB_URL.trim();

  if (!apiKey || !dbURL || apiKey.indexOf('COLE_AQUI') >= 0) {
    const mensagem = 'Configure FB_API_KEY e FB_DB_URL no topo do app.js.';
    console.error(mensagem);
    if (!silencioso) alert(mensagem);
    return;
  }

  firebaseConnecting = true;
  if (firebaseRetryTimeout) {
    clearTimeout(firebaseRetryTimeout);
    firebaseRetryTimeout = null;
  }
  atualizarEstadoConexao();

  try {
    if (!firebase.apps.length) {
      firebase.initializeApp({ apiKey, databaseURL: dbURL });
    }
    dbRef = firebase.database();

    firebase.auth().signInAnonymously()
      .then(() => {
        console.log('✅ Autenticado anonimamente');
        firebaseConnecting = false;

        if (!firebaseListenersAttached) {
          firebaseListenersAttached = true;
          dbRef.ref('.info/connected').on('value', snap => {
            firebaseConnected = snap.val() === true;
            atualizarEstadoConexao();
            if (firebaseConnected) {
              const stWifi = document.getElementById('st-wifi');
              if (stWifi) stWifi.textContent = 'Firebase OK';
              if (!silencioso) {
                alert('✅ Ligado ao Firebase com sucesso! A receber dados do ESP32...');
                silencioso = true;
              }
              return;
            }

            const stWifi = document.getElementById('st-wifi');
            if (stWifi) stWifi.textContent = 'Firebase offline';
          });

          // Listener: sistema/actual
          dbRef.ref(FB_PATH + '/actual').on('value', snap => {
            const d = snap.val();
            if (!d) return;
            if (!actualizarLeituraRealESP32(d)) return;
            if (typeof d.alarme === 'boolean') {
              const st = document.getElementById('status-alarmes');
              if (st && d.alarme) st.textContent = 'Alarme activo';
            }
          });

          // Estados reais dos relés publicados pelo ESP32
          dbRef.ref(FB_PATH + '/actuadores').on('value', snap => {
            const a = snap.val();
            if (!a) return;
            if (typeof a.modo_automatico === 'boolean') {
              operacaoAnual.modo = a.modo_automatico ? 'Automático' : 'Manual';
              syncOperacaoUI();
            }
            if (typeof a.estacao === 'string' && estacoesConfig[a.estacao]) {
              operacaoAnual.estacao = a.estacao;
              const seletorEstacao = document.getElementById('op-estacao');
              if (seletorEstacao) seletorEstacao.value = a.estacao;
            }
            if (typeof a.alarme === 'boolean') {
              sincronizarEstadoBotaoAlarme(
                a.alarme,
                typeof a.alarme_silenciado === 'boolean' ? a.alarme_silenciado : null
              );
            }
            const bomba = document.getElementById('op-bomba-circulacao');
            if (bomba && typeof a.bomba_circulacao === 'boolean') { bomba.checked = a.bomba_circulacao; estadoBombaESP32 = a.bomba_circulacao; operacaoAnual.bombaCirculacao = a.bomba_circulacao; }
            const ph = document.getElementById('op-dosagem-ph');
            if (ph) ph.checked = Boolean(a.ph_down || a.ph_up);
            const ec = document.getElementById('op-dosagem-ec');
            if (ec) ec.checked = Boolean(a.ec_a || a.ec_b);
            const homeBomba = document.getElementById('home-bomba-estado');
            if (homeBomba && typeof a.bomba_circulacao === 'boolean') homeBomba.textContent = a.bomba_circulacao ? 'Ligada' : 'Desligada';
            if (typeof a.bomba_circulacao === 'boolean') syncOperacaoUI();
            console.log('[Firebase] Estado dos actuadores recebido:', a);
          });

          // Configuração sazonal persistente (histórico e perfis por estação)
          dbRef.ref(FB_PATH + '/configuracao/estacoes').on('value', snap => {
            const configs = snap.val();
            if (configs && typeof configs === 'object') {
              Object.entries(configs).forEach(([nome, cfg]) => { if (estacoesConfig[nome] && cfg) Object.assign(estacoesConfig[nome], cfg); });
              try { localStorage.setItem('nft-estacoes-config', JSON.stringify(estacoesConfig)); } catch (_) {}
              publicarConfiguracaoOperacaoMQTT();
              console.log('[Firebase] Perfis sazonais carregados.');
            }
          });
          dbRef.ref(FB_PATH + '/operacaoAnual').on('value', snap => {
            const plano = snap.val();
            if (plano && typeof plano === 'object') {
              Object.assign(operacaoAnual, plano);
              if (Array.isArray(plano.intervalos)) operacaoAnual.intervalos = plano.intervalos;
              syncOperacaoUI();
              publicarConfiguracaoOperacaoMQTT();
              console.log('[Firebase] Plano anual carregado.');
            }
          });

          // Listener: sistema/setpoints
          dbRef.ref(FB_PATH + '/setpoints').on('value', snap => {
            const s = snap.val();
            if (!s) return;
            Object.assign(SP, s);
            atualizarCamposSetpoints();
            console.log('✅ Setpoints sincronizados:', SP);
          });

          dbRef.ref(FB_PATH + '/gsm/numero').on('value', snap => {
            const numero = snap.val();
            const inputNumero = document.getElementById('sp-gsm-num');
            if (typeof numero !== 'string' || !inputNumero) return;
            inputNumero.value = numero;
            try {
              localStorage.setItem('gsmNumeroOperador', numero);
            } catch (err) {
              console.error('Não foi possível actualizar o número GSM guardado neste navegador:', err);
            }
          });

          dbRef.ref(FB_PATH + '/gsm/status').on('value', snap => {
            gsmStatusAtual = snap.val();
            actualizarRelatorioGSMUI();
          });

          dbRef.ref(FB_PATH + '/gsm/relatorios').limitToLast(20).on('child_added', snap => {
            const relatorio = snap.val();
            if (!relatorio) return;
            gsmRelatorios.set(snap.key, relatorio);
            renderRelatoriosGSM();
          });

          dbRef.ref(FB_PATH + '/configuracao/intervaloLeituraSegundos').on('value', snap => {
            const valor = Number(snap.val());
            if (!Number.isInteger(valor) || valor < 5 || valor > 3600) return;
            intervaloLeituraSegundos = valor;
            actualizarCicloLeituraUI();
            try {
              localStorage.setItem('intervaloLeituraSegundos', String(valor));
            } catch (err) {
              console.error('Não foi possível guardar o ciclo de leituras sincronizado neste navegador:', err);
            }
          });

          // Listener: sistema/leituras (histórico)
          dbRef.ref(FB_PATH + '/leituras').limitToLast(50).on('child_added', snap => {
            const l = snap.val();
            if (!l) return;
            registrarEvento('leitura', {
              ts: Date.now(),
              ph: l.ph, ec: l.ec, temp: l.temperatura,
              alarme: Boolean(l.alarme),
              estado: l.alarme ? 'critico' : 'normal',
              descricao: 'Leitura recebida do ESP32'
            });
          });

          // Listener: sistema/alertas
          dbRef.ref(FB_PATH + '/alertas').limitToLast(1).on('child_added', snap => {
            const a = snap.val();
            if (!a) return;
            console.warn('🚨 Alerta do ESP32:', a);
          });
        }
      })
      .catch(err => {
        firebaseConnecting = false;
        firebaseConnected = false;
        atualizarEstadoConexao();
        console.error('❌ Erro de autenticação:', err);
        const stWifi = document.getElementById('st-wifi');
        if (stWifi) stWifi.textContent = 'A tentar ligar ao Firebase...';
        if (!silencioso) {
          alert('❌ Erro de autenticação anónima: ' + err.message +
                '\n\nVerifique se ativou "Anónimo" em Authentication no Firebase Console.');
          silencioso = true;
        }
        if (!firebaseRetryTimeout) {
          firebaseRetryTimeout = setTimeout(() => {
            firebaseRetryTimeout = null;
            ligarFirebase(true);
          }, 10000);
        }
      });
  } catch (e) {
    firebaseConnecting = false;
    firebaseConnected = false;
    atualizarEstadoConexao();
    console.error('❌ Erro ao ligar ao Firebase:', e);
    const stWifi = document.getElementById('st-wifi');
    if (stWifi) stWifi.textContent = 'A tentar ligar ao Firebase...';
    if (!silencioso) alert('❌ Erro ao ligar: ' + e.message);
    if (!firebaseRetryTimeout) {
      firebaseRetryTimeout = setTimeout(() => {
        firebaseRetryTimeout = null;
        ligarFirebase(true);
      }, 10000);
    }
  }
}

// ══════════════════════════════════════════════════════════════════
// ESTADO DE CONEXÃO / ALARMES
// ══════════════════════════════════════════════════════════════════
function silenciarAlarme() {
  if (!estadoBotaoAlarmeAtivo || alarmeSilenciado || pedidoSilenciarAlarme) return;
  if (!publicarComandoMQTT('silenciar_alarme', 'SILENCE')) return;
  pedidoSilenciarAlarme = true;
  atualizarIconeSilenciarAlarme();
  const status = document.getElementById('status-alarmes');
  if (status) status.textContent = 'A aguardar confirmação do ESP32';
  if (dbRef && firebaseConnected) dbRef.ref(FB_PATH + '/eventos/comandos').push({mensagem:'Pedido para silenciar alarme', timestamp:firebase.database.ServerValue.TIMESTAMP}).catch(console.error);
}

function sincronizarEstadoBotaoAlarme(ativo, silenciado = null) {
  const novoAlarme = ativo && !estadoBotaoAlarmeAtivo;
  estadoBotaoAlarmeAtivo = ativo;
  if (!ativo) {
    alarmeSilenciado = false;
    pedidoSilenciarAlarme = false;
  } else if (typeof silenciado === 'boolean') {
    alarmeSilenciado = silenciado;
    if (silenciado) pedidoSilenciarAlarme = false;
  } else if (novoAlarme) {
    alarmeSilenciado = false;
    pedidoSilenciarAlarme = false;
  }

  const banner = document.getElementById('banner-alerta');
  if (banner) banner.classList.toggle('silenciado', ativo && alarmeSilenciado);
  atualizarIconeSilenciarAlarme();
}

function atualizarIconeSilenciarAlarme() {
  const botao = document.getElementById('btn-silenciar-alarme');
  const icone = document.querySelector('#btn-silenciar-alarme .material-icon');
  const texto = document.getElementById('txt-silenciar-alarme');
  const silenciado = estadoBotaoAlarmeAtivo && alarmeSilenciado;
  const pendente = estadoBotaoAlarmeAtivo && pedidoSilenciarAlarme && !silenciado;

  if (icone) {
    icone.textContent = !estadoBotaoAlarmeAtivo
      ? 'notifications_active'
      : silenciado ? 'notifications_paused' : pendente ? 'hourglass_top' : 'volume_off';
  }
  if (texto) {
    texto.textContent = !estadoBotaoAlarmeAtivo
      ? 'Sem alarme'
      : silenciado ? 'Alarme silenciado' : pendente ? 'A silenciar…' : 'Silenciar alarme';
  }
  if (botao) {
    botao.disabled = !estadoBotaoAlarmeAtivo || silenciado || pendente;
    botao.classList.toggle('btn-danger', estadoBotaoAlarmeAtivo && !silenciado);
    botao.classList.toggle('btn-outline', !estadoBotaoAlarmeAtivo || silenciado);
    botao.setAttribute('aria-pressed', String(silenciado));
    botao.setAttribute('aria-busy', String(pendente));
  }
}

function atualizarEstadoConexao() {
  const badge = document.getElementById('badge-conexao');
  const txt = document.getElementById('txt-conexao');
  if (!badge || !txt) return;
  badge.className = esp32Online ? 'badge online' : 'badge offline';
  txt.textContent = esp32Online ? 'online' : 'offline';
}

// ══════════════════════════════════════════════════════════════════
// RELÓGIO
// ══════════════════════════════════════════════════════════════════
function actualizarRelogio() {
  const el = document.getElementById('hora-actual');
  if (el) el.textContent = new Date().toLocaleString('pt', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
}
setInterval(actualizarRelogio, 1000);
actualizarRelogio();

// ══════════════════════════════════════════════════════════════════
// OPERAÇÃO ANUAL
// ══════════════════════════════════════════════════════════════════
const operacaoAnual = {
  bombaCirculacao: false, dosagemPH: false, dosagemEC: false,
  modo: 'Automático', estacao: 'Primavera',
  janela: '06:00 – 21:00', volume: '250 L',
  intervaloDuracao: 15,
  intervalos: [...estacoesConfig.Primavera.periodos]
};

function obterMinutosHora(hora) {
  const [h, m] = String(hora || '00:00').split(':').map(Number);
  return h * 60 + m;
}

function verificarHorarioBomba() {
  if (operacaoAnual.modo === 'Manual') return Boolean(operacaoAnual.bombaCirculacao);
  const agora = new Date();
  const agoraMin = agora.getHours() * 60 + agora.getMinutes();
  const duracao = Math.max(1, Math.min(1440, Number(operacaoAnual.intervaloDuracao) || 15));
  return operacaoAnual.intervalos.some(slot => {
    const inicio = obterMinutosHora(slot);
    const decorrido = (agoraMin - inicio + 1440) % 1440;
    return decorrido < duracao;
  });
}

function renderPeriodosIrrigacao() {
  const wrapper = document.getElementById('periodos-irrigacao-wrapper');
  if (!wrapper) return;
  const count = Math.max(1, Math.min(12, Number(document.getElementById('num-irrigacoes')?.value || 3)));
  const selec = estacoesConfig[estacaoActiva]?.periodos || ['06:00', '12:00', '18:00'];
  wrapper.innerHTML = Array.from({ length: count }, (_, i) => {
    const valor = selec[i] || '06:00';
    return `<div class="sp-row"><label>Período ${i + 1}</label>
      <input class="sp-input" type="time" id="periodo-${i + 1}" value="${valor}"></div>`;
  }).join('');
}

function renderOperacaoSlots() {
  const container = document.getElementById('op-slots-container');
  if (!container) return;
  const total = Math.max(1, Math.min(12, Number(document.getElementById('op-num-intervalos')?.value || operacaoAnual.intervalos.length || 3)));
  const slots = operacaoAnual.intervalos && operacaoAnual.intervalos.length ? [...operacaoAnual.intervalos] : ['06:00', '12:00', '18:00'];
  const valores = Array.from({ length: total }, (_, i) => slots[i] || '06:00');
  operacaoAnual.intervalos = [...valores];
  container.innerHTML = valores.map((v, i) =>
    `<div class="slot-box"><label>Intervalo ${i + 1}</label>
     <input type="time" id="op-slot-${i + 1}" value="${v}"></div>`).join('');
}

function syncOperacaoUI() {
  operacaoAnual.modo = operacaoAnual.modo === 'Manual' ? 'Manual' : 'Automático';
  const ids = { bombaCirculacao: 'op-bomba-circulacao', dosagemPH: 'op-dosagem-ph', dosagemEC: 'op-dosagem-ec' };
  Object.entries(ids).forEach(([key, id]) => {
    const el = document.getElementById(id);
    if (el) el.checked = operacaoAnual[key];
  });
  const estacao = document.getElementById('op-estacao');
  if (estacao) estacao.value = operacaoAnual.estacao;
  const numInt = document.getElementById('op-num-intervalos');
  if (numInt) numInt.value = operacaoAnual.intervalos?.length || 3;
  renderOperacaoSlots();

  const modo = document.getElementById('op-modo');
  const janela = document.getElementById('op-janela');
  const volume = document.getElementById('op-volume');
  const volumeLitros = obterVolumeEmLitros(operacaoAnual.volume);
  if (modo) modo.value = operacaoAnual.modo;
  if (janela) janela.value = operacaoAnual.janela;
  if (volume) volume.value = volumeLitros === null ? '' : String(volumeLitros);

  const modoValor = document.getElementById('op-modo-valor');
  const cicloValor = document.getElementById('op-ciclo-valor');
  const janelaValor = document.getElementById('op-janela-valor');
  const volumeValor = document.getElementById('op-volume-valor');
  if (modoValor) modoValor.textContent = operacaoAnual.modo;
  if (cicloValor) cicloValor.textContent = `${operacaoAnual.intervaloDuracao} min`;
  if (janelaValor) janelaValor.textContent = operacaoAnual.janela;
  if (volumeValor) volumeValor.textContent = volumeLitros === null ? operacaoAnual.volume : `${volumeLitros} L`;

  const bombaLigada = typeof estadoBombaESP32 === 'boolean'
    ? estadoBombaESP32
    : verificarHorarioBomba();
  const bombaToggle = document.getElementById('op-bomba-circulacao');
  const botaoBomba = document.getElementById('btn-operacao-bomba');
  const textoBotaoBomba = document.getElementById('txt-operacao-bomba');
  if (bombaToggle) bombaToggle.disabled = operacaoAnual.modo !== 'Manual';
  if (botaoBomba) {
    const bombaLigada = typeof estadoBombaESP32 === 'boolean'
      ? estadoBombaESP32
      : Boolean(operacaoAnual.bombaCirculacao);
    botaoBomba.disabled = operacaoAnual.modo !== 'Manual';
    if (textoBotaoBomba) textoBotaoBomba.textContent = bombaLigada ? 'Desligar bomba' : 'Ligar bomba';
  }
  const status = operacaoAnual.modo === 'Manual'
    ? (bombaLigada ? 'Modo manual: bomba ligada' : 'Modo manual: bomba desligada')
    : (bombaLigada ? 'Bomba ligada' : 'Bomba desligada');
  const badge = document.getElementById('op-status-pill');
  if (badge) {
    badge.textContent = status;
    badge.style.background = bombaLigada ? 'rgba(26,66,47,0.28)' : 'rgba(217,119,6,0.12)';
    badge.style.color = bombaLigada ? 'var(--green)' : 'var(--yellow)';
  }
}

function obterVolumeEmLitros(valor) {
  const correspondencia = String(valor ?? '').trim().replace(',', '.').match(/^(\d+(?:\.\d+)?)\s*(?:L|litros?)?$/i);
  if (!correspondencia) return null;
  const volume = Number(correspondencia[1]);
  return Number.isFinite(volume) && volume > 0 ? volume : null;
}

function guardarOperacaoAnual() {
  const estacao = document.getElementById('op-estacao');
  const modo = document.getElementById('op-modo');
  const janela = document.getElementById('op-janela');
  const volume = document.getElementById('op-volume');
  const numInt = document.getElementById('op-num-intervalos');
  if (volume && !volume.reportValidity()) return;
  if (estacao) operacaoAnual.estacao = estacao.value;
  if (modo) operacaoAnual.modo = modo.value;
  if (janela) operacaoAnual.janela = janela.value;
  if (volume) {
    operacaoAnual.volume = `${Number(volume.value)} L`;
  }
  const total = Math.max(1, Math.min(12, Number(numInt?.value || operacaoAnual.intervalos.length || 3)));
  operacaoAnual.intervalos = Array.from({ length: total }, (_, i) => {
    const el = document.getElementById(`op-slot-${i + 1}`);
    return el && el.value ? el.value : '06:00';
  });
  syncOperacaoUI();
  const plano = JSON.parse(JSON.stringify(operacaoAnual));
  guardarPlanoOperacao(plano);
  publicarConfiguracaoOperacaoMQTT();
  guardarSetpointsEstacaoActiva();
  alert(`✅ Plano anual e horários guardados ${firebaseConnected ? 'no Firebase' : 'localmente'}.`);
}

function guardarPlanoOperacao(plano = operacaoAnual) {
  try {
    localStorage.setItem('nft-operacao-anual', JSON.stringify(plano));
  } catch (err) {
    console.error('Não foi possível guardar o plano neste navegador:', err);
  }
  if (!dbRef || !firebaseConnected) return;
  const operacao = {
    modo: plano.modo === 'Manual' ? 'MANUAL' : 'AUTO',
    estacao: plano.estacao,
    horarios: (plano.intervalos || []).join(','),
    duracao: Number(plano.intervaloDuracao) || 15
  };
  dbRef.ref(FB_PATH + '/operacaoAnual').set({...plano, actualizadoEm: firebase.database.ServerValue.TIMESTAMP})
    .catch(e => console.error('[Firebase] Plano anual não guardado:', e));
  dbRef.ref(FB_PATH + '/configuracao/operacao').set({...operacao, actualizadoEm: firebase.database.ServerValue.TIMESTAMP})
    .catch(e => console.error('[Firebase] Configuração de operação não guardada:', e));
}

function guardarSetpointsEstacaoActiva() {
  const cfg = estacoesConfig[operacaoAnual.estacao];
  if (!cfg) return;
  if (dbRef && firebaseConnected) {
    dbRef.ref(FB_PATH + '/setpoints').set(cfg.setpoints)
      .catch(e => console.error('[Firebase] Setpoints da estação não guardados:', e));
  }
}

function publicarConfiguracaoOperacaoMQTT() {
  if (!mqttClient || !mqttConnected) {
    console.warn('[MQTT] Configuração guardada; será enviada ao ESP32 quando MQTT ligar.');
    return;
  }
  const modo = operacaoAnual.modo === 'Manual' ? 'MANUAL' : 'AUTO';
  const duracao = Math.max(1, Math.min(1440, Number(operacaoAnual.intervaloDuracao) || 15));
  const horarios = (operacaoAnual.intervalos || []).join(',');
  const setpoints = estacoesConfig[operacaoAnual.estacao]?.setpoints || SP;
  const valoresSetpoints = [
    setpoints.ph_min, setpoints.ph_max, setpoints.ph_crit_l, setpoints.ph_crit_h,
    setpoints.ec_min, setpoints.ec_max, setpoints.ec_crit_l, setpoints.ec_crit_h,
    setpoints.t_max, setpoints.t_crit, setpoints.t_dose_ph, setpoints.t_dose_ec
  ].join(',');
  publicarComandoMQTT(
    'config_operacao',
    `${modo};${operacaoAnual.estacao};${duracao};${horarios};${valoresSetpoints}`,
    true
  );
}

function acionarBomba(tipo) {
  const comandos = {
    bombaCirculacao: { nome: 'bomba_circulacao', valor: !Boolean(operacaoAnual.bombaCirculacao), label: 'bomba de circulação' },
    dosagemPH: { nome: 'dosagem_ph', valor: 'START', label: 'pulso de dosagem pH' },
    dosagemEC: { nome: 'dosagem_ec', valor: 'START', label: 'pulso de dosagem EC' }
  };
  const c = comandos[tipo];
  if (!c) return;
  if (tipo === 'bombaCirculacao' && operacaoAnual.modo !== 'Manual') {
    alert('A bomba é controlada pelos horários no modo automático. Mude para Manual para controlá-la directamente.');
    return;
  }
  if (tipo === 'bombaCirculacao') {
    c.valor = estadoBombaESP32 === true || (estadoBombaESP32 === null && operacaoAnual.bombaCirculacao) ? 'OFF' : 'ON';
  }
  if (publicarComandoMQTT(c.nome, c.valor)) {
    if (dbRef && firebaseConnected) dbRef.ref(FB_PATH + '/eventos/comandos').push({comando:c.nome, valor:c.valor, timestamp:firebase.database.ServerValue.TIMESTAMP}).catch(e => console.error('[Firebase] Log de comando falhou:', e));
    console.log(`[MQTT] Pedido para ${c.label}:`, c.valor);
  }
}
function aplicarPerfilEstacao(estacao) {
  if (!estacoesConfig[estacao]) return;
  carregarConfigEstacao(estacao);
  guardarPlanoOperacao();
  guardarSetpointsEstacaoActiva();
  publicarConfiguracaoOperacaoMQTT();
  try { localStorage.setItem('nft-operacao-anual', JSON.stringify(operacaoAnual)); } catch (err) {
    console.error('Não foi possível guardar a estação neste navegador:', err);
  }
}

// ══════════════════════════════════════════════════════════════════
// EVENT LISTENERS DE ARRANQUE
// ══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
  atualizarEstadoConexao();
  sincronizarEstadoBotaoAlarme(false, false);
  actualizarRelatorioGSMUI();
  renderRelatoriosGSM();
  setInterval(actualizarRelatorioGSMUI, 15000);

  try {
    const valorLocal = Number(localStorage.getItem('intervaloLeituraSegundos'));
    if (Number.isInteger(valorLocal) && valorLocal >= 5 && valorLocal <= 3600) {
      intervaloLeituraSegundos = valorLocal;
    }
  } catch (err) {
    console.error('Não foi possível carregar o ciclo de leituras deste navegador:', err);
  }
  actualizarCicloLeituraUI();

  const inputNumeroGSM = document.getElementById('sp-gsm-num');
  if (inputNumeroGSM) {
    try {
      const numeroGuardado = localStorage.getItem('gsmNumeroOperador');
      if (numeroGuardado) inputNumeroGSM.value = numeroGuardado;
    } catch (err) {
      console.error('Não foi possível carregar o número GSM guardado neste navegador:', err);
    }
  }

  // Inputs Firebase: pré-preencher com valores por defeito
  const inputKey = document.getElementById('fb-apikey');
  const inputUrl = document.getElementById('fb-url');
  if (inputKey && !inputKey.value) inputKey.value = FB_API_KEY;
  if (inputUrl && !inputUrl.value) inputUrl.value = FB_DB_URL;

  // Toggles de operação
  const opToggleMap = {
    'op-bomba-circulacao': 'bombaCirculacao',
    'op-dosagem-ph': 'dosagemPH',
    'op-dosagem-ec': 'dosagemEC'
  };
  Object.entries(opToggleMap).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', () => {
      if (key === 'bombaCirculacao') {
        const pedido = el.checked ? 'ON' : 'OFF';
        if (!publicarComandoMQTT('bomba_circulacao', pedido)) {
          el.checked = Boolean(estadoBombaESP32 ?? operacaoAnual.bombaCirculacao);
          return;
        }
        if (dbRef && firebaseConnected) dbRef.ref(FB_PATH + '/eventos/comandos').push({comando:'bomba_circulacao', valor:pedido, timestamp:firebase.database.ServerValue.TIMESTAMP}).catch(console.error);
      } else {
        // As dosagens são comandos de pulso, não interruptores contínuos.
        el.checked = false;
        if (key === 'dosagemPH') acionarBomba('dosagemPH');
        if (key === 'dosagemEC') acionarBomba('dosagemEC');
      }
      syncOperacaoUI();
    });
  });

  const estacaoEl = document.getElementById('op-estacao');
  if (estacaoEl) estacaoEl.addEventListener('change', e => aplicarPerfilEstacao(e.target.value));

  const modoEl = document.getElementById('op-modo');
  if (modoEl) modoEl.addEventListener('change', e => {
    operacaoAnual.modo = e.target.value;
    syncOperacaoUI();
    guardarPlanoOperacao();
    publicarConfiguracaoOperacaoMQTT();
  });

  // Datas padrão para filtro histórico
  const hoje = new Date().toISOString().slice(0, 10);
  const dIni = document.getElementById('data-ini');
  const dFim = document.getElementById('data-fim');
  if (dIni) dIni.value = hoje;
  if (dFim) dFim.value = hoje;

  // MQTT controla em tempo real; Firebase mantém histórico, setpoints e configurações.
  try { const localCfg = JSON.parse(localStorage.getItem('nft-estacoes-config') || 'null'); if (localCfg) Object.entries(localCfg).forEach(([n,c]) => { if (estacoesConfig[n]) Object.assign(estacoesConfig[n], c); }); } catch (_) {}
  try { const localPlano = JSON.parse(localStorage.getItem('nft-operacao-anual') || 'null'); if (localPlano) Object.assign(operacaoAnual, localPlano); } catch (_) {}
  ligarMQTT();
  ligarFirebase(true);
  window.addEventListener('online', () => {
    if (!firebaseConnected) ligarFirebase(true);
  });
  syncOperacaoUI();
  renderPeriodosIrrigacao();
});