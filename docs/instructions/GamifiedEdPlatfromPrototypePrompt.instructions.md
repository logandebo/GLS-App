# Copilot Instruction File — Implement “Forgot Password” (Supabase) for Luden

Goal: Add a professional, secure “Forgot password” flow that emails the user a **reset link** and lets them set a **new password** (never reveals the old password). Use Supabase Auth (supabase-js v2 UMD) consistent with existing `supabaseClient.js` wrapper.

---

## 0) High-level UX (what users experience)

1. On the Login screen there is a **“Forgot password?”** link.
2. User enters their email → clicks **Send reset link**.
3. UI shows a professional neutral message like:
   - “If an account exists for that email, we’ve sent a password reset link.”
   (Do not confirm whether the email exists.)
4. User clicks link in email → lands on a **Reset Password** page.
5. They enter **New password** + **Confirm** → submit.
6. Show success message → offer a button to go to Login.

---

## 1) Supabase dashboard configuration (required)

### 1.1 Set Site URL and Redirect URLs
In Supabase: **Authentication → URL Configuration**
- **Site URL:** set to your production site root (GitHub Pages URL), e.g.
  - `https://<your-github-username>.github.io/<repo>/`
- **Redirect URLs:** add *both* prod and local dev:
  - `https://<your-github-username>.github.io/<repo>/reset_password.html`
  - `http://localhost:8000/reset_password.html` (or whatever dev port you use)

These must match the URL you pass as `redirectTo`.

### 1.2 Email delivery quality (recommended)
In Supabase: **Authentication → Email Templates**
- Customize the “Reset password” template:
  - Keep the reset link variable intact.
  - Add your branding (“Luden”) and short instructions.

Optional but recommended for “big company” feel:
- Configure **Custom SMTP** (Supabase: Auth → SMTP) so emails come from your domain.
  - Otherwise Supabase sends using its defaults (fine for v0.1).

---

## 2) Files to add/edit

### 2.1 Add page: `docs/reset_password.html`
Create a dedicated reset page. It should:
- Detect a valid recovery session from the URL after Supabase redirect.
- Prompt user for a new password (and confirm).
- Call Supabase to update password.
- Handle errors gracefully (expired link, weak password, etc.)

### 2.2 Edit page: `docs/auth.html`
Add:
- A “Forgot password?” link under the login form.
- A “Forgot password panel/modal/section” with:
  - Email input
  - “Send reset link” button
  - “Back to login” link

### 2.3 Add/Update script: `docs/js/auth_supabase.js` (or create `forgot_password.js`)
Implement:
- `requestPasswordReset(email)`
- `handlePasswordRecoveryOnResetPage()`
- `submitNewPassword(newPassword)`

Use the *existing* `window.supabaseClient` wrapper if present.
If wrapper lacks needed methods, extend `supabaseClient.js`.

---

## 3) Implementation details (Supabase JS v2 UMD)

### 3.1 Request reset email
Use:
- `supabase.auth.resetPasswordForEmail(email, { redirectTo })`

Requirements:
- `redirectTo` must be one of the allowed redirect URLs in Supabase settings.

Security UX:
- Always show the same success message regardless of whether the email exists.

### 3.2 Reset password page: handle recovery session
Supabase sends users back with auth data in the URL (often in the hash `#`).
On page load:
1. Initialize Supabase client normally.
2. Call `supabase.auth.getSession()` and/or listen to `supabase.auth.onAuthStateChange`.
3. Supabase typically triggers `PASSWORD_RECOVERY` event or provides a session.
4. If no valid recovery session exists:
   - Show “This reset link is invalid or expired. Request a new one.”
   - Provide a link back to `auth.html` with the forgot panel open.

Implementation approach:
- Register `onAuthStateChange((event, session) => { ... })`
- If `event === 'PASSWORD_RECOVERY'` OR session exists and page is reset:
  - show the new password form.

### 3.3 Set the new password
Use:
- `supabase.auth.updateUser({ password: newPassword })`

Then:
- Show success state.
- OPTIONAL: Immediately `signOut()` to force re-login with new password (recommended for clarity).
  - Some apps keep the user signed in; either is acceptable, but “big company” feel is typically: reset → success → login.

---

## 4) Password policy (professional defaults)

Enforce client-side validation *before* calling update:
- Minimum 8 characters (prefer 10–12).
- Must include at least 1 letter and 1 number (optionally 1 symbol).
- New password and confirm must match.

Also display server-side errors verbatim (sanitized) when Supabase rejects:
- e.g., “Password should be at least 6 characters” depending on project settings.

Do NOT implement “security questions”.
Do NOT ever show existing passwords.

---

## 5) UI requirements (professional)

### 5.1 Forgot password panel
- Title: “Reset your password”
- Copy: “Enter your email and we’ll send you a reset link.”
- Button: “Send reset link”
- After submission:
  - show neutral success message
  - disable the button for ~5–10 seconds to prevent spam-clicking
  - show small “Didn’t get it? Check spam or try again.”

### 5.2 Reset password page
- Title: “Create a new password”
- Fields:
  - New password
  - Confirm new password
- Provide show/hide password toggle
- Provide inline validation messages
- Provide success state with button: “Back to login”

---

## 6) Concrete tasks for Copilot (step-by-step)

### Task A — Update `supabaseClient.js` wrapper (if needed)
Check if wrapper already exposes these. If not, add:
- `resetPasswordForEmail(email, redirectTo)`
- `updatePassword(newPassword)` (calls `supabase.auth.updateUser`)
- Ensure `storageKey` is consistent and no “session resurrection” regression.

### Task B — Implement forgot password UI in `auth.html`
- Add link/button under login form.
- Add a “forgot password view” (either separate section or modal).
- Wire events in `auth_supabase.js`.

### Task C — Create `reset_password.html`
- Include the Supabase UMD script(s) same as other pages.
- Include `supabaseClient.js`.
- Include a new `reset_password.js` (or extend `auth_supabase.js`).
- Implement:
  - `initResetPasswordPage()` on DOMContentLoaded
  - It should:
    - wait for session hydration
    - detect PASSWORD_RECOVERY/session
    - render correct UI state

### Task D — Add robust error handling
Handle:
- Missing/expired link
- Weak password
- Network errors
- User closes tab mid-flow

### Task E — Verify end-to-end
Checklist:
1. Login page shows “Forgot password?” and opens panel.
2. Enter email → neutral success message.
3. Email arrives with link.
4. Link opens reset page.
5. Set new password successfully.
6. User can log in with new password; old password fails.
7. Refresh/reset page after success does not break auth state.

---

## 7) Suggested code structure (simple + maintainable)

- `docs/auth.html`
- `docs/reset_password.html`
- `docs/js/supabaseClient.js`
- `docs/js/auth_supabase.js`
- `docs/js/reset_password.js` (new)

Avoid duplicating client initialization.
Ensure all pages import the same `supabaseClient.js`.

---

## 8) Notes on Supabase Auth settings you may need to tweak
- If you want stronger password rules, check Supabase Auth settings for password strength (if available in your plan/version).
- If emails aren’t arriving reliably, set up SMTP.
- If redirect fails, it’s almost always because Redirect URLs aren’t whitelisted.

---

## 9) Deliverables Copilot must produce
1. Working forgot-password UI on `auth.html`
2. Working `reset_password.html` page
3. Minimal changes to existing auth logic (no regressions)
4. Clear comments explaining where to update URLs for prod/dev
5. Short test instructions at the bottom of the PR/summary

End.
