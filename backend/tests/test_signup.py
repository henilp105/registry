"""
Test cases for user signup functionality.
"""

from base_case import BaseTestClass
import os


class TestSignUp(BaseTestClass):
    """Test cases for the /auth/signup endpoint."""
    
    # Test data constants
    TEST_EMAIL = "testemail@gmail.com"
    TEST_PASSWORD = "123456"
    TEST_USERNAME = "testuser"

    def test_successful_signup(self):
        """
        Test successful user registration with valid data.
        
        Given: Valid email, password, and username
        When: POST to /auth/signup
        Then: Response code should be 200
        """
        data = {
            "email": self.TEST_EMAIL,
            "password": self.TEST_PASSWORD,
            "username": self.TEST_USERNAME,
        }

        response = self.client.post("/auth/signup", data=data)
        self.assertResponseCode(response, 200)

    def test_signup_without_email(self):
        """
        Test signup fails when email is missing.
        
        Given: Empty email with valid password and username
        When: POST to /auth/signup
        Then: Response code should be 400
        """
        data = {
            "email": "",
            "password": self.TEST_PASSWORD,
            "username": self.TEST_USERNAME
        }

        response = self.client.post("/auth/signup", data=data)
        self.assertResponseCode(response, 400)

    def test_signup_without_password(self):
        """
        Test signup fails when password is missing.
        
        Given: Valid email and username with empty password
        When: POST to /auth/signup
        Then: Response code should be 400
        """
        data = {
            "email": self.TEST_EMAIL,
            "password": "",
            "username": self.TEST_USERNAME
        }

        response = self.client.post("/auth/signup", data=data)
        self.assertResponseCode(response, 400)

    def test_signup_without_username(self):
        """
        Test signup fails when username is missing.
        
        Given: Valid email and password with empty username
        When: POST to /auth/signup
        Then: Response code should be 400
        """
        data = {
            "email": self.TEST_EMAIL,
            "password": self.TEST_PASSWORD,
            "username": ""
        }

        response = self.client.post("/auth/signup", data=data)
        self.assertResponseCode(response, 400)

    def test_signup_duplicate_user(self):
        """
        Test signup fails when user already exists.
        
        Given: User with email/username already registered
        When: POST to /auth/signup with same data
        Then: Response code should be 400
        """
        data = {
            "email": self.TEST_EMAIL,
            "password": self.TEST_PASSWORD,
            "username": self.TEST_USERNAME,
        }

        # Create user first
        response = self.client.post("/auth/signup", data=data)
        self.assertResponseCode(response, 200)

        # Try to signup again with same data
        response = self.client.post("/auth/signup", data=data)
        self.assertResponseCode(response, 400)

    def test_sudo_user_signup(self):
        """
        Test sudo user registration with SUDO_PASSWORD.
        
        Given: Valid data with SUDO_PASSWORD as password
        When: POST to /auth/signup
        Then: Response code should be 200
        """
        sudo_password = os.getenv("SUDO_PASSWORD")
        if not sudo_password:
            self.skipTest("SUDO_PASSWORD not set in environment")
        
        data = {
            "email": "sudouser@gmail.com",
            "password": sudo_password,
            "username": "sudouser",
        }

        response = self.client.post("/auth/signup", data=data)
        self.assertResponseCode(response, 200)