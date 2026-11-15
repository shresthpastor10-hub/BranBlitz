// app.js - all frontend code: screens, forms, polling and answers
let myName = '';
let selectedSubject = '';
let botModeChosen = false;
let matchId = null;
let pollTimer = null;
let resultScheduled = false;
let lastSubject = '';

const screenNames = ['landingScreen', 'homeScreen', 'profileScreen', 'howScreen', 'quizScreen', 'resultScreen'];

function byId(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  byId(id).textContent = text;
}

function signed(number) {
  return number > 0 ? '+' + number : String(number);
}

// Sends a request to the backend and returns the JSON reply (plus ok and httpStatus)
async function api(url, method, body) {
  const options = { method: method, headers: { 'Content-Type': 'application/json' } };
  if (body) {
    options.body = JSON.stringify(body);
  }
  const response = await fetch(url, options);
  const data = await response.json();
  data.ok = response.ok;
  data.httpStatus = response.status;
  return data;
}

// Shows one screen and hides the others. The menu is only shown on home, profile and how-to-play.
function showScreen(name) {
  for (let i = 0; i < screenNames.length; i++) {
    byId(screenNames[i]).classList.toggle('hidden', screenNames[i] !== name);
  }
  const menuScreens = ['homeScreen', 'profileScreen', 'howScreen'];
  byId('topBar').classList.toggle('hidden', !menuScreens.includes(name));
  byId('menu').classList.add('hidden');
}

// ===== Landing page: login and signup =====
byId('showLogin').addEventListener('click', function () {
  byId('loginForm').classList.remove('hidden');
  byId('signupForm').classList.add('hidden');
  setText('authMessage', '');
});

byId('showSignup').addEventListener('click', function () {
  byId('signupForm').classList.remove('hidden');
  byId('loginForm').classList.add('hidden');
  setText('authMessage', '');
});

// Same rules as the backend (the backend checks again, because the browser can be tricked)
function checkSignup(username, email, password, confirm) {
  if (!/^[A-Za-z0-9_]{3,20}$/.test(username)) return 'Username must be 3-20 characters: letters, numbers or underscore';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return 'Please enter a valid email address';
  if (password.length < 8 || password.length > 16) return 'Password must be 8-16 characters long';
  if (!/[a-z]/.test(password)) return 'Password needs a lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Password needs an uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password needs a number';
  if (!/[^A-Za-z0-9\s]/.test(password)) return 'Password needs a special symbol';
  if (password !== confirm) return 'Passwords do not match';
  return '';
}

byId('signupForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  const username = byId('signupUsername').value.trim();
  const email = byId('signupEmail').value.trim();
  const password = byId('signupPassword').value;
  const confirm = byId('signupConfirm').value;
  const problem = checkSignup(username, email, password, confirm);
  if (problem) {
    setText('authMessage', problem);
    return;
  }
  const data = await api('/api/signup', 'POST', { username: username, email: email, password: password, confirmPassword: confirm });
  if (data.ok) {
    byId('showLogin').click();
    setText('authMessage', data.message);
  } else {
    setText('authMessage', data.error);
  }
});

byId('loginForm').addEventListener('submit', async function (event) {
  event.preventDefault();
  const data = await api('/api/login', 'POST', {
    identifier: byId('loginIdentifier').value,
    password: byId('loginPassword').value
  });
  if (data.ok) {
    byId('loginPassword').value = '';
    setText('authMessage', '');
    loadHome();
  } else {
    setText('authMessage', data.error);
  }
});

// ===== Homepage =====
// Asks the backend who is logged in. A running match is resumed, otherwise the homepage is shown.
async function loadHome() {
  const data = await api('/api/home', 'GET');
  if (data.httpStatus === 401) {
    showScreen('landingScreen');
    return;
  }
  myName = data.username;
  setText('trophyCount', data.trophies);
  setText('pUsername', data.username);
  setText('pTrophies', data.trophies);
  setText('pPlayed', data.stats.played);
  setText('pWon', data.stats.won);
  setText('pLost', data.stats.lost);
  setText('pDraws', data.stats.draws);
  setText('pCorrect', data.stats.correctAnswers);
  if (data.activeMatchId) {
    startPolling(data.activeMatchId);
  } else {
    showScreen('homeScreen');
  }
}

const subjectButtons = document.querySelectorAll('.subjectButton');
for (let i = 0; i < subjectButtons.length; i++) {
  subjectButtons[i].addEventListener('click', function (event) {
    selectedSubject = event.target.dataset.subject;
    for (let j = 0; j < subjectButtons.length; j++) {
      subjectButtons[j].classList.toggle('selected', subjectButtons[j] === event.target);
    }
  });
}

byId('botModeButton').addEventListener('click', function () {
  botModeChosen = true;
  byId('botModeButton').classList.add('selected');
});

byId('startButton').addEventListener('click', function () {
  if (selectedSubject === '') {
    setText('homeMessage', 'Please choose a subject.');
  } else if (!botModeChosen) {
    setText('homeMessage', 'Please choose Bot Mode.');
  } else {
    setText('homeMessage', '');
    startMatch(selectedSubject);
  }
});

