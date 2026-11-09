// Assistente de voz para consulta do estado e controlo da bomba de circulação.
(() => {
  const NOME_ASSISTENTE = 'Atlas';
  const TEMPO_MAXIMO_ESCUTA_MS = 8000;
  const logoButton = document.getElementById('assistant-logo');

  if (!logoButton) return;

  const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = Recognition ? new Recognition() : null;
  let listenTimeout = null;
  let listening = false;
  let preparingToListen = false;
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

  function atualizarBotao(mensagem) {
    const texto = `Atlas: ${mensagem}`;
    logoButton.title = texto;
    logoButton.setAttribute('aria-label', texto);
  }

  function falar(mensagem, aoTerminar) {
    if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      if (aoTerminar) aoTerminar();
      return;
    }

    window.speechSynthesis.cancel();
    const fala = new SpeechSynthesisUtterance(`${NOME_ASSISTENTE}: ${mensagem}`);
    fala.lang = 'pt-PT';
    if (aoTerminar) fala.onend = aoTerminar;
    fala.onerror = evento => {
      console.error('[Assistente] Falha na resposta por voz:', evento.error);
      if (aoTerminar) aoTerminar();
    };
    window.speechSynthesis.speak(fala);
  }

  function responder(mensagem, falarEmVoz = true) {
    atualizarBotao(mensagem);
    if (falarEmVoz) falar(mensagem);
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

  function iniciarReconhecimento() {
    preparingToListen = false;
    if (listening) return;
    atualizarBotao('A ouvir. Diga o seu comando.');
    listening = true;
    try {
      recognition.start();
      listenTimeout = setTimeout(() => {
        listenTimeout = null;
        atualizarBotao('Tempo de escuta terminado. Não foi executada nenhuma acção.');
        recognition.abort();
      }, TEMPO_MAXIMO_ESCUTA_MS);
    } catch (erro) {
      listening = false;
      atualizarBotao(`Não foi possível iniciar o microfone: ${erro.message}`);
      console.error('[Assistente] Falha ao iniciar o reconhecimento de voz:', erro);
    }
  }

  function iniciarEscuta() {
    if (listening || preparingToListen) return;
    if (!recognition) {
      const mensagem = 'Este navegador não suporta reconhecimento de voz.';
      atualizarBotao(mensagem);
      responder(mensagem);
      return;
    }
    preparingToListen = true;
    atualizarBotao('A preparar o microfone.');
    falar('Estou a ouvir. Pode dizer o seu comando.', iniciarReconhecimento);
  }

  if (logoButton) logoButton.addEventListener('click', iniciarEscuta);

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
      const mensagem = evento.error === 'not-allowed'
        ? 'Acesso ao microfone recusado. Autorize o microfone nas permissões do navegador.'
        : `Erro no reconhecimento de voz: ${evento.error}.`;
      atualizarBotao(mensagem);
      console.error('[Assistente] Erro no reconhecimento de voz:', evento.error);
    };

    recognition.onend = () => {
      listening = false;
      if (listenTimeout !== null) {
        clearTimeout(listenTimeout);
        listenTimeout = null;
      }
      if (logoButton.title === 'Atlas: A ouvir. Diga o seu comando.') {
        atualizarBotao('Não foi detectado nenhum comando. Não foi executada nenhuma acção.');
      }
    };
  }
})();
