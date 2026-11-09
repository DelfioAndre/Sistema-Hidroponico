// Assistente de voz para consulta do estado e controlo da bomba de circulação.
(() => {
  const listenButton = document.getElementById('assistant-listen');
  const logoButton = document.getElementById('assistant-logo');
  const statusButton = document.getElementById('assistant-status');
  const voiceToggle = document.getElementById('assistant-voice-enabled');
  const statusMessage = document.getElementById('assistant-status-message');
  const transcript = document.getElementById('assistant-transcript');

  if (!listenButton || !statusButton || !voiceToggle || !statusMessage || !transcript) return;

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = Recognition ? new Recognition() : null;
  const normalizar = texto => texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim();

  if (recognition) {
    recognition.lang = 'pt-PT';
    recognition.continuous = false;
    recognition.interimResults = false;
  } else {
    listenButton.disabled = true;
    statusMessage.textContent = 'O reconhecimento de voz não é suportado neste navegador. Pode consultar o estado pelo botão.';
  }

  function responder(mensagem, falar = true) {
    statusMessage.textContent = mensagem;
    statusMessage.dataset.state = 'ok';
    if (!falar || !voiceToggle.checked || !('speechSynthesis' in window)) return;

    window.speechSynthesis.cancel();
    const fala = new SpeechSynthesisUtterance(mensagem);
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
    const texto = normalizar(comando);
    transcript.textContent = `Ouvi: “${comando}”`;

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

  statusButton.addEventListener('click', consultarEstado);

  function iniciarEscuta() {
    if (!recognition) return;
    transcript.textContent = '';
    statusMessage.textContent = 'A ouvir. Diga o seu comando.';
    statusMessage.dataset.state = 'listening';
    listenButton.disabled = true;
    try {
      recognition.start();
    } catch (erro) {
      listenButton.disabled = false;
      statusMessage.dataset.state = 'error';
      statusMessage.textContent = `Não foi possível iniciar o microfone: ${erro.message}`;
      console.error('[Assistente] Falha ao iniciar o reconhecimento de voz:', erro);
    }
  }

  listenButton.addEventListener('click', iniciarEscuta);
  if (logoButton) logoButton.addEventListener('click', iniciarEscuta);

  if (recognition) {
    recognition.onresult = evento => {
      const resultado = evento.results[evento.results.length - 1];
      if (resultado && resultado[0]) processarComando(resultado[0].transcript);
    };

    recognition.onerror = evento => {
      statusMessage.dataset.state = 'error';
      statusMessage.textContent = evento.error === 'not-allowed'
        ? 'Acesso ao microfone recusado. Autorize o microfone nas permissões do navegador.'
        : `Erro no reconhecimento de voz: ${evento.error}.`;
      console.error('[Assistente] Erro no reconhecimento de voz:', evento.error);
    };

    recognition.onend = () => {
      listenButton.disabled = false;
      if (statusMessage.dataset.state === 'listening') {
        statusMessage.textContent = 'Não foi detectado nenhum comando. Prima «Ouvir comando» para tentar novamente.';
        statusMessage.dataset.state = 'idle';
      }
    };
  }
})();
