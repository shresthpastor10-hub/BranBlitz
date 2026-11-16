// BranBlitz - game logic (app.js)
// Loads AFTER auth.js, so it can use: supabaseClient

(function () {
  'use strict';

  // SETTINGS
  const CONFIG = {
    questionsPerMatch: 5,
    secondsPerQuestion: 30,
    pointsFirstCorrect: 3,        // +3 for answering correctly first
    pointsSecondCorrect: 1,       // +1 for answering correctly second
    pointsWrong: -3,              // -3 for a wrong answer
    trophiesPerPoint: 4,
    maxTrophyChange: 30,
    revealDelayMs: 1500,          // pause after each question
    bot: {
      accuracy: 0.7,              // chance StudyBot answers correctly
      minDelaySec: 5,             // StudyBot answers between these times
      maxDelaySec: 20
    },
    // ---- Question source ----
    rpcName: 'get_random_questions'
  };

  //SMALL HELPERS
  const $ = (id) => document.getElementById(id);
  const LETTERS = ['A', 'B', 'C', 'D'];
  const SCREENS = ['homeScreen', 'profileScreen', 'howScreen', 'quizScreen', 'resultScreen'];

  function setText(id, value) {
    const el = $(id);
    if (el) el.textContent = value;
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  // for infuture if katex is needed
  function typeset(el) {
    if (el && typeof window.renderMathInElement === 'function') {
      try { window.renderMathInElement(el); } catch (e) { /* ignore */ }
    }
  }

  function showScreen(id) {
    SCREENS.forEach((s) => $(s)?.classList.toggle('hidden', s !== id));
    $('topBar')?.classList.toggle('hidden', id === 'quizScreen');
    $('menu')?.classList.add('hidden');
    window.scrollTo(0, 0);
  }

  function setHomeMessage(msg) {
    setText('homeMessage', msg || '');
  }


  // 3. PLAYER + PROFILE (Supabase table +localStorage fallback)

  const DEFAULT_PROFILE = { trophies: 0, played: 0, won: 0, lost: 0, draws: 0, correct: 0 };
  let player = { id: null, name: 'Player' };
  let profile = Object.assign({}, DEFAULT_PROFILE);

  const localKey = () => 'branblitz_profile_' + (player.id || 'guest');

  async function resolvePlayer() {
    try {
      const { data: { session } } = await supabaseClient.auth.getSession();
      const user = session?.user;
      if (user) {
        player.id = user.id;
        player.name = user.user_metadata?.username || user.email.split('@')[0];
      }
    } catch (e) {
      console.warn('Could not read session:', e);
    }
    if (!player.id) {
      player.name = sessionStorage.getItem('username') || player.name;
    }
  }

  async function loadProfile() {
    await resolvePlayer();
    let loaded = null;

    if (player.id) {
      try {
        const { data, error } = await supabaseClient
          .from('profiles')
          .select('trophies, played, won, lost, draws, correct')
          .eq('id', player.id)
          .maybeSingle();

        if (error) {
          console.warn('profiles table not available, using local save:', error.message);
        } else if (data) {
          loaded = data;
        } else {
          await supabaseClient
            .from('profiles')
            .insert(Object.assign({ id: player.id, username: player.name }, DEFAULT_PROFILE));
        }
      } catch (e) {
        console.warn('Profile load failed:', e);
      }
    }

    if (!loaded) {
      try { loaded = JSON.parse(localStorage.getItem(localKey())); } catch (e) { loaded = null; }
    }

    profile = Object.assign({}, DEFAULT_PROFILE, loaded || {});
    renderTrophies();
  }

  async function saveProfile() {
    try { localStorage.setItem(localKey(), JSON.stringify(profile)); } catch (e) { /* ignore */ }
    if (!player.id) return;
    try {
      const { error } = await supabaseClient
        .from('profiles')
        .upsert(Object.assign({ id: player.id, username: player.name }, profile));
      if (error) console.warn('Profile save failed:', error.message);
    } catch (e) {
      console.warn('Profile save failed:', e);
    }
  }

  function renderTrophies() {
    setText('trophyCount', profile.trophies);
  }

  function renderProfile() {
    setText('pUsername', player.name);
    setText('pTrophies', profile.trophies);
    setText('pPlayed', profile.played);
    setText('pWon', profile.won);
    setText('pLost', profile.lost);
    setText('pDraws', profile.draws);
    setText('pCorrect', profile.correct);
  }

  // 4. QUESTIONS
  //    Every question is normalised as:
  //    { text, options: [4 strings], correct: 0..3, explanation }

  function shuffleOptions(q) {
    const order = shuffle([0, 1, 2, 3]);
    return {
      text: q.text,
      explanation: q.explanation,
      options: order.map((i) => q.options[i]),
      correct: order.indexOf(q.correct)
    };
  }

  // Table "questions": subject, question, option_a..option_d, correct_answer (A-D), explanation
  function rowToQuestion(r) {
    const q = {
      text: r.question,
      options: [r.option_a, r.option_b, r.option_c, r.option_d].map((o) => String(o == null ? '' : o)),
      correct: LETTERS.indexOf(String(r.correct_answer || '').trim().toUpperCase()),
      explanation: r.explanation || ''
    };
    return (q.text && q.correct >= 0 && q.options.every(Boolean)) ? q : null;
  }

  async function fetchFromSupabase(subject, count) {
    let rows = null;

    // 1st choice: the get_random_questions() SQL function (fast and truly random)
    const rpc = await supabaseClient.rpc(CONFIG.rpcName, { p_subject: subject, p_count: count });
    if (!rpc.error) {
      rows = rpc.data;
    } else {
      console.warn('RPC failed, trying direct table select:', rpc.error.message);
    }

    // 2nd choice: read the table directly and shuffle in the browser
    if (!rows || rows.length === 0) {
      const sel = await supabaseClient.from('questions').select('*').eq('subject', subject).limit(300);
      if (sel.error) throw sel.error;
      rows = shuffle(sel.data || []);
    }

    const validQuestions = rows
      .map(rowToQuestion)
      .filter(Boolean)
      .slice(0, count)
      .map(shuffleOptions);

    if (validQuestions.length < count) {
      throw new Error('Not enough valid questions returned from Supabase.');
    }

    return validQuestions;
  }


  // MATCH ENGINE

  let selectedSubject = null;
  let botModeSelected = false;
  let loadingMatch = false;
  let match = null;

  function newQuestionState() {
    return {
      selectedOption: null,                     // 'A' | 'B' | 'C' | 'D' | null (before submit)
      attempted: { user: false, bot: false },
      outcome: { user: null, bot: null },       // 'correct' | 'wrong' | null
      points: { user: 0, bot: 0 },              // points earned/lost on THIS question
      firstCorrectClaimed: false,               // tracks whether +3 was already awarded
      ended: false
    };
  }

  function clearTimers() {
    if (!match) return;
    clearInterval(match.timer);
    clearTimeout(match.botTimeout);
    clearTimeout(match.nextTimeout);
    match.timer = match.botTimeout = match.nextTimeout = null;
  }

  function getOptionButtons() {
    return Array.from(document.querySelectorAll('.optionButton'));
  }

  function renderDots() {
    ['user', 'bot'].forEach((who) => {
      const box = $(who + 'Dots');
      if (!box) return;
      box.textContent = '';
      for (let i = 0; i < CONFIG.questionsPerMatch; i++) {
        const mark = match.marks[who][i];
        const dot = document.createElement('span');
        dot.style.cssText = 'display:inline-block;width:14px;height:14px;border-radius:50%;margin:6px 4px 0 0;';
        dot.style.background =
          mark === 'correct' ? '#2ecc71' :
          mark === 'wrong' ? '#e74c3c' :
          mark === 'none' ? '#7f8c8d' : 'rgba(255,255,255,0.2)';
        box.appendChild(dot);
      }
    });
  }

  function renderScores() {
    setText('userScore', match.score.user);
    setText('botScore', match.score.bot);
  }

  async function startMatch() {
    if (loadingMatch || match) return;
    if (!selectedSubject) { setHomeMessage('Please choose a subject first.'); return; }
    if (!botModeSelected) { setHomeMessage('Please choose a mode (Bot Mode).'); return; }

    loadingMatch = true;
    setHomeMessage('Loading questions...');
    let questions = [];
    try {
      questions = await fetchFromSupabase(selectedSubject, CONFIG.questionsPerMatch);
    } catch (e) {
      console.error('Supabase question fetch failed:', e);
      showScreen('homeScreen');
      setHomeMessage('Cannot fetch questions. Retry');
      return;
    } finally {
      loadingMatch = false;
    }

    setHomeMessage('');

    match = {
      subject: selectedSubject,
      questions: questions,
      index: 0,
      score: { user: 0, bot: 0 },
      marks: { user: [], bot: [] },
      correctCount: 0,
      q: newQuestionState(),
      timer: null, botTimeout: null, nextTimeout: null
    };

    renderScores();
    showScreen('quizScreen');
    showQuestion();
  }

  function showQuestion() {
    const q = match.questions[match.index];
    match.q = newQuestionState();

    setText('questionNumber', match.index + 1);
    setText('questionText', q.text);
    $('questionText').style.color = 'white';
    setText('quizMessage', '');
    typeset($('questionText'));

    getOptionButtons().forEach((btn, i) => {
      btn.textContent = LETTERS[i] + '. ' + q.options[i];
      btn.disabled = false;
      btn.style.background = '';
      btn.style.color = '';
      btn.style.outline = '';
      typeset(btn);
    });

    const submitBtn = $('submitAnswerButton');
    if (submitBtn) submitBtn.disabled = true;

    renderDots();
    startTimer();
    scheduleBot(q);
  }

  function startTimer() {
    const label = $('timeLeft');
    const deadline = Date.now() + CONFIG.secondsPerQuestion * 1000;
    if (label) { label.textContent = CONFIG.secondsPerQuestion + 's'; label.style.color = 'white'; }

    clearInterval(match.timer);
    match.timer = setInterval(() => {
      const left = Math.max(0, Math.ceil((deadline - Date.now()) / 1000));
      if (label) {
        label.textContent = left + 's';
        label.style.color = left <= 10 ? '#e74c3c' : 'white';
      }
      if (left <= 0) endQuestion();
    }, 200);
  }

  function scheduleBot(q) {
    const delay = rand(CONFIG.bot.minDelaySec, CONFIG.bot.maxDelaySec) * 1000;
    match.botTimeout = setTimeout(() => {
      if (!match || match.q.ended || match.q.attempted.bot) return;
      const isRight = Math.random() < CONFIG.bot.accuracy;
      let idx = q.correct;
      if (!isRight) {
        const wrong = [0, 1, 2, 3].filter((i) => i !== q.correct);
        idx = wrong[Math.floor(Math.random() * wrong.length)];
      }
      resolveAnswer('bot', isRight, idx);
    }, delay);
  }

  // Highlight option on click without locking/submitting yet
  function selectUserOption(letter) {
    if (!match || match.q.ended || match.q.attempted.user) return;
    if (LETTERS.indexOf(letter) < 0) return;

    match.q.selectedOption = letter;

    getOptionButtons().forEach((btn) => {
      const isSelected = btn.dataset.option === letter;
      btn.style.outline = isSelected ? '3px solid #FFB703' : '';
    });

    const submitBtn = $('submitAnswerButton');
    if (submitBtn) submitBtn.disabled = false;
  }

  // Lock in and evaluate the selected option only when Submit is clicked
  function submitUserAnswer() {
    if (!match || match.q.ended || match.q.attempted.user) return;
    const letter = match.q.selectedOption;
    if (!letter) return;

    const idx = LETTERS.indexOf(letter);
    if (idx < 0) return;

    const q = match.questions[match.index];
    resolveAnswer('user', idx === q.correct, idx);
  }

  // The core scoring rules
  function resolveAnswer(who, isCorrect, idx) {
    const s = match.q;
    const opp = who === 'user' ? 'bot' : 'user';

    if (s.ended || s.attempted[who]) return;
    s.attempted[who] = true;
    s.outcome[who] = isCorrect ? 'correct' : 'wrong';

    // Lock the player's buttons and submit button after submission
    if (who === 'user') {
      const submitBtn = $('submitAnswerButton');
      if (submitBtn) submitBtn.disabled = true;

      getOptionButtons().forEach((b) => {
        b.disabled = true;
        b.style.outline = '';
      });
      const chosen = getOptionButtons()[idx];
      if (chosen) {
        chosen.style.background = isCorrect ? '#2ecc71' : '#e74c3c';
        chosen.style.color = '#fff';
      }
    }

    if (isCorrect) {
      if (who === 'user') match.correctCount++;
      if (!s.firstCorrectClaimed) {
        s.firstCorrectClaimed = true;
        s.points[who] = CONFIG.pointsFirstCorrect;    // +3 (first correct)
      } else {
        s.points[who] = CONFIG.pointsSecondCorrect;   // +1 (second correct)
      }
    } else {
      s.points[who] = CONFIG.pointsWrong;             // -3 (wrong answer)
    }

    match.score[who] += s.points[who];
    renderScores();

    // End the question only when both players have answered (or timer hits 0)
    if (s.attempted[opp]) {
      endQuestion();
    } else {
      if (who === 'user') {
        setText('quizMessage',
          isCorrect
            ? 'Correct! +' + s.points.user + ' points. Waiting for StudyBot to answer...'
            : 'Wrong! -3 points. Waiting for StudyBot to answer...');
      } else {
        setText('quizMessage', 'StudyBot has locked in an answer! Select yours and click Submit.');
      }
    }
  }

  function summaryMessage() {
    const fmt = (pts) => (pts > 0 ? '+' + pts : String(pts));
    const uStr = match.q.outcome.user
      ? 'You: ' + fmt(match.q.points.user)
      : 'You: 0 (unanswered)';
    const bStr = match.q.outcome.bot
      ? 'StudyBot: ' + fmt(match.q.points.bot)
      : 'StudyBot: 0 (unanswered)';

    return uStr + ' | ' + bStr + '.';
  }

  function summaryMessage() {
    const u = match.q.outcome.user;
    const b = match.q.outcome.bot;
    if (u === 'correct') {
      return b === 'wrong'
        ? 'You got it right! +3 for you (StudyBot already lost 3).'
        : 'You got it right! +3 for you, -3 for StudyBot.';
    }
    if (b === 'correct') {
      return u === 'wrong'
        ? 'StudyBot got it right: +3 for StudyBot (you already lost 3).'
        : 'StudyBot got it right! +3 for StudyBot, -3 for you.';
    }
    if (u === 'wrong' && b === 'wrong') return 'Both answered wrong: -3 each.';
    if (u === 'wrong') return 'Wrong answer: -3 for you. StudyBot stayed silent.';
    if (b === 'wrong') return 'StudyBot answered wrong: -3. You stayed silent.';
    return "Time's up! Nobody submitted an answer: 0 for both.";
  }

  function endQuestion() {
    if (!match || match.q.ended) return;
    match.q.ended = true;
    clearInterval(match.timer);
    clearTimeout(match.botTimeout);

    const submitBtn = $('submitAnswerButton');
    if (submitBtn) submitBtn.disabled = true;

    const q = match.questions[match.index];
    const o = match.q.outcome;

    // Reveal the right answer
    getOptionButtons().forEach((btn, i) => {
      btn.disabled = true;
      btn.style.outline = '';
      if (i === q.correct) { btn.style.background = '#2ecc71'; btn.style.color = '#fff'; }
    });

    match.marks.user[match.index] = o.user || 'none';
    match.marks.bot[match.index] = o.bot || 'none';
    renderDots();
    renderScores();

    let msg = summaryMessage() + ' Answer: ' + LETTERS[q.correct] + '.';
    if (q.explanation) msg += ' ' + q.explanation;
    setText('quizMessage', msg);

    match.nextTimeout = setTimeout(nextQuestion, CONFIG.revealDelayMs);
  }

  function nextQuestion() {
    match.index++;
    if (match.index >= match.questions.length) {
      finishMatch();
    } else {
      showQuestion();
    }
  }

  async function finishMatch() {
    clearTimers();
    const u = match.score.user;
    const b = match.score.bot;
    const change = Math.min(Math.abs(u - b) * CONFIG.trophiesPerPoint, CONFIG.maxTrophyChange);

    let banner, winner, delta, color, fontSize;
    if (u > b) {
      banner = 'You win!!';
      winner = player.name;
      delta = change;
      color = '#2ecc71';    
      fontSize = '64px';    
      profile.won++;
    } else if (u < b) {
      banner = 'You Lose';
      winner = 'StudyBot';
      delta = -change;
      color = '#D9480F';
      fontSize = '48px';
      profile.lost++;
    } else {
      banner = "It's a Draw";
      winner = 'Draw';
      delta = 0;
      color = '#FFD700';
      fontSize = '48px';
      profile.draws++;
    }

    profile.played++;
    profile.correct += match.correctCount;
    profile.trophies += delta;            // trophies may go below 0

    const banEl = $('resultBanner');
    if (banEl) {
      banEl.textContent = banner;
      banEl.style.color = color;
      banEl.style.fontSize = fontSize;
      banEl.style.fontWeight = 'bold';
    }
    setText('resultWinner', winner);
    setText('resultScore', u + ' (You) - ' + b + ' (StudyBot)');
    setText('resultChange', (delta > 0 ? '+' : '') + delta + ' trophies');
    setText('resultTrophies', profile.trophies);
    renderTrophies();

    match = null;
    showScreen('resultScreen');
    await saveProfile();
  }


  // UI WIRING
  function highlight(btn, on) {
    btn.classList.toggle('selected', on);
    btn.style.outline = on ? '3px solid #FFB703' : '';
  }

function populateHowToPlay() {
    const container = $('howBox');
    const rulesRow = document.querySelector('#rulesSection .rules-row');
    if (!container || !rulesRow) return;

    container.innerHTML = '';
    const heading = document.createElement('h2');
    heading.textContent = 'How to Play';
    heading.style.color = '#FFB703';
    heading.style.textAlign = 'center';
    container.append(heading, rulesRow.cloneNode(true));
  }

  function wireUI() {
    // Subject buttons
    const subjectButtons = Array.from(document.querySelectorAll('.subjectButton, .subject-btn'));
    subjectButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        selectedSubject = btn.dataset.subject;
        subjectButtons.forEach((b) => highlight(b, b === btn));
        setHomeMessage('');
      });
    });

    // Mode
    const modeBtn = $('botModeButton');
    modeBtn?.addEventListener('click', () => {
      botModeSelected = true;
      highlight(modeBtn, true);
      setHomeMessage('');
    });

    // Start match / play again / back home
    $('startButton')?.addEventListener('click', startMatch);
    $('playAgainButton')?.addEventListener('click', startMatch);
    $('backHomeButton')?.addEventListener('click', () => {
      renderTrophies();
      showScreen('homeScreen');
    });

    // Answer selection & submit button
    getOptionButtons().forEach((btn) => {
      btn.addEventListener('click', () => selectUserOption(btn.dataset.option));
    });
    $('submitAnswerButton')?.addEventListener('click', submitUserAnswer);

    // Hamburger menu
    $('menuButton')?.addEventListener('click', () => $('menu')?.classList.toggle('hidden'));
    $('menuProfile')?.addEventListener('click', () => { renderProfile(); showScreen('profileScreen'); });
    $('menuHow')?.addEventListener('click', () => {
      // Hide all in-game screens and the top bar
      SCREENS.forEach((s) => $(s)?.classList.add('hidden'));
      $('topBar')?.classList.add('hidden');
      $('menu')?.classList.add('hidden');

      // Show the landing page again
      $('landingScreen')?.classList.remove('hidden');
      $('landingExtras')?.classList.remove('hidden');

      // Scroll smoothly to the very top of the landing page
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Back buttons on Profile / How to Play
    document.querySelectorAll('.backButton').forEach((btn) => {
      btn.addEventListener('click', () => { renderTrophies(); showScreen('homeScreen'); });
    });
  }


  // START
 
  wireUI();
  loadProfile();
  window.addEventListener('userReady', loadProfile);   // fired by auth.js once login is confirmed
})();