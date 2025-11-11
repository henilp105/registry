"""
Base test class for all backend tests.

Provides common setup and teardown functionality including:
- Flask test client configuration
- MongoDB test database setup and cleanup
- JWT configuration for authenticated requests
"""

import unittest
import os
from mongo import client
from server import app


class BaseTestClass(unittest.TestCase):
    """
    Base test class that all test classes should inherit from.
    
    Provides:
    - Configured Flask test client
    - Test database that is cleaned up after each test
    - JWT secret key configuration
    """
    
    # Class-level constants for test data
    TEST_DB_NAME = "testregistry"
    TEST_SERVER_NAME = "localhost:9090"
    TEST_JWT_SECRET = "fpm-registry-test-secret-key"
    
    @classmethod
    def setUpClass(cls):
        """Set up class-level configuration once before all tests."""
        app.config["TESTING"] = True
        app.config["SERVER_NAME"] = cls.TEST_SERVER_NAME
        app.config["JWT_SECRET_KEY"] = os.getenv("JWT_SECRET_KEY", cls.TEST_JWT_SECRET)
    
    def setUp(self):
        """Set up test fixtures before each test method."""
        self.client = app.test_client()
        self.app_context = app.app_context()
        self.app_context.push()

    def tearDown(self):
        """Clean up after each test method."""
        # Drop the test database to ensure clean state
        client.drop_database(self.TEST_DB_NAME)
        self.app_context.pop()
    
    # Helper methods for common test operations
    def create_user(self, email="test@example.com", password="testpass123", username="testuser"):
        """
        Helper method to create a test user.
        
        Args:
            email: User email address
            password: User password
            username: Username
            
        Returns:
            Response object from signup request
        """
        data = {
            "email": email,
            "password": password,
            "username": username
        }
        return self.client.post("/auth/signup", data=data)
    
    def login_user(self, user_identifier, password):
        """
        Helper method to login a user.
        
        Args:
            user_identifier: Email or username
            password: User password
            
        Returns:
            Response object from login request
        """
        data = {
            "user_identifier": user_identifier,
            "password": password
        }
        return self.client.post("/auth/login", data=data)
    
    def get_auth_headers(self, access_token):
        """
        Helper method to create authorization headers.
        
        Args:
            access_token: JWT access token
            
        Returns:
            Dict with Authorization header
        """
        return {"Authorization": f"Bearer {access_token}"}
    
    def assertResponseCode(self, response, expected_code, msg=None):
        """
        Assert that response JSON contains expected code.
        
        Args:
            response: Flask test response
            expected_code: Expected code value
            msg: Optional assertion message
        """
        self.assertEqual(
            expected_code, 
            response.json.get("code"),
            msg or f"Expected code {expected_code}, got {response.json}"
        )
