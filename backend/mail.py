import os
import requests
from dotenv import load_dotenv

load_dotenv()

class MailService:
    """Email service using Brevo API (HTTP-based, bypasses SMTP port blocks)"""
    
    # Brevo API configuration
    BREVO_API_URL = 'https://api.brevo.com/v3/smtp/email'
    REQUEST_TIMEOUT = 10

    def __init__(self):
        self.is_ci = os.getenv("IS_CI", "false").lower()
        self.brevo_api_key = os.getenv("BREVO_API_KEY")
        self.sender_email = os.getenv("BREVO_SENDER_EMAIL") or os.getenv("RESET_EMAIL", "noreply@fpm-registry.org")
        self.sender_name = os.getenv("BREVO_SENDER_NAME", "FPM Registry")
        self.base_url = os.getenv("HOST")

    def send_email(self, to, subject, body):
        """Send email using Brevo HTTP API"""
        if self.is_ci == "true":
            print(f"CI Mode: Email not sent to {to} with subject '{subject}'")
            return True

        if not self.brevo_api_key:
            print("MailService: BREVO_API_KEY not set")
            return False

        try:
            # Convert plain text body to simple HTML
            html_body = body.replace('\n', '<br>')
            
            payload = {
                "sender": {
                    "email": self.sender_email,
                    "name": self.sender_name
                },
                "to": [{"email": to}],
                "subject": subject,
                "htmlContent": f"<html><body>{html_body}</body></html>",
                "textContent": body
            }
            
            headers = {
                "api-key": self.brevo_api_key,
                "Content-Type": "application/json"
            }
            
            response = requests.post(
                self.BREVO_API_URL,
                json=payload,
                headers=headers,
                timeout=self.REQUEST_TIMEOUT
            )
            
            if response.status_code in [200, 201]:
                print(f"MailService: Email sent successfully to {to}")
                return True
            else:
                print(f"MailService Error: Brevo API returned {response.status_code} - {response.text}")
                return False
                
        except requests.exceptions.Timeout:
            print(f"MailService Error: Request timed out after {self.REQUEST_TIMEOUT}s")
            return False
        except requests.exceptions.RequestException as e:
            print(f"MailService Error: Request failed - {str(e)}")
            return False
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
