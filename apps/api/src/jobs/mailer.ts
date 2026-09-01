/**
 * Outbound mail, behind the smallest possible seam.
 *
 * Resend when RESEND_API_KEY is present; otherwise sending THROWS, on purpose.
 * The tempting fallback — log the email instead — would put a live sign-in
 * link into the log store, which is exactly the credential-in-logs failure the
 * platform's redaction rules exist to prevent. An unconfigured mailer should
 * look like what it is: a dead job on /admin/jobs saying so, not a silent
 * success or a leaked link.
 */
export type Mail = {
  to: string;
  subject: string;
  text: string;
};

export async function sendMail(mail: Mail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error(
      "no email provider configured - set RESEND_API_KEY to enable magic-link delivery",
    );
  }

  const from = process.env.MAIL_FROM ?? "onboarding@resend.dev";
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ from, to: mail.to, subject: mail.subject, text: mail.text }),
  });

  if (!response.ok) {
    // The body names the reason (bad key, unverified domain) and carries no
    // secret; the link is in the request, not the response.
    const detail = (await response.text()).slice(0, 300);
    throw new Error(`mail provider refused: HTTP ${response.status} ${detail}`);
  }
}
