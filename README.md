# Invito di Barbara · V5

Avvio locale con Node.js 22.13 o successivo:

```sh
npm run dev
```

- Invito: [http://127.0.0.1:4173/](http://127.0.0.1:4173/).
- Area Organizzazione: [http://127.0.0.1:4173/organizzazione?modalita=organizzazione](http://127.0.0.1:4173/organizzazione?modalita=organizzazione).
- Per tornare alla vista di un ospite: [http://127.0.0.1:4173/?modalita=ospite](http://127.0.0.1:4173/?modalita=ospite).

Il server locale usa identità di prova e scrive risposte, auguri e video nella cartella locale ignorata da Git. I file calendario generati in sviluppo rimandano all’indirizzo locale.

`npm run build` prepara il Worker e le migrazioni sotto `dist/`. Il Worker usa i binding D1 e R2 e l’identità fornita dalla piattaforma. La data della festa e le scadenze sono in [worker/event-details.json](worker/event-details.json).

Per ospitare l’invito con accesso tramite link su Sites, impostare `INVITATION_SECRET` come segreto di runtime di 32 byte in esadecimale. Il link per gli ospiti è `/invito/<codice>`, con codice HMAC-SHA-256 del testo `barbara:invite:v1` usando il segreto decodificato da esadecimale. L’area Organizzazione usa l’accesso ChatGPT per la mail in `ORGANIZER_EMAIL`. Le coordinate del bonifico sono configurate tramite `GIFT_RECIPIENT` e `GIFT_IBAN`; `GIFT_REFERENCE` è facoltativa.

## Pubblicazione da GitHub

Questo repository GitHub ospita il codice e la cartella dell’album. I file caricati in un repository pubblico sono accessibili anche da GitHub. GitHub Actions pubblica il backend su Cloudflare Workers, con D1 per le risposte e R2 privato per foto e video.

### Configurazione iniziale

1. Crea un database D1 e un bucket R2 privato su Cloudflare. Scegli il nome del Worker e attiva il sottodominio `workers.dev` del tuo account oppure configura un dominio.
2. In GitHub, sotto **Settings → Secrets and variables → Actions**, aggiungi queste variabili.

   | Variabile | Valore |
   | --- | --- |
   | `SITE_URL` | URL HTTPS degli invitati |
   | `CF_WORKER_NAME` | Nome del Worker |
   | `CF_D1_NAME` | Nome del database |
   | `CF_D1_ID` | Identificatore UUID del database |
   | `CF_R2_BUCKET` | Nome del bucket privato |
   | `CLOUDFLARE_ACCOUNT_ID` | Identificatore dell’account Cloudflare |

   Aggiungi `CLOUDFLARE_API_TOKEN` come **secret**. Il token deve consentire la pubblicazione del Worker, le migrazioni D1 e la scrittura in R2. Per abilitare il pulsante WhatsApp, aggiungi il secret facoltativo `CONTACT_URL` con il link `https://wa.me/…` completo.
3. Esegui **Actions → Pubblica il sito**. Al primo avvio l’invito resta chiuso fino alla configurazione dei segreti del Worker.
4. Nelle impostazioni **Variables and Secrets** del Worker aggiungi `INVITATION_SECRET` e `ORGANIZER_PASSWORD` come due segreti distinti. Genera ciascun valore con `openssl rand -hex 32`. Aggiungi `GIFT_RECIPIENT` e `GIFT_IBAN` se vuoi attivare i dati di pagamento. Conserva i valori fuori dal repository.
5. Con `SITE_URL` e `INVITATION_SECRET` in un file locale ignorato `.env.cloudflare`, esegui `node --env-file=.env.cloudflare scripts/invite-link.mjs` per generare il link da mandare agli invitati. Accedi a `/organizzazione` con l’utente `barbara` e la password `ORGANIZER_PASSWORD`.

### Giorno della festa e album

La vista passa automaticamente alle informazioni per la serata il 22 dicembre e ai ricordi alle 00:00 del 23 dicembre, ora italiana. Dopo la festa basta caricare le foto su GitHub nella cartella [foto-evento](foto-evento/README.md). Il flusso **Aggiorna l’album** le copia nell’archivio del sito.
