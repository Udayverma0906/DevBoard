'use strict';

let authMode = 'login';

function setMode(mode) {
  authMode = mode;
  const isSignup = mode === 'signup';
  document.getElementById('loginHeading').textContent  = isSignup ? 'Create your account' : 'Sign in to your account';
  document.getElementById('loginSubmit').textContent   = isSignup ? 'Create Account' : 'Sign In';
  document.getElementById('toggleText').textContent    = isSignup ? 'Already have an account?' : "Don't have an account?";
  document.getElementById('toggleMode').textContent    = isSignup ? 'Sign in' : 'Create account';
  document.getElementById('nameField').style.display   = isSignup ? '' : 'none';
  document.getElementById('loginError').style.display  = 'none';
  document.getElementById(isSignup ? 'nameInput' : 'emailInput').focus();
}

function showError(msg) {
  const el = document.getElementById('loginError');
  el.textContent  = msg;
  el.style.display = '';
}

async function submit() {
  const email    = document.getElementById('emailInput').value.trim();
  const password = document.getElementById('passwordInput').value;
  const name     = document.getElementById('nameInput').value.trim();

  if (!email || !password) { showError('Please enter your email and password.'); return; }

  const btn = document.getElementById('loginSubmit');
  btn.disabled    = true;
  btn.textContent = authMode === 'signup' ? 'Creating…' : 'Signing in…';
  document.getElementById('loginError').style.display = 'none';

  try {
    if (authMode === 'signup') {
      if (!name)            { showError('Please enter your name.');                    btn.disabled = false; btn.textContent = 'Create Account'; return; }
      if (password.length < 6) { showError('Password must be at least 6 characters.'); btn.disabled = false; btn.textContent = 'Create Account'; return; }

      const { data, error } = await supaClient.auth.signUp({
        email, password,
        options: { data: { full_name: name } },
      });
      if (error) throw error;

      if (!data.session) {
        // Email confirmation is ON — tell user to check inbox
        document.getElementById('loginError').style.setProperty('color', '#7bd47b');
        showError('Account created! Check your email to confirm, then sign in.');
        btn.disabled    = false;
        btn.textContent = 'Create Account';
        return;
      }
    } else {
      const { error } = await supaClient.auth.signInWithPassword({ email, password });
      if (error) throw error;
    }
    window.location.replace('index.html');
  } catch (err) {
    showError(err.message || 'Something went wrong. Please try again.');
    btn.disabled    = false;
    btn.textContent = authMode === 'signup' ? 'Create Account' : 'Sign In';
  }
}

document.getElementById('loginSubmit').addEventListener('click', submit);
document.getElementById('toggleMode').addEventListener('click', () => setMode(authMode === 'login' ? 'signup' : 'login'));

['nameInput', 'emailInput', 'passwordInput'].forEach(id => {
  document.getElementById(id).addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
});

// Redirect to app if already logged in
(async () => {
  const { data: { session } } = await supaClient.auth.getSession();
  if (session) window.location.replace('index.html');
})();
