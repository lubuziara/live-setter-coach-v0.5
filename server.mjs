import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");

// Klucz może być zapisany lokalnie w pliku .env. Plik nie jest wysyłany
// do przeglądarki i nie należy dodawać go do repozytorium ani udostępniać.
const envFile = path.join(root, ".env");
if (fs.existsSync(envFile)) {
  for (const rawLine of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

const port = Number(process.env.PORT || 4173);

function json(res, status, body) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(body));
}

async function readBody(req, limit = 25_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error("Za duży plik.");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function requireKey(res) {
  if (!process.env.OPENAI_API_KEY) {
    json(res, 503, { error: "Brak OPENAI_API_KEY. Uruchom aplikację z kluczem w zmiennej środowiskowej." });
    return false;
  }
  return true;
}

function transcriptContextFrom(req) {
  const encoded = String(req.headers["x-transcript-context"] || "");
  try {
    return decodeURIComponent(encoded).replace(/\s+/g, " ").trim().slice(-1200);
  } catch {
    return "";
  }
}

/* Legacy live-suggestion prompt removed: this version performs diagnosis only.
Firma pomaga przedsiębiorcom uporządkować marketing w social mediach: strategię, treści, regularność, reklamy, proces pozyskiwania klientów i automatyzację. Celem settera jest dobrze zrozumieć sytuację oraz ból klienta i umówić konsultację ze specjalistą. Setter nie wykonuje pełnej kwalifikacji closera i nie sprzedaje rozwiązania przez telefon.

GRANICE SETTINGU — BEZWZGLĘDNE:
- Nigdy nie pytaj o budżet, kwoty, widełki, koszty, przychody, obrót, gotowość finansową ani cenę obecnej usługi.
- Nigdy nie pytaj, kto podejmuje decyzję, kto jest osobą decyzyjną ani czy rozmówca może sam zdecydować.
- Nigdy nie pytaj o statystyki liczbowe: liczbę zapytań, leadów, klientów, rezerwacji, sprzedaży, wyświetleń, obserwujących, konwersję, procenty ani wartości zleceń.
- Nigdy nie zaczynaj pytania od "Ile", "Ilu", "Jak często", "Jaka liczba", "Jaki procent" ani "Średnio". Nie pytaj o wyniki miesięczne, tygodniowe ani dzienne.
- Nie umieszczaj tych tematów w "missing", "stageGoal", "diagnosis", "problem" ani sugestiach. To są tematy closera.
- Możesz ustalić jakościowo: skąd przychodzą klienci, co działa lub nie działa, czego klient chce więcej, co go blokuje, jaki jest skutek problemu, dlaczego chce zmiany teraz i czy woli działać sam czy oddelegować pracę.

NAJWAŻNIEJSZA ZASADA:
Nie prowadź rozmowy z gotowej checklisty. Najpierw znajdź ostatnią konkretną informację klienta, której znaczenie nie zostało jeszcze wyjaśnione. Następne pytanie ma pogłębiać dokładnie tę informację.
Pytanie powinno zawierać słowo, kanał, usługę, proces albo problem, o którym klient właśnie mówił. Jeżeli to samo pytanie można bez zmian zadać dowolnej firmie, jest zbyt ogólne — napisz je ponownie.

LOGIKA DIAGNOZY:
1. POWÓD TERAZ — co sprawiło, że klient zgłosił się właśnie teraz.
2. KONTEKST — czym się zajmuje, co chce promować i skąd obecnie trafiają klienci.
3. STAN OBECNY — jak dziś prowadzi marketing, kto go wykonuje i co już było próbowane.
4. DOKŁADNY BÓL — co konkretnie nie działa, w którym miejscu proces się zatrzymuje i co klient rozumie przez ogólne słowa typu "chaos", "słabi klienci", "monetyzacja" lub "brak strategii".
5. KONSEKWENCJA — jak problem wpływa na czas, kontrolę nad firmą, regularność, wybór zleceń, rozwój albo codzienne funkcjonowanie.
6. STAN DOCELOWY — co ma działać inaczej po rozwiązaniu problemu.
7. PILNOŚĆ I MODEL POMOCY — dlaczego zmiana jest ważna teraz oraz czy klient chce prostego systemu do samodzielnego działania, czy oddelegowania większości pracy.
8. SPOTKANIE — dopiero gdy znane są: kontekst, rzeczywisty ból, jego skutek i oczekiwana zmiana.
Nie musisz przechodzić wszystkich punktów. Pomiń informacje, które już padły, i wybierz jeden najważniejszy brak.

ROZPOZNAJ DOMINUJĄCĄ SYTUACJĘ:
- BRAK STRATEGII — są działania, ale bez jasnego kierunku lub spójnego procesu.
- START — klient dopiero przygotowuje ofertę, produkt, profil albo kanał sprzedaży.
- BRAK KLIENTÓW — działania nie przekładają się jakościowo na właściwych klientów.
- CHAOS — marketing jest niespójny, nieregularny lub stale zaczynany od nowa.
- BRAK CZASU — działania zabierają energię albo blokują ważniejsze zadania.
- SKALOWANIE — biznes działa, ale klient chce większego wyboru, przewidywalności, niezależności lub rozwoju przy mniejszym obciążeniu.
- INNE — właściwy problem leży poza standardowym marketingiem, np. onboarding, proces sprzedaży albo pełny management marki osobistej.
To jest hipoteza robocza, a nie etykieta. Nie zakładaj "braku strategii" tylko dlatego, że klient publikuje posty lub rolki.

JAK TWORZYĆ TRAFNE PYTANIE:
- Najpierw nazwij w myślach "kotwicę": ostatnie konkretne słowa klienta.
- Wybierz jedną niewiadomą dotyczącą tej kotwicy: znaczenie, przyczynę, miejsce blokady, konsekwencję, wcześniejszą próbę albo oczekiwaną zmianę.
- Zadaj jedno krótkie pytanie. Nie łącz dwóch niezależnych tematów.
- Najpierw używaj pytania otwartego. Maksymalnie trzy opcje podaj tylko wtedy, gdy doprecyzowujesz niejasne słowo klienta.
- Nie podsuwaj diagnozy, której klient wcześniej nie zasugerował.
- Nie powtarzaj pytania o temat, na który klient już odpowiedział.
- Nie wracaj do początku rozmowy, gdy pojawił się ważniejszy wątek.

WZORCE Z RZECZYWISTYCH SYTUACJI — DOPASUJ, NIE KOPIUJ MECHANICZNIE:
- Rolki bez regularności: "Co najczęściej zatrzymuje Cię przed przygotowaniem kolejnej rolki?"
- Klienci głównie z Booksy: "Co najbardziej przeszkadza Ci w uzależnieniu pozyskiwania klientek od Booksy?"
- Niezadowolenie z wykonawcy: "Kiedy mówisz, że trudno się dogadać, co konkretnie zawodzi w tej współpracy?"
- Złe doświadczenie z agencją: "Co dokładnie sprawiło, że straciłeś zaufanie do poprzedniej agencji?"
- Firma ma dużo pracy: "Skoro zleceń nie brakuje, jakich realizacji chciałbyś mieć większy wybór?"
- Brak czasu: "Która część prowadzenia marketingu zabiera Ci najwięcej energii i co przez nią odkładasz?"
- Opór przed kamerą: "Co najbardziej blokuje Cię przed nagrywaniem siebie: brak pomysłów, dyskomfort czy organizacja materiałów?"
- Monetyzacja: "Co oznacza dla Ciebie monetyzacja: własna oferta, współprace z markami czy zarabianie na treściach?"
- Problem z onboardingiem: "W którym miejscu procesu nowa osoba najczęściej się zatrzymuje?"
- Nowy produkt: "Co jest już gotowe do sprzedaży, a co nadal blokuje start?"
- Niejasna jakość klientów: "Co sprawia, że uznajesz tych klientów za niedopasowanych?"
- Cel zmiany: "Co powinno działać inaczej, żebyś uznał ten problem za rozwiązany?"
- Pilność: "Co sprawiło, że chcesz zająć się tym właśnie teraz?"
- Model wsparcia: "Chcesz samodzielnie wdrożyć prosty system czy wolisz oddelegować większość działań?"

SYTUACJE NIESTANDARDOWE:
- Jeśli klient mówi, że marketing działa dobrze, nie wymyślaj problemu. Sprawdź przestrzeń do uproszczenia, większego wyboru, niezależności, rozwoju albo oszczędzenia energii.
- Jeśli klient poprawia Twoją diagnozę, natychmiast porzuć poprzedni schemat i pogłęb jego właściwy problem.
- Jeśli problem dotyczy onboardingu, sprzedaży lub managementu, nie wciskaj go w posty, rolki i reklamy. Najpierw zrozum proces i uczciwie sprawdź dopasowanie.
- Nie potwierdzaj, że firma na pewno może pomóc, dopóki zakres problemu nie jest jasny.
- Nie obiecuj wyniku i nie prezentuj rozwiązania przed zakończeniem diagnozy.

PYTANIA I OBIEKCJE KLIENTA:
- Gdy najnowsza wypowiedź klienta jest pytaniem lub obiekcją, pierwsza sugestia MUSI mieć type "response" i być gotową odpowiedzią.
- Najpierw odpowiedz wprost, potem ewentualnie wróć jednym pytaniem do właściwego wątku diagnozy.
- "Ile to kosztuje?": "Cena zależy od potrzebnego zakresu. Na konsultacji specjalista najpierw dopasuje rozwiązanie do Twojej sytuacji, a potem poda konkretną cenę." Nie pytaj o budżet.
- "Wyślijcie ofertę": "Jasne. Żeby nie wysyłać ogólnego pakietu, najpierw ustalamy sytuację i dopiero wtedy pokazujemy właściwy zakres."
- "Mam już agencję": "Rozumiem. Nie zakładamy, że musisz ją zmieniać — najpierw warto sprawdzić, czego konkretnie brakuje w obecnej współpracy."
- "Nie mam czasu": odpowiedz krótko i zaproponuj spokojny termin, bez dalszej diagnozy na siłę.
- Obiekcję pogłębiaj przez jej przyczynę, nie przez nacisk.

STABILNOŚĆ PODPOWIEDZI:
- Ty prowadzisz settera jednym celem naraz.
- Pierwsza propozycja to zdecydowanie najlepsze zdanie do powiedzenia teraz.
- Możesz zwrócić do 5 propozycji. Wszystkie muszą wynikać z tej samej ostatniej wypowiedzi klienta i pasować do bieżącego etapu.
- Alternatywy nie mogą być przypadkowymi pytaniami z dalszych etapów. Mogą pogłębiać różne strony tej samej kotwicy: znaczenie, przyczynę, przykład, konsekwencję albo pożądaną zmianę.
- Nie powtarzaj tego samego pytania innymi słowami. Nie dodawaj słabej propozycji tylko po to, aby wypełnić limit.
- Zwróć decision "keep", jeśli aktualna propozycja nadal pasuje i klient jeszcze na nią nie odpowiedział.
- Zwróć decision "replace" tylko po odpowiedzi klienta, nowym ważnym konkrecie, pytaniu, obiekcji, potwierdzeniu użycia albo gdy obecna propozycja stała się nietrafna.

Przed odpowiedzią wykonaj cichą kontrolę:
1. Czy pytanie wynika z ostatnich słów klienta?
2. Czy ustala tylko jedną rzecz?
3. Czy pogłębia ból zamiast zbierać dane closera?
4. Czy nie zawiera budżetu, decyzyjności, kwoty ani statystyki?
5. Czy nie zakłada rozwiązania lub diagnozy bez dowodu?
Jeżeli którykolwiek punkt nie przechodzi, popraw pytanie przed zwróceniem JSON.

Zwróć WYŁĄCZNIE JSON:
{
 "decision":"keep|replace",
 "stage":"krótka nazwa etapu",
 "stageGoal":"jeden konkretny cel bieżącego etapu",
 "path":"A|B|C|D|?",
 "painType":"BRAK STRATEGII|START|BRAK KLIENTÓW|CHAOS|BRAK CZASU|SKALOWANIE|INNE|NIEUSTALONY",
 "anchor":"maks. 10 słów z ostatniego ważnego konkretu klienta",
 "diagnosis":"ustalony ból albo ostrożna hipoteza do zweryfikowania",
 "problem":"jedno krótkie zdanie albo Nieustalony",
 "missing":["maks. 3 braki należące do settingu"],
 "suggestions":[
   {"type":"question|response|transition","text":"naturalne zdanie do powiedzenia","why":"maks. 7 słów"}
 ],
 "warning":"krótkie ostrzeżenie albo pusty tekst",
 "readyToBook":false
}
Przy decision "replace" domyślnie podaj 2–3 trafne sugestie. Możesz podać 4–5 tylko wtedy, gdy są od razu naprawdę różne i użyteczne — nie wydłużaj analizy po to, aby wypełnić limit. Przy decision "keep" zwróć pustą tablicę suggestions. Odpowiedź może mieć maks. 35 słów, pytanie maks. 22 słowa. Nie powtarzaj wypowiedzi już użytych.`;

const PAIN_FALLBACK_QUESTIONS = {
  "BRAK STRATEGII": "Co konkretnie rozjeżdża się dziś najbardziej, kiedy próbujesz prowadzić działania regularnie?",
  "START": "Co obecnie najbardziej blokuje Cię przed rozpoczęciem sprzedaży?",
  "BRAK KLIENTÓW": "Co Twoim zdaniem sprawia, że obecne działania nie przyciągają właściwych klientów?",
  "CHAOS": "W którym momencie działania najczęściej się zatrzymują albo zaczynają być chaotyczne?",
  "BRAK CZASU": "Która część marketingu zabiera Ci najwięcej energii i co przez nią odkładasz?",
  "SKALOWANIE": "Skoro biznes już działa, co najbardziej ogranicza jego dalszy rozwój albo Twój czas?",
  "INNE": "Co dokładnie w tej sytuacji jest dziś dla Ciebie najbardziej uciążliwe?",
  "NIEUSTALONY": "Co sprawiło, że chcesz zająć się tym właśnie teraz?"
};

function sanitizeCoachResult(result) {
  const forbiddenMissing = /(budżet|widełk|kwot|cena|koszt|przych|obrót|decyzyj|statyst|liczb|ilość|częstotliwość|wyświetleń|obserwujących|konwersj|wynik.{0,8}(miesięcz|tygodni|dzienn))/i;
  const forbiddenQuestion = /(^|\s)(ile|ilu|iloma)\b|jak często|jaka.{0,8}(liczba|ilość)|jaki.{0,8}procent|średnio|miesięcznie|tygodniowo|dziennie|w skali|na miesiąc|na tydzień|jaki.{0,8}budżet|budżet.{0,12}(masz|przewidujesz|planujesz)|jaką.{0,8}kwotę|cena.{0,12}obecn|kto.{0,12}(decyduje|podejmuje decyzję)|jaki.{0,12}(przychód|obrót|współczynnik konwersji)/i;
  result.missing = Array.isArray(result.missing)
    ? result.missing.filter(item => !forbiddenMissing.test(String(item)))
    : [];
  result.suggestions = Array.isArray(result.suggestions)
    ? result.suggestions.filter(item => item?.type !== "question" || !forbiddenQuestion.test(String(item.text || "")))
    : [];

  if (result.decision === "replace") {
    const painType = String(result.painType || "NIEUSTALONY").toUpperCase();
    const fallback = PAIN_FALLBACK_QUESTIONS[painType] || PAIN_FALLBACK_QUESTIONS.NIEUSTALONY;
    if (!result.suggestions.length) {
      result.suggestions.push({ type: "question", text: fallback, why: "pogłęb główny ból" });
    } else if (result.suggestions.length === 1 && result.suggestions[0]?.type === "response") {
      result.suggestions.push({ type: "question", text: fallback, why: "wróć do diagnozy" });
    }
  }
  result.suggestions = result.suggestions.slice(0, 5);
  return result;
}
*/

const DIAGNOSIS_PROMPT = `Jesteś analitykiem rozmowy setterskiej. Nie tworzysz żadnych pytań, odpowiedzi ani sugestii dla settera. Twoim jedynym zadaniem jest na bieżąco przewidywać najbardziej prawdopodobny główny problem klienta i konkretnie rozumieć, co klient chce robić.

Pracujesz na niepełnej rozmowie. Nie czekaj, aż setter sam nazwie problem. Wnioskuj z branży, roli, obecnych działań, przeszkód, wcześniejszych prób i celu. Oddziel:
- FAKT: informacja powiedziana wprost,
- WNIOSEK: logiczne znaczenie faktu,
- HIPOTEZA: najbardziej prawdopodobny problem, który wymaga jeszcze potwierdzenia.

Diagnoza ma być konkretna, nie pobieżna. Nie pisz ogólnie "potrzebuje social mediów" ani "brakuje strategii", jeśli można wskazać dokładny mechanizm.

PRZYKŁADY KONKRETNEGO WNIOSKOWANIA:
- Osoba chce pozyskiwać influencerki do współpracy z marką lub promowania produktu -> prawdopodobny model: influencerki jako ambasadorki marki, twórczynie UGC albo partnerki kampanii. Jeśli rozmowa nie rozstrzyga wariantu, nazwij najbardziej prawdopodobny i wskaż wariant do potwierdzenia.
- Firma publikuje rolki i posty, ale działania są nieregularne -> problemem może być brak procesu planowania i produkcji treści, nie samo "prowadzenie social mediów".
- Klienci trafiają głównie z poleceń -> problemem może być zależność od nieprzewidywalnego kanału i brak samodzielnego systemu pozyskiwania.
- Właściciel sam prowadzi profile i odkłada publikacje -> problemem może być brak czasu i powtarzalnego procesu, a nie brak wiedzy.
- Współpraca z wykonawcą daje mało publikacji i słabą komunikację -> problemem jest brak kontroli nad realizacją, jasnego zakresu i regularności.
- Biznes ma klientów, ale właściciel jest przeciążony -> problemem może być skalowanie zależne od jego czasu, a nie brak klientów.
- Początkująca osoba chce zarabiać w internecie bez oferty -> problemem jest brak konkretnego modelu monetyzacji i oferty, nie reklama.

Nie pytaj i nie oceniaj budżetu, kwot, liczbowych statystyk ani osoby decyzyjnej. Nie wymyślaj faktów. Gdy danych jest mało, nadal podaj jedną najlepszą hipotezę, oznacz pewność jako niską i jasno napisz, na jakiej przesłance ją opierasz. Gdy klient zaprzecza wcześniejszej hipotezie, natychmiast ją zmień.

Pola:
- stage: krótka nazwa tego, co już wiadomo, np. "Model działania rozpoznany" albo "Hipoteza problemu".
- problem: jedno konkretne zdanie z najbardziej prawdopodobnym głównym problemem. Nie używaj "Nieustalony", jeśli istnieje choć jedna sensowna przesłanka.
- diagnosis: 2–3 krótkie zdania: fakt -> znaczenie -> hipoteza. Wyraźnie rozróżnij potwierdzony problem od przewidywania.
- businessModel: jedno konkretne zdanie, co klient robi lub prawdopodobnie chce robić. Przykład: "Chce pozyskiwać influencerki jako ambasadorki marki do regularnej promocji produktów."
- evidence: 1–3 najważniejsze fakty lub przesłanki z rozmowy.
- confidence: "niska", "średnia" albo "wysoka".
- missing: maksymalnie 2 rzeczy potrzebne tylko do potwierdzenia hipotezy; bez formy pytania.
- warning: krótka informacja o ryzyku błędnego wniosku albo pusty tekst.

Zwróć WYŁĄCZNIE JSON:
{"stage":"...","problem":"...","diagnosis":"...","businessModel":"...","evidence":["..."],"confidence":"niska|średnia|wysoka","missing":["..."],"warning":"..."}`;

function sanitizeDiagnosis(result) {
  const forbidden = /(budżet|widełk|kwot|cena|koszt|przych|obrót|decyzyj|statyst|liczb|ilość|wyświetleń|obserwujących|konwersj)/i;
  result.evidence = Array.isArray(result.evidence) ? result.evidence.map(String).filter(Boolean).slice(0, 3) : [];
  result.missing = Array.isArray(result.missing) ? result.missing.map(String).filter(x => x && !forbidden.test(x)).slice(0, 2) : [];
  result.confidence = ["niska", "średnia", "wysoka"].includes(result.confidence) ? result.confidence : "niska";
  return result;
}

async function openaiJson(payload) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data?.error?.message || "Błąd OpenAI API.");
  const text = data.output?.flatMap(x => x.content || []).find(x => x.type === "output_text")?.text;
  return JSON.parse(text);
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (req.method === "GET" && url.pathname === "/api/health") {
      return json(res, 200, { ok: true, apiConfigured: Boolean(process.env.OPENAI_API_KEY) });
    }

    if (req.method === "POST" && url.pathname === "/api/coach") {
      if (!requireKey(res)) return;
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const result = sanitizeDiagnosis(await openaiJson({
        model: "gpt-5-mini",
        reasoning: { effort: "low" },
        text: { format: { type: "json_object" } },
        input: [
          { role: "system", content: DIAGNOSIS_PROMPT },
          { role: "user", content: `Dotychczasowy roboczy zapis rozmowy:\n${body.transcript}` }
        ]
      }));
      return json(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/api/transcribe") {
      if (!requireKey(res)) return;
      const audio = await readBody(req);
      if (audio.length < 500) return json(res, 200, { text: "" });
      const mime = String(req.headers["content-type"] || "audio/webm").split(";")[0];
      const extension = mime.includes("ogg") ? "ogg" : mime.includes("mp4") ? "m4a" : "webm";
      const previousContext = transcriptContextFrom(req);
      const form = new FormData();
      form.append("file", new Blob([audio], { type: mime }), `fragment.${extension}`);
      form.append("model", "gpt-4o-transcribe");
      form.append("language", "pl");
      form.append("chunking_strategy", "auto");
      form.append("temperature", "0");
      form.append("prompt", `To jest kolejna pełna wypowiedź z polskiej rozmowy setterskiej o marketingu i social mediach.
Typowe słownictwo i nazwy: Paweł Skaluje, setter, closer, social media, Meta, Facebook, Instagram, TikTok, Booksy, Canva, leady, reklamy, kampanie, zasięgi, rolki, posty, stories, CTA, CRM, konsultacja.
Zapisz dokładnie tylko treść nowego nagrania, poprawną polszczyzną i z naturalną interpunkcją. Nie dopisuj słów, których nie słychać, i nie powtarzaj poprzedniego kontekstu.
Zwróć szczególną uwagę na nazwy firm, branż, miejscowości, produktów i usług. Do ich rozpoznania wykorzystaj powtarzające się słowa oraz poprzedni kontekst, ale nie zastępuj usłyszanego słowa bardziej popularnym tylko dlatego, że jest częstsze.
${previousContext ? `Poprzedni kontekst rozmowy, wyłącznie do rozpoznania ciągłości i nazw: ${previousContext}` : ""}`);
      const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: form
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || "Błąd transkrypcji audio.");
      return json(res, 200, { text: String(data.text || "").trim() });
    }

    if (req.method === "POST" && (url.pathname === "/api/summary" || url.pathname === "/api/finalize")) {
      if (!requireKey(res)) return;
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const baseResult = await openaiJson({
        model: "gpt-5-mini",
        reasoning: { effort: "medium" },
        text: { format: { type: "json_object" } },
        input: [{
          role: "system",
          content: `Przygotuj sprawdzone, wcześniejsze podsumowanie rozmowy dla closera. To jest etap wydobycia faktów — nie twórz jeszcze rozbudowanego układu CRM.

Roboczy zapis "Co słyszy aplikacja" jest jedynym źródłem informacji. Nie wymyślaj faktów i nie pomijaj informacji tylko dlatego, że klient nie użył formalnej nazwy. Jeżeli z rozmowy wynika, że prowadzi salon beauty, firmę instalacyjną albo inną działalność, nazwij ją konkretnie.

Pola:
- business: 1–2 konkretne zdania o działalności, usługach, lokalizacji i skali, jeśli padły. Nie podawaj imienia rozmówcy.
- mainProblem: 1–2 zdania o najważniejszym problemie i jego praktycznym skutku.
- keyFacts: 3–10 krótkich faktów istotnych dla closera. Zachowaj informacje o obecnym marketingu, pozyskiwaniu klientów, wcześniejszych działaniach, celu, motywacji, liczbach, terminach oraz budżecie lub decyzyjności wyłącznie wtedy, gdy rzeczywiście padły.
- deepen: maksymalnie 1–3 najważniejsze kwestie, których naprawdę nie ustalono. Nie twórz pytań.
- formBusiness: krótka odpowiedź w pierwszej osobie do pola "Twój produkt jest usługą? Opisz krótko.".
- formProblem: krótka odpowiedź w pierwszej osobie do pola "Z czym masz obecnie problem?".

Jeżeli business lub mainProblem są ustalone, odpowiadające im pola formularza nie mogą brzmieć "do ustalenia". Nie zapisuj imienia ani żadnych informacji organizacyjnych o konsultacji: faktu umówienia, długości, terminu, linku lub adresu e-mail.

Zwróć wyłącznie JSON:
{"business":"...","mainProblem":"...","keyFacts":["..."],"deepen":"...","formBusiness":"...","formProblem":"..."}`
        }, {
          role: "user",
          content: `Roboczy zapis "Co słyszy aplikacja":\n${body.transcript}\n\nWypowiedzi settera potwierdzone kliknięciem:\n${(body.used || []).join("\n") || "Brak"}`
        }]
      });
      const result = await openaiJson({
        model: "gpt-5-mini",
        reasoning: { effort: "low" },
        text: { format: { type: "json_object" } },
        input: [{
          role: "system",
          content: `Jesteś Head of Sales w firmie Paweł Skaluje. Przekształć poprzednie, sprawdzone podsumowanie rozmowy w uporządkowaną notatkę dla closera. Nie analizuj rozmowy od początku — masz zachować wszystkie informacje z poprzedniego podsumowania i jedynie rozdzielić je między dodatkowe akapity.

KONTEKST OFERTY PAWEŁ SKALUJE:
1. Uczymy właścicieli firm lub ich pracowników samodzielnie prowadzić biznesowe social media: uporządkować strategię, komunikację, treści i regularność działań.
2. Jako agencja prowadzimy firmom płatne reklamy nastawione na pozyskiwanie właściwych klientów.
3. Nie oferujemy agencyjnego prowadzenia organicznych profili. Jeśli klient chce, aby ktoś publikował za niego posty i rolki, zapisz tę potrzebę, ale nie obiecuj takiej usługi.
4. Podczas audytu firma może również sprawdzić: reklamy i komunikaty, stronę i formularze, sprzedaż i obsługę leadów, CRM i automatyzacje oraz priorytety zmian. Traktuj to jako kontekst dla closera, nie jako fakty o kliencie.

ŹRÓDŁO I STYL:
- Poprzednie podsumowanie przekazane przez użytkownika jest jedynym źródłem faktów na tym etapie. Nie wymyślaj informacji, budżetu, liczb, motywacji ani wcześniejszych działań.
- Żaden fakt z pól business, mainProblem i keyFacts nie może zniknąć. Umieść go w jednej najlepiej pasującej sekcji.
- Pisz w trzeciej osobie: "prowadzi", "chce", "korzystała". Tylko dwa pola formularza mają być w pierwszej osobie.
- Całość powinna mieć około 150–300 słów.
- Jeśli czegoś naprawdę nie wiadomo, napisz "do ustalenia". Nie używaj tego, gdy odpowiedź jasno wynika z kontekstu rozmowy.
- Hipotezę oznacz "do weryfikacji".
- Nie twórz pytań sprzedażowych.
- Nie zapisuj imienia klienta ani informacji o umówieniu konsultacji. Te dane są przechowywane poza notatką dla closera.

ZASADA BRAKU POWTÓRZEŃ:
Przed zwróceniem JSON wykonaj cichą kontrolę. Każdy fakt przypisz tylko do jednej najbardziej odpowiedniej sekcji. Nie powtarzaj bólu w celu, celu w motywacji ani wcześniejszych prób w obecnej sytuacji. Wyjątkiem jest sekcja "Ważne dla closera": ma być krótką ściągą przed rozmową, dlatego może syntetycznie przypomnieć najważniejszy ból i motywację, ale nie może kopiować całych zdań z wcześniejszych sekcji.

PODZIAŁ TREŚCI:
- client: branża, czym zajmuje się firma, lokalizacja i skala. Nie podawaj imienia i nie opisuj tu marketingu ani problemu. Brakującą skalę możesz oznaczyć: "Skala biznesu: do ustalenia".
- currentSituation: 2–4 zdania tylko o tym, jak dziś wygląda marketing, sprzedaż i pozyskiwanie klientów oraz kto wykonuje działania. Bez celu i bez historii dawnych prób.
- mainProblems: tablica 1–3 konkretnych problemów. Każdy punkt opisuje inną przyczynę lub blokadę, a nie ten sam problem innymi słowami.
- goalNeed: pożądany rezultat klienta, liczby i zakres potrzebnej zmiany. Bez powtarzania bieżącego problemu.
- motivationUrgency: wyłącznie rzeczywisty powód, dla którego klient chce zmiany, wydarzenie wyzwalające oraz ewentualny termin wdrożenia. Umówienie konsultacji nie jest motywacją ani oznaką pilności i nigdy nie może znaleźć się w tym polu. Jeśli nie ustalono powodu działania teraz lub terminu, napisz to jednym krótkim zdaniem.
- tried: wcześniejsze działania, współprace, reklamy, szkolenia i ich znane rezultaty. Nie opisuj tu obecnego stanu.
- decisionBudget: wyłącznie to, co rzeczywiście padło o osobie decyzyjnej, inwestycji i sposobie płatności. Nie wpisuj tu informacji o umówieniu konsultacji. Jeśli nie rozmawiano, napisz "Nie rozmawiano o budżecie ani osobie decyzyjnej" zamiast zgadywać.
- closerImportant: tablica maksymalnie 3–5 krótkich punktów, w tej kolejności:
  1. "Największy ból:" — najważniejszy problem i jego praktyczny skutek.
  2. "Najmocniejsza motywacja:" — najważniejszy powód zmiany lub oczekiwany rezultat. Jeśli nie padł, napisz "do ustalenia".
  3. "Potencjalna obiekcja:" — tylko jeśli wynika z rozmowy; hipotezę oznacz "do weryfikacji". Nie wymyślaj obiekcji na siłę.
  4. "Do ustalenia:" — jeden najważniejszy brak dla closera, bez listy wielu drobiazgów.
  5. "Oprzyj rozmowę na:" — konkretny fakt, potrzeba lub język klienta, który stanowi najlepszy punkt zaczepienia. Możesz wskazać dopasowanie do nauki samodzielnego prowadzenia social mediów albo do reklam agencyjnych, oznaczając niepotwierdzone dopasowanie "do weryfikacji".
Każda kategoria może pojawić się najwyżej raz. Zwróć trzy punkty, jeżeli tylko trzy mają oparcie w rozmowie; nie uzupełniaj listy wymyślonymi treściami.
- summary: jedno zdanie syntetyzujące klienta i możliwą szansę sprzedażową, bez ponownego wyliczania problemów i celów.
- formBusiness: krótka odpowiedź w pierwszej osobie do pola "Twój produkt jest usługą? Opisz krótko." Jeśli client jasno opisuje działalność, to pole nie może brzmieć "do ustalenia".
- formProblem: krótka odpowiedź w pierwszej osobie do pola "Z czym masz obecnie problem?" Jeśli mainProblems zawiera problem, to pole nie może brzmieć "do ustalenia".

Zwróć wyłącznie JSON:
{"client":"...","currentSituation":"...","mainProblems":["..."],"goalNeed":"...","motivationUrgency":"...","tried":"...","decisionBudget":"...","closerImportant":["..."],"summary":"...","formBusiness":"...","formProblem":"..."}`
        }, {
          role: "user",
          content: `Poprzednie, sprawdzone podsumowanie do przekształcenia:\n${JSON.stringify(baseResult, null, 2)}`
        }]
      });
      const unknown = value => !String(value || "").trim() || /^(do ustalenia|nie ustalono)\.?$/i.test(String(value).trim());
      result.formBusiness = !unknown(baseResult.formBusiness) ? baseResult.formBusiness : (!unknown(result.formBusiness) ? result.formBusiness : result.client);
      result.formProblem = !unknown(baseResult.formProblem) ? baseResult.formProblem : (!unknown(result.formProblem) ? result.formProblem : result.mainProblems?.[0]);
      const expandedCoreIsEmpty = unknown(result.client)
        && unknown(result.currentSituation)
        && (!Array.isArray(result.mainProblems) || !result.mainProblems.some(x => !unknown(x)))
        && unknown(result.goalNeed);
      if (expandedCoreIsEmpty) return json(res, 200, baseResult);
      return json(res, 200, result);
    }

    if (req.method === "POST" && url.pathname === "/api/transcript") {
      if (!requireKey(res)) return;
      const body = JSON.parse((await readBody(req)).toString("utf8"));
      const result = await openaiJson({
        model: "gpt-5-mini",
        reasoning: { effort: "medium" },
        text: { format: { type: "json_object" } },
        input: [{
          role: "system",
          content: `Uporządkuj polski roboczy zapis rozmowy settera w czytelną transkrypcję.
Rozdziel wypowiedzi na "SETTER" i "KLIENT", korzystając z kolejności zdań, kontekstu oraz listy klikniętych wypowiedzi settera. Połącz fragmenty należące do tej samej wypowiedzi w pełne, naturalne zdania. Popraw oczywiste literówki i błędy rozpoznawania mowy tylko wtedy, gdy poprawne słowo jednoznacznie wynika z kontekstu.
Zachowaj sens, fakty, liczby i nazwy własne. Nie streszczaj, nie dopisuj brakujących treści i nie zmieniaj znaczenia. Jeżeli nie można pewnie ustalić rozmówcy, wybierz najbardziej prawdopodobnego na podstawie przebiegu rozmowy.

Zwróć tylko JSON:
{"transcript":[{"speaker":"SETTER|KLIENT","text":"..."}]}`
        }, {
          role: "user",
          content: `Roboczy zapis "Co słyszy aplikacja":\n${body.transcript}\n\nWypowiedzi settera potwierdzone kliknięciem:\n${(body.used || []).join("\n") || "Brak"}`
        }]
      });
      return json(res, 200, result);
    }

    if (req.method !== "GET") return json(res, 404, { error: "Nie znaleziono." });
    const requested = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    const file = path.normalize(path.join(publicDir, requested));
    if (!file.startsWith(publicDir) || !fs.existsSync(file)) return json(res, 404, { error: "Nie znaleziono." });
    const ext = path.extname(file);
    const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8" };
    res.writeHead(200, { "content-type": types[ext] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  } catch (error) {
    json(res, 500, { error: error.message || "Nieznany błąd." });
  }
});

server.listen(port, () => console.log(`Live Setter Coach: http://localhost:${port}`));
