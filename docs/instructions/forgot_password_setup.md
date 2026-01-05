# Forgot Password Setup (Supabase + Luden)

This guide finalizes the reset-password flow and provides dashboard steps and templates.

## Supabase Auth URL Configuration
- Site URL (prod): your GitHub Pages root, e.g. `https://<username>.github.io/<repo>/`
- Redirect URLs:
  - Prod: `https://<username>.github.io/<repo>/reset_password.html`
  - Dev: `http://localhost:8080/reset_password.html`
- Notes:
  - These must exactly match the `redirectTo` we use in `auth_supabase.js`.
  - If redirect fails, it’s usually due to missing whitelist entries.

## Email Template (Reset Password)
Use your Supabase Dashboard → Authentication → Email Templates → Reset password.

Paste a branded template (keep the reset link variable from Supabase intact):

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Reset your password</title>
    <style>
      body { font-family: Arial, sans-serif; color: #222; }
      .container { max-width: 560px; margin: 0 auto; padding: 24px; }
      .brand { font-size: 18px; font-weight: 600; margin-bottom: 16px; }
      .btn { display: inline-block; padding: 10px 16px; background: #2f6bed; color: #fff; text-decoration: none; border-radius: 6px; }
      .muted { color: #666; font-size: 13px; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="brand">Luden</div>
      <p>We received a request to reset the password for your account.</p>
      <p>Click the button below to set a new password:</p>
      <!-- IMPORTANT: Keep Supabase's reset link variable exactly as provided in the dashboard. -->
      <!-- Example (the exact variable name is shown in your dashboard editor): -->
      <!-- <a class="btn" href="{{ .ConfirmationURL }}">Reset your password</a> -->
      <!-- If your dashboard displays a different variable (e.g., {{ .RedirectTo }} or {{ .ActionURL }}), use that instead. -->

      <p class="muted">If you didn’t request this, you can safely ignore this email.</p>
      <p class="muted">For security, this link expires after a short time.</p>
    </div>
  </body>
</html>
```

## Optional: Custom SMTP
- Supabase → Authentication → SMTP
- Configure your SMTP provider (domain, credentials) so emails come from your brand.
- Improves deliverability and trust; optional for v0.1.

## Test Checklist
1. On [docs/auth.html](docs/auth.html), click “Forgot password?” → enter email → submit.
2. See neutral message: "If an account exists... we’ve sent a reset link."
3. Email link opens [docs/reset_password.html](docs/reset_password.html).
4. Enter new password + confirm (8+ chars, letter + number) → submit.
5. See success → Back to login.
6. Login with the new password; old password fails.
7. Refresh/reset page after success does not break auth; no auto re-login after logout.

## Notes
- Update the GitHub Pages prod URL placeholders above to your repo.
- Keep the reset link variable in the email template unchanged; Supabase injects the correct URL.
