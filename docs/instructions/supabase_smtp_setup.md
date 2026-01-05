# Supabase SMTP Setup (Optional)

Configuring SMTP helps deliver branded, reliable emails for password resets and other auth flows.

## Where to Configure
- Supabase Dashboard → Authentication → SMTP

## Required Fields
- Hostname (e.g., smtp.sendgrid.net, smtp.gmail.com, your provider)
- Port (typically 587 for TLS)
- Username
- Password
- From Address (e.g., no-reply@yourdomain.com)
- From Name (e.g., Luden)

## Recommended Settings
- Use a dedicated sender address (no-reply@yourdomain.com).
- Set up SPF/DKIM on your domain for better deliverability.
- Monitor bounces and complaints with your provider.

## Validation
- Send a test email from Supabase.
- Ensure your reset email arrives promptly and is not flagged as spam.

## Notes
- SMTP is optional for v0.1; Supabase’s default sender works for testing.
- If using a provider (SendGrid, Mailgun, SES), follow their domain verification steps.
