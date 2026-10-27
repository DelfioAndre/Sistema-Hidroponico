# Histórico com funcionalidades gratuitas

O painel consulta e apresenta apenas registos dos últimos sete dias. O ESP32
continua a guardar cada leitura a cada 10 segundos. Não há exclusão automática
dos dados na Firebase: assim, o histórico guardado pode incluir períodos
anteriores à semana, enquanto houver espaço na quota gratuita do projecto.

Esta solução não usa Cloud Functions, Cloud Scheduler nem outros serviços
pagos. O plano gratuito do Firebase tem limites de armazenamento e tráfego,
portanto não há garantia de retenção indefinida. Acompanhe a utilização em
**Firebase Console → Realtime Database → Usage**. Se a quota for atingida, será
necessário exportar os dados e libertar espaço manualmente, ou reduzir a
frequência de gravação.

## Índices do Realtime Database

O Realtime Database precisa de índice pelo campo `timestamp` para executar as
consultas do painel de forma eficiente. No Firebase Console, abra
**Realtime Database → Regras** e acrescente `.indexOn` aos nós indicados,
preservando as regras de leitura e escrita que já existem:

```json
{
  "rules": {
    "sistema": {
      "leituras": {
        ".indexOn": ["timestamp"]
      },
      "alertas": {
        ".indexOn": ["timestamp"]
      },
      "eventos": {
        "comandos": {
          ".indexOn": ["timestamp"]
        }
      }
    }
  }
}
```

O exemplo mostra apenas onde acrescentar os índices; não substitua as regras
actuais por este fragmento, pois isso pode alterar as permissões do banco. A
configuração dos índices é feita nas regras do Realtime Database e não requer
Cloud Functions ou Cloud Scheduler.
