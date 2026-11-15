// Initializing Supabase
const SUPABASE_URL = 'https://dezledviflcsjkurtmiq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_41xns9eV4rAt0Po73EnsQw_slVJKmDC';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
        storage: window.sessionStorage,
        persistSession: true,
        autoRefreshToken: true
    }
});

// Global player identity for matchmaking & app.js
let currentUsername = null;
let currentUserId = null;

// --- 1. SIGN-UP LOGIC (Saves chosen username to Supabase user_metadata) ---
const signupForm = document.getElementById('signupForm');
if (signupForm) {
    signupForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('signupUsername').value.trim();
        const email = document.getElementById('signupEmail').value.trim();
        const password = document.getElementById('passwordInput').value;
        const confirmPassword = document.getElementById('confirmPasswordInput').value;

        if (!username) {
            alert('Please enter a username!');
            return;
        }

        if (password !== confirmPassword) {
            alert('Passwords do not match!');
            return;
        }

        const { data, error } = await supabaseClient.auth.signUp({
            email: email,
            password: password,
            options: {
                data: {
                    username: username // Stores the exact chosen username in Supabase
                }
            }
        });

        if (error) {
            alert('Sign-up error: ' + error.message);
        } else {
            alert('Sign-up successful! You can now log in.');
            if (typeof toggleAuth === 'function') {
                toggleAuth('login');
            }
        }
    });
}

// --- 2. LOGIN LOGIC ---
const loginForm = document.getElementById('loginForm');
if (loginForm) {
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const email = document.getElementById('loginEmail').value.trim();
        const password = document.getElementById('loginPassword').value;

        const { data, error } = await supabaseClient.auth.signInWithPassword({
            email: email,
            password: password
        });

        if (error) {
            alert('Login error: ' + error.message);
        } else {
            // Save chosen username immediately on login
            const chosenUsername = data.user.user_metadata.username;
            localStorage.setItem('username', chosenUsername);
            localStorage.setItem('userId', data.user.id);

            window.location.href = 'index.html';
        }
    });
}

// --- 3. LANDING PAGE: show username, handle Start button ---
function showUserInNav(name) {
    const link = document.getElementById('navLoginLink');
    if (!link) return;
    link.textContent = name;
    link.setAttribute('href', '#');
    link.onclick = (e) => e.preventDefault();
}

function showLoginInNav() {
    const link = document.getElementById('navLoginLink');
    if (!link) return;
    link.textContent = 'Login';
    link.setAttribute('href', 'auth.html');
    link.onclick = null;
}

// Called when Start is clicked
async function enterGame() {
    const { data: { session } } = await supabaseClient.auth.getSession();

    if (!session) {
        window.location.href = 'auth.html';   // not logged in -> login first
        return;
    }

    document.getElementById('landingScreen')?.classList.add('hidden');
    document.getElementById('landingExtras')?.classList.add('hidden');
    document.getElementById('homeScreen')?.classList.remove('hidden');
    window.scrollTo(0, 0);
}

async function initAuthOnLanding() {
    // Skip when on auth.html
    if (loginForm || signupForm) return;

    // Start button
    const startBtn = document.getElementById('startBtn');
    if (startBtn) {
        startBtn.addEventListener('click', (e) => {
            e.preventDefault();
            enterGame();
        });
    }

    // Show saved name instantly, then confirm with Supabase
    const cachedName = localStorage.getItem('username');
    if (cachedName) showUserInNav(cachedName);

    const { data: { session } } = await supabaseClient.auth.getSession();
    const user = session?.user;

    if (!user) {
        currentUsername = null;
        currentUserId = null;
        localStorage.removeItem('username');
        localStorage.removeItem('userId');
        showLoginInNav();
        return;
    }

    currentUsername = user.user_metadata?.username || user.email.split('@')[0];
    currentUserId = user.id;
    localStorage.setItem('username', currentUsername);
    localStorage.setItem('userId', currentUserId);

    showUserInNav(currentUsername);

    // Fill username slots (used later inside the game)
    ['pUsername', 'userName', 'homeUsername'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = currentUsername;
    });

    window.dispatchEvent(new CustomEvent('userReady', {
        detail: { userId: currentUserId, username: currentUsername }
    }));
}

initAuthOnLanding();