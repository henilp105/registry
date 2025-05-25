import os
from smtplib import SMTP
from dotenv import load_dotenv

load_dotenv()

class MailService:
    def __init__(self):
        self.is_ci = os.getenv("IS_CI", "false").lower()
        self.sender_email = os.getenv("RESET_EMAIL")
        self.sender_password = os.getenv("RESET_PASSWORD")
        self.host = os.getenv("SMTP_HOST", "smtp.gmail.com")
        self.port = int(os.getenv("SMTP_PORT", 587))
        self.base_url = os.getenv("HOST")

    def send_email(self, to, subject, body):
        if self.is_ci == "true":
            print(f"CI Mode: Email not sent to {to} with subject '{subject}'")
            return True

        if not self.sender_email or not self.sender_password:
            print("MailService: RESET_EMAIL or RESET_PASSWORD not set")
            return False

        try:
            with SMTP(host=self.host, port=self.port) as server:
                # server.ehlo()
                # server.starttls()
                server.ehlo()
                server.login(self.sender_email, self.sender_password)
                message = f"Subject: {subject}\nTo: {to}\n{body}"
                server.sendmail(self.sender_email, to, message)
            return True
        except Exception as e:
            print(f"MailService Error: {str(e)}")
            return False

    def send_verification_email(self, to, username, uuid):
        if not self.base_url:
            print("MailService: HOST environment not set")
            return False

        body = f"""Dear {username},

We received a request to verify your email. To verify your email, please copy paste the link below in a new browser window:

{self.base_url}/account/verify/{uuid}

Thank you,
The Fortran-lang Team"""

        return self.send_email(to, "Verify email", body)

    def send_password_reset_email(self, to, username, uuid):
        if not self.base_url:
            print("MailService: HOST environment not set")
            return False

        body = f"""Dear {username},

We received a request to reset your password. To reset your password, please copy paste the link below in a new browser window:

{self.base_url}/account/reset-password/{uuid}

Thank you,
The Fortran-lang Team"""

        return self.send_email(to, "Password reset link", body)


# Singleton instance
mailer = MailService()
