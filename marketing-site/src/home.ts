/** Home page body (website set, 10 Nov 2026): static HTML, German only. Every drawing is HTML and CSS (design/home.css);
 *  the starting state works without script, src/home-browser.ts adds the tap, the scroll scene, the calculator and the request draft. */
import { GATES, RECOVERY_COPY } from './claims.js';
import { terminCard } from './pages.js';
import { SITE, industries, industryKeys } from './site.js';

const price = `${SITE.price.amount} €`;

export const homeBody = (): string => `<a class="skip" href="#inhalt">Zum Inhalt springen</a>
<svg class="defs" width="0" height="0" aria-hidden="true"><defs>
  <symbol id="qr" viewBox="0 0 21 21"><rect width="21" height="21" fill="#fff"/><g fill="#17291F">
  <path d="M0 0h7v7H0zM1 1v5h5V1zM2 2h3v3H2zM14 0h7v7h-7zM15 1v5h5V1zM16 2h3v3h-3zM0 14h7v7H0zM1 15v5h5v-5zM2 16h3v3H2z" fill-rule="evenodd"/>
  <path d="M8 0h1v2H8zM10 1h2v1h-2zM9 3h2v2H9zM12 3h1v3h-1zM8 6h2v1H8zM11 7h1v2h-1zM0 8h2v1H0zM3 8h3v1H3zM7 8h1v3H7zM9 9h2v1H9zM13 8h2v2h-2zM16 8h1v1h-1zM18 8h3v1h-3zM1 10h2v2H1zM4 10h1v1H4zM14 11h3v1h-3zM19 10h1v3h-1zM8 12h4v1H8zM0 13h1v1H0zM3 12h2v1H3zM13 13h1v2h-1zM16 13h2v1h-2zM9 14h2v2H9zM15 15h1v2h-1zM17 15h3v1h-3zM8 17h1v2H8zM11 17h2v1h-2zM14 18h2v3h-2zM18 17h1v2h-1zM10 19h2v2h-2zM17 20h4v1h-4z"/></g></symbol>
</defs></svg>

<header class="top" id="top">
  <div class="wrap">
    <a class="brand" href="/" aria-label="Loynara, zur Startseite"><img class="mark-img" src="/assets/loynara-mark.svg" width="38" height="38" alt="">Loynara</a>
    <nav class="nav" aria-label="Hauptnavigation"><a href="#ablauf">So funktioniert’s</a><a href="#geschaefte">Für dein Geschäft</a><a href="#preis">Preis</a><a href="#fragen">Fragen</a></nav>
    <div class="acts">
      <a class="login" href="${SITE.loginUrl}">Anmelden</a>
      <a class="btn btn-pri btn-sm" href="#rq" data-want="start"><span class="long">Ersten Monat gratis starten</span><span class="short">1. Monat gratis</span></a>
      <button class="menu" id="menuBtn" type="button" aria-label="Menü öffnen" aria-expanded="false" aria-controls="sheet"><span></span><span></span><span></span></button>
    </div>
  </div>
  <nav class="sheet" id="sheet" aria-label="Menü"><a href="#ablauf">So funktioniert’s</a><a href="#geschaefte">Für dein Geschäft</a><a href="#preis">Preis</a><a href="#fragen">Fragen</a><a class="login-row" href="${SITE.loginUrl}">Anmelden</a></nav>
</header>

<main id="inhalt">
<section class="hero" aria-labelledby="h-hero">
  <div class="wrap">
    <h1 id="h-hero"><span class="ln">Ein guter Besuch.</span> <span class="ln g">Ein Grund, wiederzukommen.</span></h1>
    <div class="hero-stage">
      <div class="side">
        <p class="lede">Die digitale Stempelkarte für deinen Tresen. Tippe auf das Schild wie dein Kunde: Dein Team bestätigt, der Stempel landet.</p>
        <a class="btn btn-pri" href="#rq" data-want="start">Ersten Monat gratis starten</a>
      </div>
      <div class="phone" id="heroPhone" aria-hidden="true"><i class="notch"></i><div class="scr">
        <div class="banner" id="heroBanner"><i></i><span>Dein Team hat bestätigt</span></div>
        <div class="shopline"><span class="logo">G</span>Pizzeria Da Gino</div>
        <p class="goalline" id="heroGoal">Noch 5 Stempel bis zu deiner Prämie:</p>
        <div class="card"><b>Pizza aufs Haus</b><small>ab 8 Stempeln</small>
          <div class="stamps" id="heroStamps"><i class="st on" data-rot="-8"></i><i class="st on" data-rot="5"></i><i class="st on" data-rot="-3"></i><i class="st"></i><i class="st"></i><i class="st"></i><i class="st"></i><i class="st"></i></div>
          <div class="count"><span>Beispiel</span><span id="heroCount">3 von 8</span></div>
        </div>
      </div></div>
      <div class="side r">
        <p><b>${price} pro Monat und Standort.</b><br>Der erste Monat ist gratis.<br>Antippen oder QR-Code, ohne App.</p>
        <a class="btn btn-sec" href="#rq" data-want="demo">Demo anfragen</a>
      </div>
    </div>
    <div class="tapzone">
      <button class="tap" id="tap" type="button" aria-label="Hier tippen: einen Stempel auf der Beispielkarte vergeben" aria-describedby="tapNote">
        <span class="plate"><span class="pl"><i aria-hidden="true"><img src="/assets/loynara-mark.svg" alt=""><span class="ring"></span></i><b>Hier tippen</b><span class="q" aria-hidden="true"><svg viewBox="0 0 21 21"><use href="#qr"/></svg></span></span></span>
      </button>
      <p class="sr" id="tapNote">Beispiel. Nichts wird gespeichert.</p>
      <p class="sr" role="status" id="tapStatus"></p>
    </div>
    <div class="mobile-acts" id="mobileActs">
      <a class="btn btn-pri" href="#rq" data-want="start">Ersten Monat gratis starten</a>
      <a class="btn btn-sec" href="#rq" data-want="demo">Demo anfragen</a>
      <p class="price">${price} pro Monat und Standort. Der erste Monat ist gratis.</p>
    </div>
  </div>
</section>

<section class="scene" id="ablauf" data-step="0" aria-labelledby="h-scene">
  <h2 class="sr" id="h-scene">So läuft ein Besuch</h2>
  <div class="stage">
    <div class="wrap">
      <div class="steps">
        <div class="track" aria-hidden="true"><i class="on"></i><i></i><i></i><i></i><b id="trackLabel">1 von 4</b></div>
        <article class="step"><div><h2>Antippen. Ohne App.</h2><p class="lede">Dein Kunde hält sein Handy an das Schild oder scannt den QR-Code. Seine Karte öffnet sich im Browser, ohne Konto.</p></div>
          <div class="still" aria-hidden="true"><div><div class="tone-terra pw-180 phone"><i class="notch"></i><div class="scr"><div class="shopline"><span class="logo">G</span>Pizzeria Da Gino</div><div class="card"><b>Pizza aufs Haus</b><div class="stamps"><i class="st on"></i><i class="st on"></i><i class="st on"></i><i class="st on"></i><i class="st"></i><i class="st"></i><i class="st"></i><i class="st"></i></div></div></div></div><span class="plate-still plate"><span class="pl"><i aria-hidden="true"><img src="/assets/loynara-mark.svg" alt=""></i>Antippen<span class="q"><svg viewBox="0 0 21 21"><use href="#qr"/></svg></span></span></span><p class="ex">Beispiel</p></div></div></article>
        <article class="step"><div><h2>Dein Team bestätigt.</h2><p class="lede">Ein Stempel zählt erst, wenn dein Team ihn mit einem Tipp bestätigt. So bleibt jeder Stempel echt.</p></div>
          <div class="still" aria-hidden="true"><div><div class="pw-170 phone cashier"><i class="notch"></i><div class="scr"><p class="k">Neue NFC-Anfrage</p><p class="v">K-7QX2MA</p><div class="ok">Stempel bestätigen</div><div class="no">Ablehnen</div></div></div><p class="ex">Beispiel</p></div></div></article>
        <article class="step"><div><h2>Der Stempel landet.</h2><p class="lede">Auf der Karte im Browser und, auf Wunsch, in Apple Wallet. Ein paar Besuche später wartet die Prämie.</p></div>
          <div class="still" aria-hidden="true"><div><div class="tone-terra pw-180 phone"><i class="notch"></i><div class="scr"><div class="shopline"><span class="logo">G</span>Pizzeria Da Gino</div><div class="card"><b>Pizza aufs Haus</b><div class="stamps"><i class="st on"></i><i class="st on"></i><i class="st on"></i><i class="st on"></i><i class="st on"></i><i class="st"></i><i class="st"></i><i class="st"></i></div><div class="count"><span>Beispiel</span><span>5 von 8</span></div></div></div></div></div></div></article>
        <article class="step dark"><div><h2>Und manchmal eine Nachricht.</h2><p class="lede">Hat dein Kunde die Karte auf Wunsch in Apple Wallet, schreibst du ihm auf den Sperrbildschirm. Höchstens zwei Nachrichten in sieben Tagen, und nur, wenn er zugestimmt hat.</p></div>
          <div class="still" aria-hidden="true"><div><div class="pw-200 phone lock"><i class="notch"></i><div class="scr"><p class="time">9:41</p><p class="date">Donnerstag, 12. November</p><div class="note"><span class="ic">G</span><div><b>Pizzeria Da Gino<em>jetzt</em></b><p>Heute ab 15 Uhr: die zweite Pizza zum halben Preis.</p></div></div></div></div><p class="ex">Beispiel</p></div></div></article>
      </div>
      <div class="objs" aria-hidden="true">
        <div class="phone" id="scenePhone"><i class="notch"></i><div class="scr">
          <div class="shopline"><span class="logo">G</span>Pizzeria Da Gino</div>
          <p class="goalline" id="sceneGoal">Noch 5 Stempel bis zu deiner Prämie:</p>
          <div class="card"><b>Pizza aufs Haus</b><small>ab 8 Stempeln</small>
            <div class="stamps" id="sceneStamps"><i class="st on" data-rot="-8"></i><i class="st on" data-rot="4"></i><i class="st on" data-rot="-2"></i><i class="st" data-rot="7"></i><i class="st"></i><i class="st"></i><i class="st"></i><i class="st"></i></div>
            <div class="count"><span>Beispiel</span><span id="sceneCount">3 von 8</span></div>
          </div>
          <div class="ticket"><svg class="qr" viewBox="0 0 21 21"><use href="#qr"/></svg><span>Kartennummer<strong>K-7QX2MA</strong></span></div>
          <p class="walletline"><i></i>Auch in Apple Wallet, auf Wunsch</p>
        </div></div>
        <div class="phone team cashier"><i class="notch"></i><div class="scr"><p class="k">Neue NFC-Anfrage</p><p class="v">K-7QX2MA</p><p class="w">am Schild, gerade eben · Beispiel</p><div class="ok">Stempel bestätigen</div><div class="no">Ablehnen</div></div></div>
        <span class="plate"><span class="pl"><i aria-hidden="true"><img src="/assets/loynara-mark.svg" alt=""></i>Antippen oder scannen<span class="q"><svg viewBox="0 0 21 21"><use href="#qr"/></svg></span></span></span>
        <div class="phone wallet lock"><i class="notch"></i><div class="scr">
          <p class="time">9:41</p><p class="date">Donnerstag, 12. November</p>
          <div class="note"><span class="ic">G</span><div><b>Pizzeria Da Gino<em>jetzt</em></b><p>Heute ab 15 Uhr: die zweite Pizza zum halben Preis.</p></div></div>
          <div class="pass"><b>Pizzeria Da Gino</b> · Beispiel<div class="dots" id="passDots"><i class="on"></i><i class="on"></i><i class="on"></i><i></i><i></i><i></i><i></i><i></i></div></div>
        </div></div>
      </div>
    </div>
  </div>
</section>

<section class="block" id="geschaefte" aria-labelledby="h-shops">
  <div class="wrap">
    <div class="head"><h2 id="h-shops">Für jedes Geschäft mit Stammkunden.</h2><p class="lede">Du legst fest, wie viele Stempel es braucht und was es dafür gibt. Ein paar Beispiele, wie es aussehen kann.</p></div>
    <div class="chips" role="group" aria-label="Art des Geschäfts">
      <button type="button" aria-pressed="true" data-shop="barber">Friseur / Barbershop</button><button type="button" aria-pressed="false" data-shop="nails">Nagelstudio</button><button type="button" aria-pressed="false" data-shop="pizza">Pizzeria / Imbiss</button><button type="button" aria-pressed="false" data-shop="cafe">Café / Bäckerei</button><button type="button" aria-pressed="false" data-shop="other">Anderes Geschäft</button>
    </div>
    <div class="shops">
      <article class="shop big show" data-shop="barber"><div><h3>Friseur und Barbershop</h3><p class="reward">Nach 8 Stempeln ist der Haarschnitt gratis.</p></div>
        <div class="tone-navy mini"><b>Barbershop Kaan</b><small>Beispiel</small><div class="stamps" data-cols="4"><i class="st on"></i><i class="st on" data-rot="5"></i><i class="st on"></i><i class="st on" data-rot="3"></i><i class="st on" data-rot="-4"></i><i class="st"></i><i class="st"></i><i class="st"></i></div></div></article>
      <article class="shop" data-shop="nails"><h3>Nagelstudio</h3>
        <div class="tone-graphite mini"><b>Studio Aylin</b><small>Beispiel</small><div class="stamps" data-cols="3"><i class="st on"></i><i class="st on" data-rot="5"></i><i class="st on"></i><i class="st"></i><i class="st"></i><i class="st"></i></div></div>
        <p class="reward">Nach 6 Stempeln gibt es das Nageldesign gratis.</p></article>
      <article class="shop" data-shop="pizza"><h3>Pizzeria und Imbiss</h3>
        <div class="tone-terra mini"><b>Imbiss am Markt</b><small>Beispiel · Punktekarte</small><div class="ladder"><i></i></div><small class="mt-8">62 von 100 Punkten</small></div>
        <p class="reward">1 Punkt pro Euro. Bei 100 Punkten geht das Essen aufs Haus.</p></article>
      <article class="shop" data-shop="cafe"><h3>Café und Bäckerei</h3>
        <div class="tone-green mini"><b>Café Morgenlicht</b><small>Beispiel</small><div class="stamps" data-cols="5"><i class="st on"></i><i class="st on" data-rot="5"></i><i class="st on"></i><i class="st on"></i><i class="st"></i><i class="st"></i><i class="st"></i><i class="st"></i><i class="st"></i><i class="st"></i></div></div>
        <p class="reward">Nach 10 Stempeln geht der Kaffee aufs Haus.</p></article>
      <article class="shop" data-shop="other"><h3>Und jedes andere Geschäft</h3>
        <p class="tags"><span>Eisdiele</span><span>Waschanlage</span><span>Blumenladen</span><span>Fitness</span><span>Kosmetik</span></p>
        <p class="reward">Du wählst Stempel oder Punkte und deine eigene Prämie.</p></article>
    </div>
  </div>
</section>

<section class="block" id="funktionen" aria-labelledby="h-feat">
  <div class="wrap">
    <div class="head"><h2 id="h-feat">Was zu deiner Karte gehört.</h2></div>
    <div class="bento">
      <article class="tile t-team"><h3>Dein Team bestätigt jeden Stempel.</h3><p>Tippt ein Kunde aufs Schild, sieht dein Team eine Anfrage. Oder es scannt die Karte. Ein Tipp, und der Stempel ist vergeben.</p>
        <div class="draw"><div class="cash"><p class="k">Neue NFC-Anfrage</p><p class="v">K-3HN7TW</p><div class="ok">Stempel bestätigen</div></div><p class="ex">Beispiel</p></div></article>
      <article class="tile t-wallet"><h3>Apple Wallet, auf Wunsch.</h3><p>Die Karte liegt auf Wunsch in Apple Wallet. Neue Stempel erscheinen dort gleich nach der Bestätigung. Wer zugestimmt hat, bekommt deine Nachricht auf den Sperrbildschirm, höchstens zwei in sieben Tagen.</p>
        <div class="draw"><div class="lockmini"><p class="time">9:41</p><div class="note"><span class="ic-green ic">M</span><div><b>Café Morgenlicht<em>jetzt</em></b><p>Diese Woche gibt es zu jedem Kaffee ein Croissant dazu.</p></div></div></div><p class="ex">Beispiel</p></div></article>
      <article class="tile t-board"><h3>Du siehst, wie viele wiederkommen.</h3><p>Wie viele Karten wiederkommen, wie viele Buchungen und Einlösungen es gab: auf einen Blick am Handy.</p>
        <div class="draw board"><p class="big"><small class="lbl">Wiederkehrende Karten</small>38<small>73 % der Karten mit Buchung</small></p><div><div class="bars" aria-hidden="true"><i data-h="40"></i><i data-h="58"></i><i data-h="34"></i><i data-h="52"></i><i data-h="74"></i><i class="n" data-h="94"></i><i class="zu"></i></div><div class="days" aria-hidden="true"><span>Mo</span><span>Di</span><span>Mi</span><span>Do</span><span>Fr</span><span>Sa</span><span>So</span></div></div></div>
        <p class="ex">Beispielzahlen · Buchungen pro Tag, sonntags geschlossen</p></article>
      <article class="tile t-points"><h3>Stempel oder Punkte, du wählst.</h3><p>1 Punkt pro Euro, dein Team tippt den Betrag ein. Passt gut zu Pizzeria und Imbiss.</p>
        <div class="draw"><p class="pts">84 <small>Punkte</small></p><div class="lad"><i></i><em>100 · Essen aufs Haus</em></div><p class="mt-22 ex">Beispiel</p></div></article>
      <article class="tile t-ref"><h3>Stammkunden können Neue mitbringen.</h3><p>Den Bonus gibt es erst, wenn dein Team den ersten Besuch von Jonas bestätigt.</p>
        <div class="draw"><div class="lena"><span class="av">L</span><div><b>Lena hat Jonas eingeladen</b><span>Erster Besuch bestätigt</span></div></div><p class="ex">Beispiel</p></div></article>
      <article class="tile t-lost"><h3>Karte weg? Der Stand bleibt.</h3><p>Mit bestätigter E-Mail-Adresse holt sich dein Kunde die Karte über „Karte wiederfinden“ selbst zurück. Sonst stellst du oder deine Leitung sie neu aus: gleicher Stand, gleiche Kartennummer.</p>
        <div class="draw"><div class="ticket"><svg class="qr" viewBox="0 0 21 21"><use href="#qr"/></svg><span>Kartennummer<strong>K-8TW4ZM</strong></span></div><p class="ex">Beispiel</p></div></article>
      <article class="tile t-bonus"><h3>Extras, wenn du willst.</h3><p>Kunden zurückholen, die länger nicht da waren. Bei Punkten nach Einkaufswert ruhige Stunden mit Happy Hour füllen. Und mit Apple Wallet, auf Wunsch, Geburtstage feiern.</p>
        <div class="draw"><p class="tags"><span>Willkommen zurück</span><span>Happy Hour</span><span>Geburtstags-Bonus</span></p></div></article>
    </div>
  </div>
</section>

<section class="block" id="rechner" aria-labelledby="h-calc">
  <div class="wrap">
    <div class="head"><h2 id="h-calc">Was wäre ein zusätzlicher Besuch wert?</h2><p class="lede">Deine Zahlen, deine Annahme.</p></div>
    <div class="calc">
      <form class="sliders" id="calcForm">
        <div class="sl"><label for="k">Käufe pro Tag <output id="ko" for="k">50</output></label><input id="k" type="range" min="5" max="300" value="50" aria-valuetext="50 Käufe"><small>Einkäufe, nicht verschiedene Personen.</small></div>
        <div class="sl"><label for="w">Durchschnittlicher Einkaufswert <output id="wo" for="w">7 €</output></label><input id="w" type="range" min="2" max="80" value="7" aria-valuetext="7 €"></div>
        <div class="sl"><label for="z">Angenommene Zunahme der Käufe <output id="zo" for="z">10 %</output></label><input id="z" type="range" min="1" max="30" value="10" aria-valuetext="10 %"><small>Deine Annahme, kein Erfahrungswert von Loynara.</small></div>
      </form>
      <div class="result"><p>Zusätzlicher Monatsumsatz im Beispiel</p><p class="n" id="res">910 €</p>
        <dl><dt>Loynara</dt><dd>${price} pro Monat</dd><dt>Nach Gebühr</dt><dd id="net">+861 €</dd></dl>
        <p class="fine">Rechenbeispiel bei 26 Öffnungstagen, keine Umsatzprognose. Wareneinsatz, Prämien, zusätzliche Arbeitskosten und Steuern sind nicht berücksichtigt.</p>
        <p class="sr" aria-live="polite" id="calcSay"></p></div>
    </div>
  </div>
</section>

<section class="block" id="preis" aria-labelledby="h-price">
  <div class="wrap">
    <div class="head"><h2 id="h-price">Ein Preis pro Standort.</h2></div>
    <div class="price">
      <div class="pcard"><p class="amt">${price}</p><p class="per">pro Monat und Standort</p>
        <div class="free"><i class="ck" aria-hidden="true"></i><div><b>Der erste Monat ist gratis.</b><span>Zahlungsdaten erst ab dem zweiten Monat. Monatlich kündbar, keine Einrichtungsgebühr.</span></div></div>
        <div class="acts"><a class="btn btn-pri" href="#rq" data-want="start">Ersten Monat gratis starten</a><a class="btn btn-sec" href="#rq" data-want="demo">Demo anfragen</a></div></div>
      <ul class="incl" aria-label="Im Preis enthalten">
        <li>Stempel- oder Punktekarte mit deinen Prämien</li><li>NFC-Antippen und QR-Einstieg am Tresen</li><li>Bestätigung durch dein Team, mit Rollen</li><li>Apple Wallet auf Wunsch. Nachrichten zeigen wir als Ausblick und vereinbaren sie gesondert</li><li>Empfehlungen und Willkommen-zurück-Bonus</li><li>Happy Hour bei Punkten nach Einkaufswert, Geburtstags-Bonus mit Apple Wallet</li><li>Überblick, wie viele wiederkommen</li><li>Kunden, Karten und dein Team kosten nichts extra</li>
      </ul>${GATES.bookingLive ? `<div class="price-pair">${terminCard()}</div>` : ''}
    </div>
  </div>
</section>

<section class="block" id="fragen" aria-labelledby="h-faq">
  <div class="wrap">
    <div class="head"><h2 id="h-faq">Gut zu wissen.</h2></div>
    <div class="faq">
      <details><summary>Müssen meine Kunden eine App installieren?</summary><p>Nein. Dein Kunde hält sein Handy an das NFC-Schild am Tresen oder scannt den QR-Code. Die Karte öffnet sich im Browser, ein Konto braucht er nicht.</p></details>
      <details><summary>Was macht mein Team an der Kasse?</summary><p>Dein Team sieht die Anfrage oder scannt die Karte und bestätigt den Besuch. Klappt der Scan nicht, findet dein Team die Karte über ihre kurze Kartennummer im Format K-XXXXXX. Erst dann gibt es einen Stempel, genau einmal. Bei Punkten nach Einkaufswert tippt dein Team den Betrag ein. Bezahlt wird wie bisher. Loynara ist keine Kassenanbindung und kein Bezahlsystem.</p></details>
      <details><summary>Und wenn ein Handy kein NFC kann?</summary><p>Dann scannt dein Kunde den QR-Code. Er öffnet dieselbe Karte und bleibt immer als Alternative.</p></details>
      <details><summary>Was kostet Loynara?</summary><p>${price} pro Monat und Standort. Der erste Monat ist gratis, Zahlungsdaten brauchen wir erst ab dem zweiten Monat. Hörst du im ersten Monat auf, kostet es nichts. Sonst läuft es Monat für Monat weiter. Kündigen kannst du zum Ende jedes Abrechnungsmonats, spätestens 14 Tage vorher. Eine Einrichtungsgebühr gibt es nicht, und Kunden, Karten und dein Team kosten nichts extra.</p></details>
      <details><summary>Bekommen meine Kunden Werbung per E-Mail?</summary><p>Nein. Werbung bekommen deine Kunden nur auf Wunsch über Apple Wallet, und nur, wenn sie zugestimmt haben. Wer möchte, hinterlegt eine E-Mail-Adresse. Sie dient nur dazu, eine verlorene Karte wiederzufinden.</p></details>
      <details><summary>Was passiert, wenn jemand seine Karte nicht mehr findet?</summary><p>${RECOVERY_COPY.lostAnswer}</p></details>
      <details><summary>Was passiert bei einem falsch gebuchten Stempel?</summary><p>Eine falsche Buchung korrigierst du oder deine Leitung mit Begründung. Die ursprüngliche Buchung und die Korrektur bleiben im Verlauf nachvollziehbar.</p></details>
    </div>
  </div>
</section>
</main>

<section class="close on-field" id="anfrage" aria-labelledby="h-close">
  <div class="wrap">
    <div>
      <h2 id="h-close">Gib dem nächsten Besuch einen Grund.</h2>
      <p class="lede">Wir richten deinen Gratis-Monat mit dir ein, oder wir zeigen dir Loynara erst am Beispiel deines Geschäfts.</p>
      <ol class="steps3"><li><div><b>Anfrage senden</b>Du schickst die vorbereitete E-Mail ab.</div></li><li><div><b>Wir melden uns</b>Und stimmen einen Termin mit dir ab.</div></li><li><div><b>Start an deinem Tresen</b>Wir richten Karte und Schild mit dir ein.</div></li></ol>
      <p class="mail">Oder direkt: E-Mail an <a href="mailto:${SITE.supportEmail}">${SITE.supportEmail}</a></p>
    </div>
    <form class="form" id="rq" novalidate tabindex="-1">
      <h3>Anfrage vorbereiten</h3>
      <label for="rq-shop">Geschäft<input id="rq-shop" name="shop" autocomplete="organization" maxlength="120" required aria-describedby="rq-err"></label>
      <p class="err" id="rq-err">Bitte gib den Namen deines Geschäfts ein.</p>
      <label for="rq-type">Branche <span>optional</span><select id="rq-type" name="type"><option value="">Bitte wählen</option>${industryKeys.map(k => `<option>${industries[k].label}</option>`).join('')}<option>Anderes</option></select></label>
      <label for="rq-want">Was möchtest du? <select id="rq-want" name="want"><option value="start">Ersten Monat gratis starten</option><option value="demo">Erst eine Demo sehen</option></select></label>
      <label for="rq-msg">Kurze Nachricht <span>optional</span><textarea id="rq-msg" name="msg" maxlength="1200"></textarea></label>
      <button class="btn btn-pri" type="submit">E-Mail vorbereiten</button>
      <p class="fine">Die Anfrage wird in deinem E-Mail-Programm geöffnet. Gesendet wird sie erst dort.</p>
      <button class="btn btn-sec" type="button" id="rq-copy">Text kopieren</button>
      <p class="sent" role="status" id="rq-sent"></p>
    </form>
  </div>
  <div class="bookend" aria-hidden="true"><span class="plate"><span class="pl"><i aria-hidden="true"><img src="/assets/loynara-mark.svg" alt=""></i>Antippen oder scannen<span class="q"><svg viewBox="0 0 21 21"><use href="#qr"/></svg></span></span></span></div>
</section>
<footer><div class="wrap"><div class="rule"><a href="/fuer-barber/">Für Barber</a><a href="/fuer-pizzerien/">Für Pizzerien</a>${GATES.bookingLive ? '<a href="/fuer-salons/">Für Salons</a>' : ''}<a href="/empfehlungen/">Kunden werben Kunden</a><a href="/impressum/">Impressum</a><a href="/datenschutz/">Datenschutz</a><a href="${SITE.loginUrl}">Anmelden</a><span class="c">© Loynara</span></div></div></footer>

<nav class="bar" id="bar" aria-label="Anfrage" inert><a class="btn btn-sec" href="#rq" data-want="demo">Demo anfragen</a><a class="btn btn-pri" href="#rq" data-want="start">1. Monat gratis</a></nav>`;
