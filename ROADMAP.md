# Roadmap prodotto Memini

Aggiornata il 21 novembre 2026 · Prossimo traguardo **prima revisione di acquisto con buyer pilota**

Memini aiuta i piccoli importatori a ricostruire, prima del deposito o del saldo, cosa è stato pattuito, cosa è cambiato e su quali prove possono basarsi. Il **dossier dell’acquisto** comincia con il primo preventivo. Quando sorge un problema, il buyer può risalire agli accordi, alle revisioni e ai report senza ricominciare da chat e allegati sparsi.

Un buyer su Reddit racconta di aver richiamato l’accordo scritto nella pratica Trade Assurance dopo tre ispezioni fallite e di aver poi ricevuto un rimborso. È una testimonianza individuale. L’ipotesi da verificare è che Memini riduca il tempo per ricostruire la vicenda e faccia emergere differenze prima che il buyer decida se procedere. [Resoconto del buyer](https://www.reddit.com/r/Alibaba/comments/1q09ofb/part_3_my_trade_assurance_experience_refund/)

## Come aggiornare la roadmap

Spuntare una voce quando il criterio indicato è verificato. Per le attività avviate, aggiungere in coda alla voce **stato**, **responsabile** e **link alla PR o alla verifica**. Usare gli stati *Da fare*, *In corso*, *Bloccato* e *Verificato*. Le fasi sono ordinate per dipendenze. Il prototipo con dati di esempio può avanzare insieme alle basi tecniche. Responsabili e date si aggiungono quando il team li assegna.

## Prima del pilota

- [ ] **Accessi e allegati privati.** Sostituire lo spazio demo fisso con accesso autenticato e autorizzazioni per spazio di lavoro. Separare i dati demo e il reset. **Verifica** Due account con dati diversi possono operare sulle proprie pratiche e ricevono un rifiuto se provano ad accedere a pratiche, originali o esportazioni dell’altro. [Spazio demo attuale](lib/server.ts)
- [ ] **Importazione recuperabile.** Salvare l’originale prima dell’estrazione. Mostrare lo stato, consentire il retry senza duplicati e mettere in revisione PDF illeggibili, dati incerti e fornitori ambigui. **Verifica** Simulare timeout, ricarica della pagina, doppio invio e PDF illeggibile. L’originale resta recuperabile e la correzione manuale è disponibile.
- [ ] **Confronto attendibile.** Correggere l’evidenziazione del minimo di `Compare quotes`. Conservare importo e valuta come campi separati e confrontare le offerte sulla stessa base di prodotto, quantità, valuta e condizioni di consegna. Mostrare le voci mancanti e l’eventuale stima a destinazione con le ipotesi esplicite. **Verifica** Valute, quantità o Incoterm diversi senza normalizzazione impediscono l’evidenziazione di un prezzo migliore. [Confronto attuale](app/compare/page.tsx)
- [ ] **Ripristino e gestione errori.** Verificare backup, ripristino di database e allegati e segnalazione degli errori di elaborazione. **Verifica** Ripristinare una pratica di prova con cronologia e originali cliccabili.

## Primo flusso da mettere in mano ai buyer

- [ ] **Una pratica, un ingresso semplice.** Aprire un acquisto da un PDF o da un messaggio incollato, con conferma del fornitore quando serve. **Verifica** Un buyer crea la prima pratica da desktop e da smartphone senza configurare WeChat.
- [ ] **Storico degli accordi.** Conservare ogni versione della proforma e distinguere i termini proposti da quelli confermati dal buyer, con fonte e data. **Verifica** Dopo l’arrivo di una nuova versione, entrambi gli originali restano accessibili e si vede quale accordo era in vigore e quali campi sono cambiati. Riutilizzare i riferimenti a messaggi e documenti [già presenti nei fatti di Memini](lib/core/facts.ts).
- [ ] **Revisione prima del deposito.** Mettere in primo piano le differenze rilevanti di prezzo, quantità, consegna, pagamento e beneficiario. Ogni riga mostra il valore precedente, quello nuovo, il passaggio originale e la prossima azione. Il buyer può correggere un dato o copiare la richiesta in cinese. **Verifica** Nel caso demo, i cambi di Incoterm e beneficiario si trovano e si riconducono alla fonte su desktop e mobile. La vista distingue chiaramente dati mancanti, valori contestati e correzioni confermate.
- [ ] **Dossier esportabile.** Includere cronologia, termini confermati, differenze irrisolte e indice degli originali. Permettere al buyer di scegliere quali allegati condividere. **Verifica** Una persona esterna ricostruisce un cambio di condizioni dal dossier e dagli allegati selezionati, senza accesso all’account Memini.
- [ ] **Pilota con cinque buyer.** Usare trattative in corso e documenti opportunamente oscurati. Obiettivo iniziale proposto di **quattro buyer su cinque che completano la revisione senza aiuto in meno di cinque minuti**. Per misurare l’impatto, registrare separatamente discrepanze confermate, azioni prese dal buyer e rientri spontanei all’arrivo di una nuova proforma. Cronometrare anche il tempo per ritrovare l’accordo e le due prove principali con gli strumenti abituali e con Memini.

## Dopo il pilota

- [ ] **Timeline fino al saldo.** Campione, fine produzione, ispezione e spedizione, ciascuno con responsabile, data promessa, ultimo aggiornamento e fonte. **Verifica** Una data spostata lascia traccia della promessa precedente e crea una prossima azione visibile.
- [ ] **Esito dell’ispezione e correzioni.** Collegare report e campione approvato alla pratica. Registrare esito, azione correttiva, nuova verifica e decisione del buyer. **Verifica** Dopo un report negativo, il dossier mostra cosa è stato contestato, quale correzione è stata richiesta e quale prova la documenta.
- [ ] **Ingresso da WeChat e conferme dei fornitori.** Verificare prima sul campo consegna, duplicati e associazione alla pratica. Valutare un link con scadenza per confermare una data o caricare il documento richiesto se il pilota mostra che il passaggio manuale rallenta i buyer.

## Riferimenti di interfaccia

| Prodotto e schermata | Pattern da provare in Memini |
| --- | --- |
| [Adobe Acrobat Pro – risultati del confronto](https://helpx.adobe.com/acrobat/using/compare-documents.html) | Riepilogo dei cambiamenti sopra, poi confronto prima/dopo e accesso al punto esatto della fonte. In Memini la riga rappresenta un termine commerciale, per esempio l’Incoterm. |
| [SourceReady – confronto preventivi](https://www.sourceready.com/supplier-outreach) | Offerte affiancate con prezzo, quantità minima e tempi. In Memini rendere visibili valuta, luogo di consegna e dati mancanti accanto all’importo. |
| [Anvyl – dettaglio ordine e conferma tappe](https://anvylhelp.zendesk.com/hc/en-us/articles/14712939522573-Accept-your-first-purchase-order) | Una pagina per ordine con attività, documenti e conferme contestuali. In Memini, portare in alto la prossima azione del buyer. |
| [myQIMA – lista report e decisioni](https://www.qima.com/online-platform) | Esito e data vicino al report, con una decisione esplicita e una correzione da seguire. In Memini, collegare il report alla tappa di ispezione e al dossier. |

Le guide e le schermate pubbliche bastano a definire questi pattern. Se emerge una domanda precisa sul comportamento di una schermata, per esempio come gestisce due revisioni contemporanee, partire da una demo pubblica o da un account autorizzato. Valutare REA solo se serve osservare il comportamento dell’interfaccia che queste fonti non documentano.
