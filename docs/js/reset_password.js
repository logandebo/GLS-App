// Reset password page logic

const statusEl = document.getElementById('reset-status');
const formEl = document.getElementById('reset-form');
const successEl = document.getElementById('reset-success');
const newPwdEl = document.getElementById('new-password');
const confirmEl = document.getElementById('confirm-password');
const submitBtn = document.getElementById('reset-submit');
const toggleNewBtn = document.getElementById('toggle-new');
const toggleConfirmBtn = document.getElementById('toggle-confirm');

function setStatus(msg) {
  if (statusEl) statusEl.textContent = msg || '';
}

function meetsPolicy(pwd) {
  if (!pwd || pwd.length < 8) return false;
  const hasLetter = /[A-Za-z]/.test(pwd);
  const hasNumber = /\d/.test(pwd);
  return hasLetter && hasNumber;
}

function toggleVisibility(inputEl, btnEl){
  if (!inputEl || !btnEl) return;
  const isPwd = inputEl.getAttribute('type') === 'password';
  inputEl.setAttribute('type', isPwd ? 'text' : 'password');
  btnEl.textContent = isPwd ? 'Hide' : 'Show';
}

async function initResetPasswordPage(){
  try {
    if (!window.supabaseClient || !window.supabaseClient.isConfigured()) {
      setStatus('Supabase not configured.');
      return;
    }
    // Listen for recovery event; show form when recovery is detected
    window.supabaseClient.onAuthStateChange(async (session, evt) => {
      try { console.log('[RESET] auth state change', { evt, hasSession: !!session }); } catch {}
      if (evt === 'PASSWORD_RECOVERY' || session) {
        if (formEl) formEl.style.display = 'block';
        setStatus('Enter a new password.');
      }
    });
    // Also check current session in case event already fired before handler
    const { data } = await window.supabaseClient.getSession();
    if (data?.session) {
      if (formEl) formEl.style.display = 'block';
      setStatus('Enter a new password.');
    } else {
      // Neutral guidance until event arrives; if link invalid, user will remain here
      setStatus('If this link is invalid or expired, request a new reset link from the login page.');
    }
  } catch (e) {
    setStatus('Initialization error. Please reload.');
  }
}

function bindEvents(){
  if (toggleNewBtn) toggleNewBtn.addEventListener('click', () => toggleVisibility(newPwdEl, toggleNewBtn));
  if (toggleConfirmBtn) toggleConfirmBtn.addEventListener('click', () => toggleVisibility(confirmEl, toggleConfirmBtn));
  if (submitBtn) {
    submitBtn.addEventListener('click', async () => {
      const pwd = newPwdEl?.value || '';
      const confirmPwd = confirmEl?.value || '';
      if (!pwd || !confirmPwd) { setStatus('Please enter and confirm your new password.'); return; }
      if (pwd !== confirmPwd) { setStatus('Passwords do not match.'); return; }
      if (!meetsPolicy(pwd)) { setStatus('Password must be 8+ chars and include a letter and a number.'); return; }
      submitBtn.disabled = true;
      try {
        const { error } = await window.supabaseClient.updatePassword(pwd);
        if (error) { setStatus(`Update failed: ${error.message}`); }
        else {
          setStatus('');
          if (formEl) formEl.style.display = 'none';
          if (successEl) successEl.style.display = 'block';
          // Optional: sign out to force re-login clarity
          try { await window.supabaseClient.signOut(); } catch {}
        }
      } catch (e) {
        setStatus('Network error. Please try again.');
      } finally {
        setTimeout(() => { submitBtn.disabled = false; }, 4000);
      }
    });
  }
}

initResetPasswordPage();
bindEvents();
