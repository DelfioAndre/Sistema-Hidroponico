// Assistente de voz para consulta do estado e controlo da bomba de circulação.
(() => {
  const NOME_ASSISTENTE = 'Atlas';
  const TEMPO_MAXIMO_ESCUTA_MS = 8000;
  const listenButton = document.getElementById('assistant-listen');
  const logoButton = document.getElementById('assistant-logo');
  const statusButton = document.getElementById('assistant-status');
  const voiceToggle = document.getElementById('assistant-voice-enabled');
  const statusMessage = document.getElementById('assistant-status-message');
  const transcript = document.getElementById('assistant-transcript');
  const commandForm = document.getElementById('assistant-form');
  const commandInput = document.getElementById('assistant-command');

  if (!logoButton) return;

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = Recognition ? new Recognition() : null;
  let listenTimeout = null;
  let listening = false;
  const normalizar = texto => texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (recognition) {
    recognition.lang = 'pt-PT';
    recognition.continuous = false;
    recognition.interimResults = false;
  }

  function responder(mensagem, falar = true) {
    const resposta = `${NOME_ASSISTENTE}: ${mensagem}`;
    if (statusMessage) {
      statusMessage.textContent = resposta;
      statusMessage.dataset.state = 'ok';
    }
    if (!falar || (voiceToggle && !voiceToggle.checked) || !('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    const fala = new SpeechSynthesisUtterance(resposta);
    fala.lang = 'pt-PT';
    window.speechSynthesis.speak(fala);
  }

  function consultarEstado() {
    const ultimaLeitura = historico.length ? historico[historico.length - 1] : null;
    const ligacao = esp32Online ? 'ligado' : 'sem ligação ao ESP32';
    const estadoBomba = typeof estadoBombaESP32 === 'boolean'
      ? (estadoBombaESP32 ? 'ligada' : 'desligada')
      : 'desconhecido';
    const modo = operacaoAnual.modo === 'Manual' ? 'manual' : 'automático';
    const partes = [`O ESP32 está ${ligacao}.`, `A bomba de circulação está ${estadoBomba}.`, `O modo de operação é ${modo}.`];

    if (ultimaLeitura) {
      partes.push(
        `Última leitura: pH ${Number(ultimaLeitura.ph).toFixed(2)}, EC ${Number(ultimaLeitura.ec).toFixed(2)} milisiemens por centímetro e temperatura ${Number(ultimaLeitura.temp).toFixed(1)} graus.`
      );
      if (ultimaLeitura.ts) {
        partes.push(`Leitura recebida às ${new Date(ultimaLeitura.ts).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}.`);
      }
      partes.push(ultimaLeitura.alarme ? 'Existe um alarme activo.' : 'Sem alarme na última leitura.');
    } else {
      partes.push('Ainda não há leituras disponíveis.');
    }

    partes.push(mqttConnected ? 'Ligação MQTT activa.' : 'Ligação MQTT indisponível.');
    responder(partes.join(' '));
  }

  function processarComando(comando) {
    const texto = normalizar(comando).replace(/^atlas\b[\s,.:;-]*/, '').trim();
    if (transcript) transcript.textContent = `Ouvi: “${comando}”`;

    if (!texto) {
      responder('Estou pronta. Pode pedir o estado do sistema ou dar um comando para a bomba principal.');
      return;
    }

    if (/\b(nao|nunca)\s+(ligar|desligar)\b/.test(texto)) {
      responder('Não executei o comando porque a frase contém uma negação. Diga claramente ligar ou desligar a bomba.');
      return;
    }

    if (/\b(estado|status|situacao|situacao actual|como esta|consultar)\b/.test(texto)) {
      consultarEstado();
      return;
    }

    const querLigar = /\b(ligar|liga|ligue|activar|ativa|ative)\b/.test(texto) && /\b(bomba|circulacao)\b/.test(texto);
    const querDesligar = /\b(desligar|desliga|desligue)\b/.test(texto) && /\b(bomba|circulacao)\b/.test(texto);

    if (!querLigar && !querDesligar) {
      responder('Não reconheci o pedido. Diga status, ligar bomba principal ou desligar bomba principal.');
      return;
    }

    if (querLigar && querDesligar) {
      responder('O pedido ficou ambíguo. Diga apenas ligar bomba ou desligar bomba.');
      return;
    }

    const ligar = querLigar;
    if (operacaoAnual.modo !== 'Manual') {
      responder('Não alterei a bomba. Mude primeiro o sistema para o modo manual.');
      return;
    }
    if (!mqttConnected || !esp32Online) {
      responder('Não foi possível enviar o comando. Confirme a ligação MQTT e se o ESP32 está online.');
      return;
    }
    if (typeof estadoBombaESP32 !== 'boolean') {
      responder('Não alterei a bomba porque ainda não recebi o seu estado actual. Aguarde uma actualização do ESP32 e tente novamente.');
      return;
    }
    if (estadoBombaESP32 === ligar) {
      responder(`A bomba já está ${ligar ? 'ligada' : 'desligada'}.`);
      return;
    }

    acionarBomba('bombaCirculacao');
    responder(`Pedido para ${ligar ? 'ligar' : 'desligar'} a bomba enviado. A aguardar confirmação do ESP32.`);
  }

  if (statusButton) statusButton.addEventListener('click', consultarEstado);

  function iniciarEscuta() {
    if (!recognition) {
      if (statusMessage) {
        statusMessage.textContent = 'Este navegador não suporta reconhecimento de voz. Escreva o comando abaixo ou use a digitação por voz do teclado.';
        statusMessage.dataset.state = 'error';
      }
      if (commandInput) commandInput.focus();
      return;
    }
    if (listening) return;
    if (transcript) transcript.textContent = '';
    if (statusMessage) {
      statusMessage.textContent = 'A ouvir. Diga o seu comando.';
      statusMessage.dataset.state = 'listening';
    }
    listening = true;
    if (listenButton) listenButton.disabled = true;
    try {
      recognition.start();
      listenTimeout = setTimeout(() => {
        listenTimeout = null;
        if (statusMessage) {
          statusMessage.textContent = 'Tempo de escuta terminado. Não foi executada nenhuma acção.';
          statusMessage.dataset.state = 'idle';
        }
        recognition.abort();
      }, TEMPO_MAXIMO_ESCUTA_MS);
    } catch (erro) {
      listening = false;
      if (listenButton) listenButton.disabled = false;
      if (statusMessage) {
        statusMessage.dataset.state = 'error';
        statusMessage.textContent = `Não foi possível iniciar o microfone: ${erro.message}`;
      }
      console.error('[Assistente] Falha ao iniciar o reconhecimento de voz:', erro);
    }
  }

  if (listenButton) listenButton.addEventListener('click', iniciarEscuta);
  if (logoButton) logoButton.addEventListener('click', iniciarEscuta);
  if (commandForm) {
    commandForm.addEventListener('submit', evento => {
      evento.preventDefault();
      const comando = commandInput ? commandInput.value.trim() : '';
      if (!comando) {
        if (commandInput) commandInput.focus();
        return;
      }
      processarComando(comando);
      commandForm.reset();
    });
  }

  if (statusMessage && !recognition) {
    statusMessage.textContent = 'Voz indisponível neste navegador. Escreva um comando ou use a digitação por voz do teclado.';
    statusMessage.dataset.state = 'idle';
  } else if (statusMessage) {
    statusMessage.textContent = 'Toque em Falar ou escreva um comando.';
    statusMessage.dataset.state = 'idle';
  }

  if (recognition) {
    recognition.onresult = evento => {
      if (listenTimeout !== null) {
        clearTimeout(listenTimeout);
        listenTimeout = null;
      }
      const resultado = evento.results[evento.results.length - 1];
      if (resultado && resultado[0]) processarComando(resultado[0].transcript);
    };

    recognition.onerror = evento => {
      if (listenTimeout !== null) {
        clearTimeout(listenTimeout);
        listenTimeout = null;
      }
      if (statusMessage) {
        statusMessage.dataset.state = 'error';
        statusMessage.textContent = evento.error === 'not-allowed'
          ? 'Acesso ao microfone recusado. Autorize o microfone nas permissões do navegador.'
          : `Erro no reconhecimento de voz: ${evento.error}.`;
      }
      console.error('[Assistente] Erro no reconhecimento de voz:', evento.error);
    };

    recognition.onend = () => {
      listening = false;
      if (listenTimeout !== null) {
        clearTimeout(listenTimeout);
        listenTimeout = null;
      }
      if (listenButton) listenButton.disabled = false;
      if (statusMessage && statusMessage.dataset.state === 'listening') {
        statusMessage.textContent = 'Não foi detectado nenhum comando. Não foi executada nenhuma acção.';
        statusMessage.dataset.state = 'idle';
      }
    };
  }
})();
