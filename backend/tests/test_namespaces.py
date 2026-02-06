"""
Test cases for namespace management functionality.
"""

from base_case import BaseTestClass


class TestNamespaces(BaseTestClass):
    """Test cases for namespace-related endpoints."""
    
    # Test data constants
    TEST_EMAIL = "testemail@gmail.com"
    TEST_PASSWORD = "testpass123"
    TEST_USERNAME = "testuser"
    
    TEST_NAMESPACE = "test_namespace"
    TEST_NAMESPACE_DESC = "test namespace description"

    def _login(self):
        """
        Helper to signup and login a user.
        
        Returns:
            str: Access token for the logged-in user
        """
        signup_data = {
            "email": self.TEST_EMAIL,
            "password": self.TEST_PASSWORD,
            "username": self.TEST_USERNAME
        }

        response = self.client.post("/auth/signup", data=signup_data)
        self.assertResponseCode(response, 200)

        login_data = {
            "user_identifier": self.TEST_EMAIL,
            "password": self.TEST_PASSWORD
        }

        response = self.client.post("/auth/login", data=login_data)
        self.assertResponseCode(response, 200)
        return response.json["access_token"]
    
    def _get_namespace_data(self):
        """Get test namespace data."""
        return {
            "namespace": self.TEST_NAMESPACE,
            "namespace_description": self.TEST_NAMESPACE_DESC
        }

    def test_successful_namespace_creation(self):
        """
        Test successful namespace creation.
        
        Given: A logged-in user
        When: POST to /namespaces with valid data
        Then: Response code should be 200
        """
        access_token = self._login()
        headers = self.get_auth_headers(access_token)

        response = self.client.post("/namespaces", data=self._get_namespace_data(), headers=headers)
        self.assertResponseCode(response, 200)

    def test_create_duplicate_namespace(self):
        """
        Test creating an already existing namespace fails.
        
        Given: A namespace already exists
        When: POST to /namespaces with same namespace name
        Then: Response code should be 400
        """
        access_token = self._login()
        headers = self.get_auth_headers(access_token)

        # Create namespace
        response = self.client.post("/namespaces", data=self._get_namespace_data(), headers=headers)
        self.assertResponseCode(response, 200)

        # Try to create same namespace again
        response = self.client.post("/namespaces", data=self._get_namespace_data(), headers=headers)
        self.assertResponseCode(response, 400)
    
    def test_create_upload_token_success(self):
        """
        Test successful upload token generation.
        
        Given: User is admin/maintainer of namespace
        When: POST to /namespaces/{namespace}/uploadToken
        Then: Response code should be 200 and token should be present
        """
        access_token = self._login()
        headers = self.get_auth_headers(access_token)

        # Create namespace
        response = self.client.post("/namespaces", data=self._get_namespace_data(), headers=headers)
        self.assertResponseCode(response, 200)

        # Generate token
        response = self.client.post(f"/namespaces/{self.TEST_NAMESPACE}/uploadToken", headers=headers)
        self.assertResponseCode(response, 200)
        self.assertIn("uploadToken", response.json)

    def test_create_upload_token_unauthorized(self):
        """
        Test upload token generation fails for unauthorized user.
        
        Given: User is not admin/maintainer of namespace
        When: POST to /namespaces/{namespace}/uploadToken
        Then: Response code should be 401
        """
        access_token = self._login()
        headers = self.get_auth_headers(access_token)

        # Create namespace
        response = self.client.post("/namespaces", data=self._get_namespace_data(), headers=headers)
        self.assertResponseCode(response, 200)

        # Create and login as different user
        new_user = {
            "username": "newuser",
            "password": "newpassword",
            "email": "newuser@gmail.com",
        }
        response = self.client.post("/auth/signup", data=new_user)
        self.assertResponseCode(response, 200)

        response = self.client.post("/auth/login", data={
            "user_identifier": "newuser",
            "password": "newpassword"
        })
        self.assertResponseCode(response, 200)
        new_token = response.json["access_token"]

        # Try to generate token as new user (should fail)
        headers = self.get_auth_headers(new_token)
        response = self.client.post(f"/namespaces/{self.TEST_NAMESPACE}/uploadToken", headers=headers)
        self.assertResponseCode(response, 401)

    def test_get_namespace_maintainers(self):
        """
        Test getting list of namespace maintainers.
        
        Given: A namespace exists
        When: POST to /namespaces/{namespace}/maintainers
        Then: Response code should be 200 and creator should be in list
        """
        access_token = self._login()
        headers = self.get_auth_headers(access_token)

        # Create namespace
        response = self.client.post("/namespaces", data=self._get_namespace_data(), headers=headers)
        self.assertResponseCode(response, 200)

        # Get maintainers list
        response = self.client.post(f"/namespaces/{self.TEST_NAMESPACE}/maintainers", headers=headers)
        self.assertResponseCode(response, 200)
        self.assertIn("users", response.json)
        self.assertEqual(1, len(response.json["users"]))

    def test_get_namespace_admins(self):
        """
        Test getting list of namespace admins.
        
        Given: A namespace exists
        When: POST to /namespaces/{namespace}/admins
        Then: Response code should be 200 and creator should be in list
        """
        access_token = self._login()
        headers = self.get_auth_headers(access_token)

        # Create namespace
        response = self.client.post("/namespaces", data=self._get_namespace_data(), headers=headers)
        self.assertResponseCode(response, 200)

        # Get admins list
        response = self.client.post(f"/namespaces/{self.TEST_NAMESPACE}/admins", headers=headers)
        self.assertResponseCode(response, 200)
        self.assertIn("users", response.json)
        self.assertEqual(1, len(response.json["users"]))