// ══════════════════════════════════════════════════════════════════
// SISTEMA NFT — Dashboard Firebase
// Ficheiro app.js completo — todas as funções incluídas
// ══════════════════════════════════════════════════════════════════

// ── CREDENCIAIS FIREBASE ──────────────────────────────────────────
// Substitua pela sua API Key real (Firebase Console → Configurações do projeto → Geral → Os seus apps)
const FB_API_KEY = "AIzaSyD-lfrEElCMTxDoQLLJWLcndA4MZaf5xo4";
const FB_DB_URL  = "https://sistema-hidroponico-92e17-default-rtdb.europe-west1.firebasedatabase.app";
const FB_PATH    = "sistema";

// ══════════════════════════════════════════════════════════════════
// ESTADO GLOBAL
// ══════════════════════════════════════════════════════════════════
let historico = [];
let historicoSistema = [];
let historicoFiltrado = [];
let totalRegistos = 0;
let modoSim = true;
let simInterval = null;
let dbRef = null;
let firebaseConnected = false;
let firebaseConnecting = false;
let firebaseListenersAttached = false;
let firebaseRetryTimeout = null;
let ultimoEstadoAlarme = false;
let ultimoEstadoBomba = null;

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
      x: { grid: { color: '#EEE' }, ticks: { maxTicksLimit: 8, minRotation: 45, maxRotation: 45, font: { size: 10 }, color: '#888' } },
      y: { min: yMin, max: yMax, grid: { color: '#EEE' }, ticks: { stepSize: yStep, font: { size: 10 }, color: '#888' } }
    }
  }
});

const gPHChart   = new Chart(document.getElementById('g-ph'),   cfgBase('pH', '#1A5276', gPH, 0, 14, 5));
const gECChart   = new Chart(document.getElementById('g-ec'),   cfgBase('EC', '#1E8449', gEC, 0, 5, 1));
const gTempChart = new Chart(document.getElementById('g-temp'), cfgBase('T°C', '#E67E22', gTemp, 10, 40, 10));

