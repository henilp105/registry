"""
Test cases for user login and logout functionality.
"""

from base_case import BaseTestClass


class TestLogin(BaseTestClass):
    """Test cases for /auth/login and /auth/logout endpoints."""
    
    # Test data constants
    TEST_EMAIL = "testemail@gmail.com"
    TEST_PASSWORD = "123456"
    TEST_USERNAME = "testuser"

    def _create_and_login_user(self):
        """
        Helper to create a user and return the access token.
        
        Returns:
            str: Access token for the logged-in user
        """
        # Create user
        signup_data = {
            "email": self.TEST_EMAIL,
            "password": self.TEST_PASSWORD,
            "username": self.TEST_USERNAME
        }
        response = self.client.post("/auth/signup", data=signup_data)
        self.assertResponseCode(response, 200)
        
        # Login
        login_data = {
            "user_identifier": self.TEST_EMAIL,
            "password": self.TEST_PASSWORD
        }
        response = self.client.post("/auth/login", data=login_data)
        self.assertResponseCode(response, 200)
        
        return response.json["access_token"]

    def test_successful_login(self):
        """
        Test successful login with valid credentials.
        
        Given: A registered user
        When: POST to /auth/login with correct credentials
        Then: Response code should be 200 and access_token should be present
        """
        access_token = self._create_and_login_user()
        self.assertIsNotNone(access_token)
        self.assertIsInstance(access_token, str)
        self.assertGreater(len(access_token), 0)

    def test_login_with_incorrect_password(self):
        """
        Test login fails with incorrect password.
        
        Given: A registered user
        When: POST to /auth/login with wrong password
        Then: Response code should be 401
        """
        self._create_and_login_user()

        login_data = {
            "user_identifier": self.TEST_EMAIL,
            "password": self.TEST_PASSWORD + "wrong",
        }

        response = self.client.post("/auth/login", data=login_data)
        self.assertResponseCode(response, 401)

    def test_login_with_incorrect_email(self):
        """
        Test login fails with incorrect email.
        
        Given: A registered user
        When: POST to /auth/login with wrong email
        Then: Response code should be 401
        """
        self._create_and_login_user()

        login_data = {
            "user_identifier": "wrong" + self.TEST_EMAIL,
            "password": self.TEST_PASSWORD,
        }

        response = self.client.post("/auth/login", data=login_data)
        self.assertResponseCode(response, 401)

    def test_login_nonexistent_user(self):
        """
        Test login fails for user that doesn't exist.
        
        Given: No registered user
        When: POST to /auth/login
        Then: Response code should be 401
        """
        login_data = {
            "user_identifier": "nonexistent@example.com",
            "password": "anypassword",
        }

        response = self.client.post("/auth/login", data=login_data)
        self.assertResponseCode(response, 401)

    def test_successful_logout(self):
        """
        Test successful logout with valid token.
        
        Given: A logged-in user
        When: POST to /auth/logout with valid token
        Then: Response code should be 200
        """
        access_token = self._create_and_login_user()
        headers = self.get_auth_headers(access_token)
        
        response = self.client.post("/auth/logout", headers=headers)
        self.assertResponseCode(response, 200)

    def test_logout_without_token(self):
        """
        Test logout fails without authorization token.
        
        Given: No authorization header
        When: POST to /auth/logout
        Then: Response should indicate missing authorization
        """
        response = self.client.post("/auth/logout")
        # Should fail - no auth header
        self.assertIn(response.status_code, [401, 422])