"""
Test cases for package management functionality.
"""

from base_case import BaseTestClass
from packages import check_token_expiry
from datetime import datetime
import os


class TestPackages(BaseTestClass):
    """Test cases for package-related endpoints."""
    
    # Test data constants
    TEST_EMAIL = "testemail@gmail.com"
    TEST_PASSWORD = "testpass123"
    TEST_USERNAME = "testuser"
    TEST_NAMESPACE = "test_namespace"
    TEST_NAMESPACE_DESC = "Test namespace description"
    TEST_PACKAGE_NAME = "test_package"
    TEST_PACKAGE_VERSION = "0.0.1"
    TEST_PACKAGE_LICENSE = "MIT"
    TEST_HOMEPAGE = "fortran-lang.org"

    def setUp(self):
        """Set up test fixtures before each test method."""
        super().setUp()
        self._access_token = None
        self._is_user_created = False
        self._is_namespace_created = False

    def _get_package_data(self, **overrides):
        """
        Get test package data with optional overrides.
        
        Args:
            **overrides: Key-value pairs to override default values
            
        Returns:
            dict: Package data for upload
        """
        data = {
            "package_name": self.TEST_PACKAGE_NAME,
            "package_version": self.TEST_PACKAGE_VERSION,
            "package_license": self.TEST_PACKAGE_LICENSE,
            "homepage": self.TEST_HOMEPAGE
        }
        data.update(overrides)
        return data

    def _login(self, is_sudo=False):
        """
        Helper to signup and login a user.
        
        Args:
            is_sudo: Whether to use SUDO_PASSWORD
            
        Returns:
            str: Access token for the logged-in user
        """
        if self._is_user_created and self._access_token:
            return self._access_token
        
        password = os.getenv("SUDO_PASSWORD") if is_sudo else self.TEST_PASSWORD
        
        signup_data = {
            "email": self.TEST_EMAIL,
            "password": password,
            "username": self.TEST_USERNAME,
        }

        response = self.client.post("/auth/signup", data=signup_data)
        self.assertResponseCode(response, 200)
        self._is_user_created = True

        login_data = {
            "user_identifier": self.TEST_EMAIL,
            "password": password
        }

        response = self.client.post("/auth/login", data=login_data)
        self.assertResponseCode(response, 200)
        self._access_token = response.json["access_token"]
        return self._access_token

    def _create_namespace(self, access_token):
        """
        Helper to create test namespace.
        
        Args:
            access_token: JWT access token
        """
        if self._is_namespace_created:
            return
            
        headers = self.get_auth_headers(access_token)
        data = {
            "namespace": self.TEST_NAMESPACE,
            "namespace_description": self.TEST_NAMESPACE_DESC,
        }
        response = self.client.post("/namespaces", data=data, headers=headers)
        self.assertResponseCode(response, 200)
        self._is_namespace_created = True

    def _upload_package(self, package_data=None, upload_token=None):
        """
        Helper to upload a package.
        
        Args:
            package_data: Override package data
            upload_token: Use specific token (for testing invalid tokens)
            
        Returns:
            dict: Response JSON
        """
        access_token = self._login()
        headers = self.get_auth_headers(access_token)
        
        self._create_namespace(access_token)

        # Get upload token if not provided
        if upload_token is None:
            response = self.client.post(
                f"/namespaces/{self.TEST_NAMESPACE}/uploadToken",
                headers=headers,
            )
            self.assertResponseCode(response, 200)
            upload_token = response.json["uploadToken"]

        # Use provided package data or defaults
        pkg_data = package_data or self._get_package_data()

        # Upload the package
        response = self.client.post(
            "/packages",
            content_type="multipart/form-data",
            data={
                "upload_token": upload_token,
                **pkg_data,
                "dry_run": "false",
                "tarball": ("static/registry.tar.gz", "package.tar.gz"),
            },
            headers=headers,
        )

        result = response.json.copy()
        result["uploadToken"] = upload_token
        return result

    # ===== Package Upload Tests =====

    def test_successful_package_upload(self):
        """
        Test successful package upload.
        
        Given: Valid package data and upload token
        When: POST to /packages
        Then: Response code should be 200
        """
        response = self._upload_package()
        self.assertEqual(200, response["code"])

    def test_upload_duplicate_package(self):
        """
        Test uploading duplicate package fails.
        
        Given: Package already exists
        When: POST to /packages with same package
        Then: Response code should be 400
        """
        response = self._upload_package()
        self.assertEqual(200, response["code"])

        response = self._upload_package()
        self.assertEqual(400, response["code"])

    def test_upload_invalid_version(self):
        """
        Test uploading package with invalid version fails.
        
        Given: Package data with invalid version string
        When: POST to /packages
        Then: Response code should be 400
        """
        response = self._upload_package()
        self.assertEqual(200, response["code"])

        # Try with invalid version
        response = self._upload_package(
            package_data=self._get_package_data(package_version="invalid_version")
        )
        self.assertEqual(400, response["code"])

    def test_upload_invalid_token(self):
        """
        Test uploading with invalid token fails.
        
        Given: Invalid upload token
        When: POST to /packages
        Then: Response code should be 401
        """
        response = self._upload_package(upload_token="invalid_token_12345")
        self.assertEqual(401, response["code"])

    def test_upload_invalid_license(self):
        """
        Test uploading package with invalid license fails.
        
        Given: Package data with invalid SPDX license
        When: POST to /packages
        Then: Response code should be 400
        """
        response = self._upload_package(
            package_data=self._get_package_data(package_license="INVALID_LICENSE")
        )
        self.assertEqual(400, response["code"])

    # ===== Package Search Tests =====

    def test_search_package(self):
        """
        Test searching for packages.
        
        Given: Package exists
        When: GET /packages with query
        Then: Response code should be 200 and packages returned
        """
        response = self._upload_package()
        self.assertEqual(200, response["code"])

        # Search for existing package
        response = self.client.get(
            "/packages",
            query_string={"query": self.TEST_PACKAGE_NAME}
        )
        self.assertResponseCode(response, 200)

        # Search for non-existent package
        response = self.client.get(
            "/packages",
            query_string={"query": "nonexistent_package_xyz"}
        )
        self.assertResponseCode(response, 200)
        self.assertEqual([], response.json["packages"])

    # ===== Package Retrieval Tests =====

    def test_get_existing_package(self):
        """
        Test getting an existing package.
        
        Given: Package exists
        When: GET /packages/{namespace}/{package}
        Then: Response code should be 200
        """
        self._upload_package()

        response = self.client.get(
            f"/packages/{self.TEST_NAMESPACE}/{self.TEST_PACKAGE_NAME}"
        )
        self.assertResponseCode(response, 200)

    def test_get_nonexistent_package(self):
        """
        Test getting a non-existent package.
        
        Given: Package does not exist
        When: GET /packages/{namespace}/{package}
        Then: Response code should be 404
        """
        self._upload_package()

        response = self.client.get(
            f"/packages/{self.TEST_NAMESPACE}/nonexistent_package"
        )
        self.assertResponseCode(response, 404)

    def test_get_existing_package_version(self):
        """
        Test getting a specific package version.
        
        Given: Package version exists
        When: GET /packages/{namespace}/{package}/{version}
        Then: Response code should be 200
        """
        self._upload_package()

        response = self.client.get(
            f"/packages/{self.TEST_NAMESPACE}/{self.TEST_PACKAGE_NAME}/{self.TEST_PACKAGE_VERSION}"
        )
        self.assertResponseCode(response, 200)

    def test_get_nonexistent_package_version(self):
        """
        Test getting a non-existent package version.
        
        Given: Package version does not exist
        When: GET /packages/{namespace}/{package}/{version}
        Then: Response code should be 404
        """
        self._upload_package()

        response = self.client.get(
            f"/packages/{self.TEST_NAMESPACE}/{self.TEST_PACKAGE_NAME}/9.9.9"
        )
        self.assertResponseCode(response, 404)

    # ===== Package Maintainers Tests =====

    def test_get_package_maintainers(self):
        """
        Test getting package maintainers.
        
        Given: Package exists
        When: GET /packages/{namespace}/{package}/maintainers
        Then: Response code should be 200
        """
        access_token = self._login()
        self._upload_package()

        response = self.client.get(
            f"/packages/{self.TEST_NAMESPACE}/{self.TEST_PACKAGE_NAME}/maintainers",
            headers=self.get_auth_headers(access_token),
        )
        self.assertResponseCode(response, 200)

    # ===== Token Expiry Unit Test =====

    def test_check_token_expiry(self):
        """
        Test token expiry check function.
        
        Given: Token creation timestamps
        When: check_token_expiry is called
        Then: Old tokens should be expired, new tokens should not
        """
        # Old date should be expired
        old_date = datetime(2022, 1, 1)
        self.assertTrue(check_token_expiry(old_date))

        # Current date should not be expired
        current_date = datetime.now()
        self.assertFalse(check_token_expiry(current_date))

    # ===== Rating Tests =====

    def test_successful_rating_submit(self):
        """
        Test submitting a valid rating.
        
        Given: Package exists and user is logged in
        When: POST to /ratings/{namespace}/{package} with valid rating
        Then: Response code should be 200
        """
        access_token = self._login()
        self._upload_package()

        response = self.client.post(
            f"/ratings/{self.TEST_NAMESPACE}/{self.TEST_PACKAGE_NAME}",
            content_type="multipart/form-data",
            data={"rating": 5},
            headers=self.get_auth_headers(access_token),
        )
        self.assertResponseCode(response, 200)

    def test_rating_invalid_value(self):
        """
        Test submitting an invalid rating value fails.
        
        Given: Package exists
        When: POST to /ratings with invalid rating value
        Then: Response code should be 400
        """
        access_token = self._login()

        response = self.client.post(
            f"/ratings/{self.TEST_NAMESPACE}/{self.TEST_PACKAGE_NAME}",
            content_type="multipart/form-data",
            data={"rating": -1},
            headers=self.get_auth_headers(access_token),
        )
        self.assertResponseCode(response, 400)

    def test_rating_invalid_token(self):
        """
        Test submitting rating with invalid token fails.
        
        Given: Invalid authorization token
        When: POST to /ratings
        Then: Response should indicate auth error
        """
        self._login()  # Create user but use invalid token

        response = self.client.post(
            f"/ratings/{self.TEST_NAMESPACE}/{self.TEST_PACKAGE_NAME}",
            content_type="multipart/form-data",
            data={"rating": 5},
            headers={"Authorization": "Bearer invalid_token"},
        )
        self.assertEqual(401, response.json.get("code"))
        self.assertEqual("Invalid token", response.json.get("message"))

    # ===== Malicious Report Tests =====

    def test_successful_malicious_report(self):
        """
        Test submitting a malicious package report.
        
        Given: Package exists and user is logged in
        When: POST to /report/{namespace}/{package} with valid reason
        Then: Response code should be 200
        """
        access_token = self._login()
        self._upload_package()

        response = self.client.post(
            f"/report/{self.TEST_NAMESPACE}/{self.TEST_PACKAGE_NAME}",
            content_type="multipart/form-data",
            data={"reason": "This package contains malicious code that steals data"},
            headers=self.get_auth_headers(access_token),
        )
        self.assertResponseCode(response, 200)

    def test_malicious_report_invalid_token(self):
        """
        Test malicious report with invalid token fails.
        
        Given: Invalid authorization token
        When: POST to /report
        Then: Response should indicate auth error
        """
        self._login()

        response = self.client.post(
            f"/report/{self.TEST_NAMESPACE}/{self.TEST_PACKAGE_NAME}",
            content_type="multipart/form-data",
            data={"reason": "This package is malicious"},
            headers={"Authorization": "Bearer invalid_token"},
        )
        self.assertEqual(401, response.json.get("code"))
        self.assertEqual("Invalid token", response.json.get("message"))

    def test_malicious_report_short_reason(self):
        """
        Test malicious report with short reason fails.
        
        Given: Reason is too short
        When: POST to /report
        Then: Response code should be 400
        """
        access_token = self._login()

        response = self.client.post(
            f"/report/{self.TEST_NAMESPACE}/{self.TEST_PACKAGE_NAME}",
            content_type="multipart/form-data",
            data={"reason": "bad"},
            headers=self.get_auth_headers(access_token),
        )
        self.assertResponseCode(response, 400)

    # ===== Admin Report Access Tests =====

    def test_fetch_malicious_reports_as_sudo(self):
        """
        Test sudo user can fetch malicious reports.
        
        Given: User is sudo
        When: GET /report/view
        Then: Response code should be 200
        """
        sudo_password = os.getenv("SUDO_PASSWORD")
        if not sudo_password:
            self.skipTest("SUDO_PASSWORD not set in environment")

        access_token = self._login(is_sudo=True)

        response = self.client.get(
            "/report/view",
            headers=self.get_auth_headers(access_token)
        )
        self.assertResponseCode(response, 200)

    def test_fetch_malicious_reports_unauthorized(self):
        """
        Test non-sudo user cannot fetch malicious reports.
        
        Given: User is not sudo
        When: GET /report/view
        Then: Response code should be 401
        """
        access_token = self._login()

        response = self.client.get(
            "/report/view",
            headers=self.get_auth_headers(access_token)
        )
        self.assertResponseCode(response, 401)
