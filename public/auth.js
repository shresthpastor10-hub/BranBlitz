// Initialize Supabase (Replace with your actual URL and Anon Key)
const SUPABASE_URL = 'https://dezledviflcsjkurtmiq.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_41xns9eV4rAt0Po73EnsQw_slVJKmDC';
const supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Handles Sign-Up
document.getElementById('signupForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const username = document.getElementById('signupUsername').value.trim();
    const email = document.getElementById('signupEmail').value.trim();
    const password = document.getElementById('passwordInput').value;
    const confirmPassword = document.getElementById('confirmPasswordInput').value;

    if (password !== confirmPassword) {
        alert('Passwords do not match!');
        return;
    }

    const { data, error } = await supabaseClient.auth.signUp({
        email: email,
        password: password,
        options: {
            data: {
                username: username
            }
        }
    });

    if (error) {
        alert('Sign-up error: ' + error.message);
    } else {
        alert('Sign-up successful! You may now login.');
        toggleAuth('login');
    }
});

// Handles Login
document.getElementById('loginForm').addEventListener('submit', async (e) => {
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
        alert('Logged in! Redirecting...');
        window.location.href = 'index.html';
    }
});