// ===== Menu =====
byId('howBox').innerHTML = byId('rules').innerHTML; // reuse the rules text from the landing page

byId('menuButton').addEventListener('click', function () {
  byId('menu').classList.toggle('hidden');
});
byId('menuProfile').addEventListener('click', function () {
  showScreen('profileScreen');
});
byId('menuHow').addEventListener('click', function () {
  showScreen('howScreen');
});
byId('menuLogout').addEventListener('click', async function () {
  await api('/api/logout', 'POST');
  clearInterval(pollTimer);
  showScreen('landingScreen');
});

const backButtons = document.querySelectorAll('.backButton');
for (let i = 0; i < backButtons.length; i++) {
  backButtons[i].addEventListener('click', function () {
    showScreen('homeScreen');
  });
}

// ===== Quiz =====
async function startMatch(subject) {
  const data = await api('/api/matches', 'POST', { subject: subject });
  if (data.ok) {
    startPolling(data.matchId);
  } else {
    alert(data.error);
  }
}

// Asks the backend for the match state once every second
function startPolling(id) {
  matchId = id;
  resultScheduled = false;
  clearInterval(pollTimer);
  showScreen('quizScreen');
  pollMatch();
  pollTimer = setInterval(pollMatch, 1000);
}

async function pollMatch() {
  const state = await api('/api/matches/' + matchId, 'GET');
  if (!state.ok) {
    clearInterval(pollTimer);
    loadHome();
  } else {
    drawQuiz(state);
  }
}

async function sendAnswer(letter) {
  const state = await api('/api/matches/' + matchId + '/answer', 'POST', { option: letter });
  if (state.ok) {
    drawQuiz(state);
  }
}

const optionButtons = document.querySelectorAll('.optionButton');
for (let i = 0; i < optionButtons.length; i++) {
  optionButtons[i].addEventListener('click', function (event) {
    sendAnswer(event.target.dataset.option);
  });
}

// Draws 5 circles. status is pending (white), correct (green), incorrect or unanswered (red)
function drawDots(boxId, statuses) {
  const box = byId(boxId);
  box.innerHTML = '';
  for (let i = 0; i < statuses.length; i++) {
    const dot = document.createElement('span');
    dot.className = 'dot ' + statuses[i];
    box.appendChild(dot);
  }
}

// Turns the match state from the backend into what the player sees
function drawQuiz(state) {
  if (state.status === 'abandoned') {
    clearInterval(pollTimer);
    loadHome();
    return;
  }
  const q = state.question;
  setText('userName', myName);
  setText('userScore', state.userScore);
  setText('botScore', state.botScore);
  drawDots('userDots', state.userDots);
  drawDots('botDots', state.botDots);
  setText('questionNumber', state.questionNumber);
  setText('timeLeft', q.secondsLeft);
  setText('questionText', q.text);
  for (let i = 0; i < optionButtons.length; i++) {
    const letter = optionButtons[i].dataset.option;
    optionButtons[i].textContent = letter + '. ' + q.options[letter];
    optionButtons[i].disabled = q.isResolved || q.userStatus !== 'pending';
    optionButtons[i].className = 'optionButton';
    if (q.yourOption === letter) {
      optionButtons[i].classList.add('chosen');
    }
    if (q.isResolved && letter === q.correctOption) {
      optionButtons[i].classList.add('correctOption');
    } else if (q.isResolved && q.yourOption === letter) {
      optionButtons[i].classList.add('wrongOption');
    }
  }
  let message = 'Pick an answer before the timer runs out.';
  if (q.isResolved) {
    message = 'You: ' + signed(q.userPoints) + ' points. StudyBot: ' + signed(q.botPoints) + ' points.';
    message += state.status === 'completed' ? ' Match over!' : ' Next question is starting...';
  } else if (q.userStatus === 'incorrect') {
    message = 'Wrong answer (-3). Waiting to see if StudyBot answers...';
  }
  setText('quizMessage', message);
  if (state.status === 'completed' && !resultScheduled) {
    resultScheduled = true;
    clearInterval(pollTimer);
    setTimeout(function () { showResult(state); }, 3000); // let the player see the last answer
  }
}

// ===== Result =====
function showResult(state) {
  let banner = 'You win!';
  let winner = myName;
  if (state.winner === 'bot') {
    banner = 'You lose';
    winner = 'StudyBot';
  } else if (state.winner === 'draw') {
    banner = 'Draw';
    winner = 'Draw';
  }
  setText('resultBanner', banner);
  setText('resultWinner', winner);
  setText('resultScore', myName + ' ' + state.userScore + ' - ' + state.botScore + ' StudyBot');
  setText('resultChange', signed(state.trophyChange));
  setText('resultTrophies', state.trophies);
  lastSubject = state.subject;
  showScreen('resultScreen');
}

byId('playAgainButton').addEventListener('click', function () {
  startMatch(lastSubject);
});
byId('backHomeButton').addEventListener('click', function () {
  loadHome();
});

loadHome(); // when the page opens: are we logged in?