const gGeralChart = new Chart(document.getElementById('g-geral'), {
  type: 'line',
  data: {
    labels: gLabels,
    datasets: [
      { label: 'pH/14', data: gPH.map(v => v / 14 * 100), borderColor: '#1A5276', backgroundColor: '#1A527633', borderWidth: 2, pointRadius: 1, tension: .3, fill: true },
      { label: 'EC/5',  data: gEC.map(v => v / 5 * 100),  borderColor: '#1E8449', backgroundColor: '#1E844933', borderWidth: 2, pointRadius: 1, tension: .3, fill: true },
    ]
  },
  options: {
    responsive: true, maintainAspectRatio: false, animation: { duration: 300 },
    plugins: { legend: { position: 'bottom', labels: { font: { size: 11 } } } },
    scales: {
      x: { grid: { color: '#EEE' }, ticks: { maxTicksLimit: 8, minRotation: 45, maxRotation: 45, font: { size: 10 }, color: '#888' } },
      y: { min: 0, max: 100, grid: { color: '#EEE' }, ticks: { font: { size: 10 }, color: '#888', callback: v => v + '%' } }
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

function actualizarTudo(ph, ec, temp, ts) {
  const clPH   = avaliarEstadoParametro(ph, SP.ph_min, SP.ph_max, SP.ph_crit_l, SP.ph_crit_h);
  const clEC   = avaliarEstadoParametro(ec, SP.ec_min, SP.ec_max, SP.ec_crit_l, SP.ec_crit_h);
  const clTemp = avaliarEstadoParametro(temp, 18, SP.t_max, 0, SP.t_crit);
  const bombaLigada = verificarHorarioBomba();

  const critico = clPH === 'critico' || clEC === 'critico' || clTemp === 'critico';
  const bannerEl = document.getElementById('banner-alerta');
  if (bannerEl) bannerEl.style.display = critico ? 'block' : 'none';

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
    listaAlarmes.innerHTML = alarmas.map(item => {
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
  doc.setTextColor(255, 255, 255);
  doc.setFillColor(30, 64, 175);
  doc.setFontSize(7);
  doc.setFont(undefined, 'bold');
  cols.forEach((col, index) => {
    const x = marginX + colPositions.slice(0, index + 1).reduce((s, p) => s + p.width, 0) - col.width;
    doc.rect(x, y, col.width, rowHeight, 'F');
    doc.text(col.title, x + 2, y + 5);
  });
  y += rowHeight;
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(6.5);

  linhas.forEach((linha, index) => {
    if (y > pageHeight - 18) { doc.addPage(); y = 16; }
    const rowValues = [linha.data, linha.tipo, linha.ph, linha.ec, linha.temp, linha.estado, linha.alarme, linha.detalhes];
    const rowColor = index % 2 === 0 ? [245, 248, 250] : [255, 255, 255];
    doc.setFillColor(...rowColor);
    cols.forEach((col, colIndex) => {
      const x = marginX + colPositions.slice(0, colIndex + 1).reduce((s, p) => s + p.width, 0) - col.width;
      doc.rect(x, y, col.width, rowHeight, 'F');
      doc.text(String(rowValues[colIndex]), x + 2, y + 5, { maxWidth: col.width - 4 });
    });
    y += rowHeight;
  });
  doc.save('relatorio_nft_' + new Date().toISOString().slice(0, 10) + '.pdf');
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
  alert(`✅ Configuração guardada para ${estacaoActiva}.`);
}

function guardarSetpoints(tipo) {
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

  if (dbRef) {
    dbRef.ref(FB_PATH + '/setpoints').set(setpointsFB)
      .then(() => alert('✅ Setpoints guardados no Firebase! O ESP32 vai aplicar em até 10s.'))
      .catch(err => alert('❌ Erro ao guardar no Firebase: ' + err.message));
  } else {
    alert('✅ Setpoints actualizados localmente.\n(Ligue ao Firebase para guardar permanentemente.)');
  }
}

function testarSMS() {
  alert('Funcionalidade de teste SMS requer ligação ao ESP32 via Firebase.\nConfigure as credenciais na secção Firebase e certifique-se que o ESP32 está online.');
}

// ══════════════════════════════════════════════════════════════════
// FIREBASE — ligação + listeners
// ══════════════════════════════════════════════════════════════════
function ligarFirebase(silencioso = false) {
  if (firebaseConnecting) return;

  const inputKey = document.getElementById('fb-apikey');
  const inputUrl = document.getElementById('fb-url');
  const apiKey = (inputKey?.value || FB_API_KEY).trim();
  const dbURL  = (inputUrl?.value || FB_DB_URL).trim();

  if (!apiKey || !dbURL || apiKey.indexOf('COLE_AQUI') >= 0) {
    const mensagem = 'Preencha a API Key e o Database URL no formulário, ou edite FB_API_KEY/FB_DB_URL no topo do app.js.';
    console.error(mensagem);
    if (!silencioso) alert(mensagem);
    return;
  }

  firebaseConnecting = true;
  if (firebaseRetryTimeout) {
    clearTimeout(firebaseRetryTimeout);
    firebaseRetryTimeout = null;
  }
  const badge = document.getElementById('badge-conexao');
  const txt = document.getElementById('txt-conexao');
  if (badge) badge.className = 'badge offline';
  if (txt) txt.textContent = 'A ligar ao Firebase...';

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
            if (firebaseConnected) {
              modoSim = false;
              if (simInterval) { clearInterval(simInterval); simInterval = null; }
              const simBar = document.getElementById('sim-bar');
              if (simBar) simBar.style.display = 'none';
              if (badge) badge.className = 'badge online';
              if (txt) txt.textContent = 'Firebase ligado';
              const stWifi = document.getElementById('st-wifi');
              if (stWifi) stWifi.textContent = 'Firebase OK';
              if (!silencioso) {
                alert('✅ Ligado ao Firebase com sucesso! A receber dados do ESP32...');
                silencioso = true;
              }
              return;
            }

            modoSim = true;
            if (badge) badge.className = 'badge offline';
            if (txt) txt.textContent = 'Firebase offline — a reconectar...';
            const stWifi = document.getElementById('st-wifi');
            if (stWifi) stWifi.textContent = 'Firebase offline';
            const simBar = document.getElementById('sim-bar');
            if (simBar) simBar.style.display = 'block';
            iniciarSimulacao();
          });

          // Listener: sistema/actual
          dbRef.ref(FB_PATH + '/actual').on('value', snap => {
            const d = snap.val();
            if (!d) return;
            actualizarTudo(d.ph || 0, d.ec || 0, d.temperatura || 0, Date.now());
          });

          // Listener: sistema/setpoints
          dbRef.ref(FB_PATH + '/setpoints').on('value', snap => {
            const s = snap.val();
            if (!s) return;
            Object.assign(SP, s);
            atualizarCamposSetpoints();
            console.log('✅ Setpoints sincronizados:', SP);
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
        console.error('❌ Erro de autenticação:', err);
        if (badge) badge.className = 'badge offline';
        if (txt) txt.textContent = 'Firebase indisponível — a tentar...';
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
    console.error('❌ Erro ao ligar ao Firebase:', e);
    if (badge) badge.className = 'badge offline';
    if (txt) txt.textContent = 'Firebase indisponível — a tentar...';
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
  const banner = document.getElementById('banner-alerta');
  if (banner) {
    banner.innerHTML = '<span class="material-icon" aria-hidden="true">notifications_paused</span> Alarme silenciado manualmente — sistema em monitorização.';
    banner.classList.add('silenciado');
  }
  const status = document.getElementById('status-alarmes');
  if (status) status.textContent = 'Silenciado';
  alert('✅ Alarme silenciado.');
}

function atualizarEstadoConexao() {
  const badge = document.getElementById('badge-conexao');
  const txt = document.getElementById('txt-conexao');
  if (!badge || !txt) return;
  if (firebaseConnected) { badge.className = 'badge online'; txt.textContent = 'Firebase ligado'; return; }
  if (dbRef) { badge.className = 'badge offline'; txt.textContent = 'Firebase offline — a reconectar...'; return; }
  if (modoSim) { badge.className = 'badge online'; txt.textContent = 'Simulação activa'; return; }
  badge.className = 'badge offline'; txt.textContent = 'Offline';
}

// ══════════════════════════════════════════════════════════════════
// SIMULAÇÃO (para demo quando não há Firebase ligado)
// ══════════════════════════════════════════════════════════════════
function iniciarSimulacao() {
  if (simInterval) return;
  modoSim = true;
  const stWifi = document.getElementById('st-wifi');
  if (stWifi) stWifi.textContent = 'Modo simulação';
  atualizarEstadoConexao();
  let phSim = 5.8, ecSim = 1.4, tSim = 22.0;
  simInterval = setInterval(() => {
    phSim += (Math.random() - 0.3) * 0.15;
    ecSim += (Math.random() - 0.5) * 0.08;
    tSim  += (Math.random() - 0.5) * 0.3;
    if (phSim > 6.0) phSim -= 0.2;
    if (phSim < 5.6) phSim += 0.2;
    if (ecSim < 1.2) ecSim += 0.1;
    if (ecSim > 1.8) ecSim -= 0.1;
    phSim = Math.min(Math.max(phSim, 4.5), 8.0);
    ecSim = Math.min(Math.max(ecSim, 0.5), 3.0);
    tSim  = Math.min(Math.max(tSim, 18), 32);
    actualizarTudo(phSim, ecSim, tSim, Date.now());
  }, 3000);
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
const perfisEstacao = {
  Primavera: ['06:00', '12:00', '18:00'],
  'Verão': ['05:30', '11:30', '17:30'],
  Outono: ['06:30', '12:30', '18:30'],
  Inverno: ['08:00', '13:00', '19:00']
};

const operacaoAnual = {
  bombaCirculacao: true, dosagemPH: false, dosagemEC: false,
  modo: 'Automático', estacao: 'Primavera',
  janela: '06:00 – 21:00', volume: '250 L',
  intervaloDuracao: 15,
  intervalos: [...perfisEstacao.Primavera]
};

function obterMinutosHora(hora) {
  const [h, m] = String(hora || '00:00').split(':').map(Number);
  return h * 60 + m;
}

function verificarHorarioBomba() {
  if (operacaoAnual.modo === 'Manual') return Boolean(operacaoAnual.bombaCirculacao);
  if (!operacaoAnual.bombaCirculacao) return false;
  const agora = new Date();
  const agoraMin = agora.getHours() * 60 + agora.getMinutes();
  return operacaoAnual.intervalos.some(slot => {
    const inicio = obterMinutosHora(slot);
    const fim = inicio + operacaoAnual.intervaloDuracao;
    return agoraMin >= inicio && agoraMin < fim;
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
  if (modo) modo.value = operacaoAnual.modo;
  if (janela) janela.value = operacaoAnual.janela;
  if (volume) volume.value = operacaoAnual.volume;

  const modoValor = document.getElementById('op-modo-valor');
  const cicloValor = document.getElementById('op-ciclo-valor');
  const janelaValor = document.getElementById('op-janela-valor');
  const volumeValor = document.getElementById('op-volume-valor');
  if (modoValor) modoValor.textContent = operacaoAnual.modo;
  if (cicloValor) cicloValor.textContent = `${operacaoAnual.intervaloDuracao} min`;
  if (janelaValor) janelaValor.textContent = operacaoAnual.janela;
  if (volumeValor) volumeValor.textContent = operacaoAnual.volume;

  const bombaLigada = verificarHorarioBomba();
  const status = operacaoAnual.modo === 'Manual'
    ? (bombaLigada ? 'Modo manual: bomba ligada' : 'Modo manual: bomba desligada')
    : (bombaLigada ? 'Bomba ligada' : 'Bomba desligada');
  const badge = document.getElementById('op-status-pill');
  if (badge) {
    badge.textContent = status;
    badge.style.background = bombaLigada ? 'rgba(22,163,74,0.12)' : 'rgba(217,119,6,0.12)';
    badge.style.color = bombaLigada ? 'var(--green)' : 'var(--yellow)';
  }
}

function guardarOperacaoAnual() {
  const estacao = document.getElementById('op-estacao');
  const modo = document.getElementById('op-modo');
  const janela = document.getElementById('op-janela');
  const volume = document.getElementById('op-volume');
  const numInt = document.getElementById('op-num-intervalos');
  if (estacao) operacaoAnual.estacao = estacao.value;
  if (modo) operacaoAnual.modo = modo.value;
  if (janela) operacaoAnual.janela = janela.value;
  if (volume) operacaoAnual.volume = volume.value;
  const total = Math.max(1, Math.min(12, Number(numInt?.value || operacaoAnual.intervalos.length || 3)));
  operacaoAnual.intervalos = Array.from({ length: total }, (_, i) => {
    const el = document.getElementById(`op-slot-${i + 1}`);
    return el && el.value ? el.value : '06:00';
  });
  syncOperacaoUI();
  alert('✅ Plano anual e horários da bomba guardados com sucesso.');
}

function acionarBomba(tipo) {
  if (tipo === 'bombaCirculacao') {
    operacaoAnual.bombaCirculacao = !operacaoAnual.bombaCirculacao;
    const el = document.getElementById('op-bomba-circulacao');
    if (el) el.checked = operacaoAnual.bombaCirculacao;
  }
  if (tipo === 'dosagemPH') {
    operacaoAnual.dosagemPH = !operacaoAnual.dosagemPH;
    const el = document.getElementById('op-dosagem-ph');
    if (el) el.checked = operacaoAnual.dosagemPH;
  }
  if (tipo === 'dosagemEC') {
    operacaoAnual.dosagemEC = !operacaoAnual.dosagemEC;
    const el = document.getElementById('op-dosagem-ec');
    if (el) el.checked = operacaoAnual.dosagemEC;
  }
  syncOperacaoUI();
}

function aplicarPerfilEstacao(estacao) {
  if (!perfisEstacao[estacao]) return;
  operacaoAnual.estacao = estacao;
  operacaoAnual.intervalos = [...perfisEstacao[estacao]];
  syncOperacaoUI();
}

// ══════════════════════════════════════════════════════════════════
// EVENT LISTENERS DE ARRANQUE
// ══════════════════════════════════════════════════════════════════
document.addEventListener('DOMContentLoaded', () => {
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
      operacaoAnual[key] = el.checked;
      syncOperacaoUI();
    });
  });

  const estacaoEl = document.getElementById('op-estacao');
  if (estacaoEl) estacaoEl.addEventListener('change', e => aplicarPerfilEstacao(e.target.value));

  const modoEl = document.getElementById('op-modo');
  if (modoEl) modoEl.addEventListener('change', e => {
    operacaoAnual.modo = e.target.value;
    syncOperacaoUI();
  });

  // Datas padrão para filtro histórico
  const hoje = new Date().toISOString().slice(0, 10);
  const dIni = document.getElementById('data-ini');
  const dFim = document.getElementById('data-fim');
  if (dIni) dIni.value = hoje;
  if (dFim) dFim.value = hoje;

  // Arrancar simulação (modo demonstração)
  iniciarSimulacao();
  ligarFirebase(true);
  window.addEventListener('online', () => {
    if (!firebaseConnected) ligarFirebase(true);
  });
  syncOperacaoUI();
  renderPeriodosIrrigacao();
});